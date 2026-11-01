import { Router, Request, Response } from "express";
import {
  db,
  usersTable,
  invitationsTable,
  teammatesTable,
  notificationsTable,
} from "@workspace/db";
import { eq, and, ne, or, sql, gt } from "drizzle-orm";
import { requireAuth, getClerkId } from "../middlewares/auth";
import { sendInvitationEmail, isMailConfigured } from "../lib/mailer";
import crypto from "crypto";
import { makeNotificationEvent } from "../lib/notificationEvents";
import { persistedNotificationColumns, queuePushNotifications, type PersistedNotification } from "../lib/pushNotifications";
import { checkResendable, singleFlight } from "../lib/invitationResend";
import type { SendResult } from "../lib/emailDelivery";

// One email per invitation at a time, however many resend requests arrive.
const resendFlight = singleFlight<SendResult>();

/** Where the invitation link points. */
function buildInvitationLink(token: string): string {
  const base = process.env.FRONTEND_URL || "http://localhost:8081";
  return `${base.replace(/\/+$/, "")}/accept-invitation/${token}`;
}

/** Best display name for the person doing the inviting. */
function inviterDisplayName(user: { name: string | null; email: string }): string {
  return user.name?.trim() || user.email.split("@")[0];
}

const router = Router();

// Apply auth middleware to all routes
router.use(requireAuth);

/**
 * POST /api/teammates/sync-user
 * Sync or create Clerk user in database
 * Called when user logs in
 */
router.post(
  "/sync-user",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const clerkId = getClerkId(req);
      const { email, name } = req.body;

      if (!email) {
        res.status(400).json({ error: "Email is required" });
        return;
      }

      const normalizedEmail = String(email).trim().toLowerCase();

      const emailConflict = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.email, normalizedEmail))
        .limit(1);

      if (emailConflict.length > 0 && emailConflict[0].clerkId !== clerkId) {
        res.status(409).json({
          error: "Email is already associated with another authenticated user",
        });
        return;
      }

      // Upsert user - create if not exists, update if exists
      const existingUser = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.clerkId, clerkId))
        .limit(1);

      if (existingUser.length === 0) {
        // `email` is unique. A row can already exist under a different Clerk id
        // if the account was recreated or the row was seeded by hand - report
        // that plainly instead of surfacing a Postgres constraint error.
        const emailOwner = await db
          .select({ clerkId: usersTable.clerkId })
          .from(usersTable)
          .where(eq(usersTable.email, normalizedEmail))
          .limit(1);

        if (emailOwner.length > 0) {
          res.status(409).json({
            error:
              "That email is already registered to a different account on this server.",
          });
          return;
        }

        await db.insert(usersTable).values({
          clerkId,
          email: normalizedEmail,
          name: name || normalizedEmail.split("@")[0],
        });
      } else {
        // Update email/name if provided
        await db
          .update(usersTable)
          .set({
            email: normalizedEmail,
            name: name || existingUser[0].name,
          })
          .where(eq(usersTable.clerkId, clerkId));
      }

      // An invitation may have been emailed before this account existed.
      // Materialize any still-pending invitations now that this email has a
      // verified app profile; dedupe keys make repeated sign-ins harmless.
      const materialized = await db.transaction(async (tx) => {
        const created: PersistedNotification[] = [];
        const pending = await tx.select({ id: invitationsTable.id, inviterId: invitationsTable.inviterId,
          inviterName: usersTable.name, inviterEmail: usersTable.email })
          .from(invitationsTable)
          .innerJoin(usersTable, eq(usersTable.clerkId, invitationsTable.inviterId))
          .where(and(eq(invitationsTable.invitedEmail, normalizedEmail), eq(invitationsTable.status, "pending"),
            gt(invitationsTable.expiresAt, new Date()), ne(invitationsTable.inviterId, clerkId)));
        for (const invite of pending) {
          const notification = makeNotificationEvent({ recipientUserId: clerkId, actorUserId: invite.inviterId,
            actorName: inviterDisplayName({ name: invite.inviterName, email: invite.inviterEmail }),
            type: "collaboration_invite", resourceType: "invitation", resourceId: invite.id });
          if (!notification) continue;
          // Only rows actually inserted are pushed, so repeat sign-ins stay silent.
          const [row] = await tx.insert(notificationsTable).values(notification).onConflictDoNothing()
            .returning(persistedNotificationColumns);
          if (row) created.push(row);
        }
        return created;
      });
      queuePushNotifications(materialized);

      res.json({ success: true, clerkId });
      return;
    } catch (error) {
      console.error("Error syncing user:", error);
      res.status(500).json({ error: "Failed to sync user" });
      return;
    }
  },
);

/**
 * GET /api/teammates/list
 * Get all current teammates for the authenticated user
 */
router.get("/list", async (req: Request, res: Response): Promise<void> => {
  try {
    const clerkId = getClerkId(req);

    const teammates = await db
      .select()
      .from(teammatesTable)
      .where(eq(teammatesTable.userId, clerkId));

    const teammatteDetails: Array<typeof usersTable.$inferSelect | null> =
      await Promise.all(
        teammates.map(async (tm) => {
          const user = await db
            .select()
            .from(usersTable)
            .where(eq(usersTable.clerkId, tm.teammateUserId))
            .limit(1);
          return user[0] || null;
        }),
      );

    res.json({
      teammates: teammatteDetails.filter(
        (t): t is typeof usersTable.$inferSelect => t !== null,
      ),
    });
    return;
  } catch (error) {
    console.error("Error listing teammates:", error);
    res.status(500).json({ error: "Failed to list teammates" });
    return;
  }
});

/**
 * GET /api/teammates/search?q=<query>
 * Search for users by name or email, excluding the authenticated user.
 */
router.get("/search", async (req: Request, res: Response): Promise<void> => {
  try {
    const clerkId = getClerkId(req);
    const rawQuery = typeof req.query.q === "string" ? req.query.q : "";
    const normalizedQuery = rawQuery.trim();

    if (normalizedQuery.length < 2) {
      res.status(400).json({ error: "Query must be at least 2 characters" });
      return;
    }

    const searchValue = `%${normalizedQuery.toLowerCase()}%`;

    const matches = await db
      .select({
        clerkId: usersTable.clerkId,
        name: usersTable.name,
        email: usersTable.email,
      })
      .from(usersTable)
      .where(
        and(
          ne(usersTable.clerkId, clerkId),
          or(
            sql`LOWER(${usersTable.name}) LIKE ${searchValue}`,
            sql`LOWER(${usersTable.email}) LIKE ${searchValue}`,
          ),
        ),
      )
      .limit(20);

    res.json({ users: matches });
    return;
  } catch (error) {
    console.error("Error searching teammates:", error);
    res.status(500).json({ error: "Failed to search users" });
    return;
  }
});

/**
 * POST /api/teammates/invite
 * Create a new invitation for an email address
 *
 * Body: { invitedEmail: string }
 */
router.post("/invite", async (req: Request, res: Response): Promise<void> => {
  try {
    const clerkId = getClerkId(req);
    const { invitedEmail } = req.body;

    if (!invitedEmail) {
      res.status(400).json({ error: "Email is required" });
      return;
    }

    const normalizedEmail = String(invitedEmail).trim().toLowerCase();

    // Prevent self-invitation
    const user = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkId, clerkId))
      .limit(1);

    if (!user.length) {
      // The Clerk session is valid but no row was ever created for it. The app
      // calls /sync-user on sign-in; if that failed, every teammate and file
      // feature breaks here rather than at sign-in, which is confusing.
      res.status(404).json({
        error:
          "Your profile has not been synced to the server yet. Sign out and back in, then try again.",
      });
      return;
    }

    if (user[0].email === normalizedEmail) {
      res.status(400).json({ error: "Cannot invite yourself as a teammate" });
      return;
    }

    // `invitations_inviter_invited_idx` allows only one row per
    // (inviter, email), so an expired, declined or used invitation is
    // re-issued in place below instead of inserting a second row.
    const [existingInvitation] = await db
      .select()
      .from(invitationsTable)
      .where(
        and(
          eq(invitationsTable.inviterId, clerkId),
          eq(invitationsTable.invitedEmail, normalizedEmail),
        ),
      )
      .limit(1);

    if (
      existingInvitation?.status === "pending" &&
      existingInvitation.expiresAt > new Date()
    ) {
      // `code` tells the app to offer "Resend Invitation" (POST /invite/resend
      // with invitedEmail) instead of creating a duplicate.
      res.status(400).json({
        error: "Invitation already pending for this email",
        code: "invitation_pending",
        invitedEmail: normalizedEmail,
      });
      return;
    }

    // Check if already teammates
    const recipientUser = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, normalizedEmail))
      .limit(1);

    if (recipientUser.length > 0) {
      const isTeammate = await db
        .select()
        .from(teammatesTable)
        .where(
          and(
            eq(teammatesTable.userId, clerkId),
            eq(teammatesTable.teammateUserId, recipientUser[0].clerkId),
          ),
        )
        .limit(1);

      if (isTeammate.length > 0) {
        res.status(400).json({ error: "Already teammates with this user" });
        return;
      }
    }

    // Generate secure random token (32 bytes = 64 hex chars)
    const token = crypto.randomBytes(32).toString("hex");

    // Expiry: 7 days from now
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const invitationNotification = await db.transaction(async (tx) => {
      const issued = { token, status: "pending" as const, expiresAt, acceptedAt: null, acceptedByUserId: null };
      const [created] = existingInvitation
        ? await tx.update(invitationsTable).set(issued)
            .where(eq(invitationsTable.id, existingInvitation.id)).returning({ id: invitationsTable.id })
        : await tx.insert(invitationsTable).values({ inviterId: clerkId, invitedEmail: normalizedEmail, ...issued })
            .returning({ id: invitationsTable.id });
      if (!recipientUser[0]) return undefined;
      const notification = makeNotificationEvent({ recipientUserId: recipientUser[0].clerkId, actorUserId: clerkId,
        actorName: inviterDisplayName(user[0]), type: "collaboration_invite", resourceType: "invitation", resourceId: created.id });
      if (!notification) return undefined;
      // A re-issued invitation keeps its id (and so its dedupe key); surface
      // the earlier notification again as unread instead of dropping it.
      const [row] = await tx.insert(notificationsTable).values(notification).onConflictDoUpdate({
        target: [notificationsTable.recipientUserId, notificationsTable.dedupeKey],
        targetWhere: sql`${notificationsTable.dedupeKey} is not null`,
        set: { read: false, readAt: null, createdAt: new Date(), message: notification.message },
      }).returning(persistedNotificationColumns);
      return row;
    });
    queuePushNotifications([invitationNotification]);

    const invitationLink = buildInvitationLink(token);

    // Email the link. A delivery failure must not lose the invitation - the
    // link is still returned so the inviter can copy or share it manually.
    const delivery = await sendInvitationEmail({
      to: normalizedEmail,
      inviterName: inviterDisplayName(user[0]),
      inviterEmail: user[0].email,
      invitationLink,
      expiresAt,
    });

    // Creation and delivery are reported separately: the invitation exists
    // (and its link works) even when SMTP fails.
    res.json({
      success: true,
      invitationCreated: true,
      token,
      invitationLink,
      invitedEmail: normalizedEmail,
      expiresAt,
      emailDelivery: { status: delivery.status, message: delivery.error ?? null },
      emailSent: delivery.sent,
      emailError: delivery.error ?? null,
      mailConfigured: isMailConfigured(),
    });
    return;
  } catch (error) {
    console.error("Error creating invitation:", error);
    res.status(500).json({ error: "Failed to create invitation" });
    return;
  }
});

/**
 * POST /api/teammates/invite/resend
 * Re-send the email for an invitation the caller already created, reusing its
 * existing token (no new row, no new token).
 *
 * Body: { invitedEmail: string } or { token: string }
 *
 * The lookup is always scoped to inviterId = caller, so another user's
 * invitation is indistinguishable from a missing one. Responds 200 whenever
 * the invitation is valid; email success or failure is reported separately in
 * `emailDelivery`, so a failed send never looks like a missing invitation.
 */
router.post(
  "/invite/resend",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const clerkId = getClerkId(req);
      const token = typeof req.body?.token === "string" ? req.body.token : "";
      const invitedEmail =
        typeof req.body?.invitedEmail === "string"
          ? req.body.invitedEmail.trim().toLowerCase()
          : "";

      if (!token && !invitedEmail) {
        res.status(400).json({ error: "Email or token is required" });
        return;
      }

      const [inv] = await db
        .select()
        .from(invitationsTable)
        .where(
          and(
            eq(invitationsTable.inviterId, clerkId),
            token
              ? eq(invitationsTable.token, token)
              : eq(invitationsTable.invitedEmail, invitedEmail),
          ),
        )
        .limit(1);

      const check = checkResendable(inv, clerkId);
      if (!check.ok) {
        if (check.markExpired && inv) {
          // Existing lifecycle: mark it expired; POST /invite then re-issues
          // the row with a fresh token rather than reusing this link.
          await db
            .update(invitationsTable)
            .set({ status: "expired" })
            .where(
              and(
                eq(invitationsTable.id, inv.id),
                eq(invitationsTable.status, "pending"),
              ),
            );
        }
        res.status(check.httpStatus).json({ error: check.error, code: check.code });
        return;
      }

      const inviter = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.clerkId, clerkId))
        .limit(1);

      if (!inviter.length) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      const invitationLink = buildInvitationLink(inv.token);
      const delivery = await resendFlight(inv.id, () =>
        sendInvitationEmail({
          to: inv.invitedEmail,
          inviterName: inviterDisplayName(inviter[0]),
          inviterEmail: inviter[0].email,
          invitationLink,
          expiresAt: inv.expiresAt,
        }),
      );

      // The link goes only to its own inviter (checked above), who already
      // received it when the invitation was created.
      res.json({
        success: true,
        invitationValid: true,
        invitationLink,
        invitedEmail: inv.invitedEmail,
        expiresAt: inv.expiresAt,
        emailDelivery: { status: delivery.status, message: delivery.error ?? null },
        emailSent: delivery.sent,
        emailError: delivery.error ?? null,
        mailConfigured: isMailConfigured(),
      });
      return;
    } catch (error) {
      console.error("Error resending invitation:", error);
      res.status(500).json({ error: "Failed to resend the invitation" });
      return;
    }
  },
);

/**
 * GET /api/teammates/invitations/pending
 * Get all pending invitations received by the current user
 */
router.get(
  "/invitations/pending",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const clerkId = getClerkId(req);

      // Get user email
      const user = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.clerkId, clerkId))
        .limit(1);

      if (!user.length) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      // Get still-valid pending invitations for this user's email. Expired
      // rows keep status "pending" until someone touches them, so filter on
      // expiresAt as well; otherwise they show up and fail on accept.
      const invitations = await db
        .select()
        .from(invitationsTable)
        .where(
          and(
            eq(invitationsTable.invitedEmail, user[0].email),
            eq(invitationsTable.status, "pending"),
            gt(invitationsTable.expiresAt, new Date()),
            ne(invitationsTable.inviterId, clerkId),
          ),
        );

      // Get inviter details
      const invitationsWithDetails = await Promise.all(
        invitations.map(async (inv) => {
          const inviter = await db
            .select()
            .from(usersTable)
            .where(eq(usersTable.clerkId, inv.inviterId))
            .limit(1);
          return {
            ...inv,
            inviterName: inviter[0]?.name || "Unknown",
            inviterEmail: inviter[0]?.email || "unknown@example.com",
          };
        }),
      );

      res.json({
        invitations: invitationsWithDetails,
      });
      return;
    } catch (error) {
      console.error("Error listing pending invitations:", error);
      res.status(500).json({ error: "Failed to list invitations" });
      return;
    }
  },
);

/**
 * POST /api/teammates/accept
 * Accept an invitation using the token
 *
 * Body: { token: string }
 */
router.post("/accept", async (req: Request, res: Response): Promise<void> => {
  try {
    const clerkId = getClerkId(req);
    const { token } = req.body;

    if (!token) {
      res.status(400).json({ error: "Token is required" });
      return;
    }

    // Get invitation
    const invitation = await db
      .select()
      .from(invitationsTable)
      .where(eq(invitationsTable.token, token))
      .limit(1);

    if (!invitation.length) {
      res.status(404).json({ error: "Invitation not found" });
      return;
    }

    const inv = invitation[0];

    // Check if already used
    if (inv.status !== "pending") {
      res.status(400).json({
        error: `Invitation already ${inv.status}`,
      });
      return;
    }

    // Check if expired
    if (new Date() > inv.expiresAt) {
      await db
        .update(invitationsTable)
        .set({ status: "expired" })
        .where(eq(invitationsTable.id, inv.id));
      res.status(400).json({ error: "Invitation has expired" });
      return;
    }

    // Verify authenticated user's email matches invited email
    const user = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkId, clerkId))
      .limit(1);

    if (!user.length) {
      res.status(404).json({
        error:
          "Your profile has not been synced to the server yet. Sign out and back in, then open the invitation link again.",
      });
      return;
    }

    if (user[0].email !== inv.invitedEmail) {
      res.status(403).json({
        error:
          "Email mismatch - you must accept with the invited email address",
      });
      return;
    }

    // Get inviter's user object
    const inviter = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkId, inv.inviterId))
      .limit(1);

    if (!inviter.length) {
      res.status(404).json({ error: "Inviter not found" });
      return;
    }

    // Create bidirectional teammate relationship
    // Only create if not already teammates
    const accepted = await db.transaction(async (tx) => {
      const [changed] = await tx.update(invitationsTable).set({ status: "accepted", acceptedAt: new Date(), acceptedByUserId: clerkId })
        .where(and(eq(invitationsTable.id, inv.id), eq(invitationsTable.status, "pending"))).returning({ id: invitationsTable.id });
      if (!changed) return null;
      await tx.insert(teammatesTable).values([
        { userId: inv.inviterId, teammateUserId: clerkId },
        { userId: clerkId, teammateUserId: inv.inviterId },
      ]).onConflictDoNothing();
      const acceptingName = user[0].name?.trim() || user[0].email.split("@")[0];
      const notification = makeNotificationEvent({ recipientUserId: inv.inviterId, actorUserId: clerkId, actorName: acceptingName,
        type: "collaboration_accepted", resourceType: "invitation", resourceId: inv.id });
      const [row] = notification
        ? await tx.insert(notificationsTable).values(notification).onConflictDoNothing().returning(persistedNotificationColumns)
        : [];
      return { notification: row };
    });
    if (!accepted) {
      res.status(409).json({ error: "Invitation has already been accepted or is no longer pending." });
      return;
    }
    queuePushNotifications([accepted.notification]);

    res.json({
      success: true,
      message: "Invitation accepted",
      teammate: {
        id: inviter[0].clerkId,
        name: inviter[0].name,
        email: inviter[0].email,
      },
    });
    return;
  } catch (error) {
    console.error("Error accepting invitation:", error);
    res.status(500).json({ error: "Failed to accept invitation" });
    return;
  }
});

/**
 * POST /api/teammates/reject
 * Decline an invitation addressed to the authenticated user's email.
 *
 * Body: { token: string }
 */
router.post("/reject", async (req: Request, res: Response): Promise<void> => {
  try {
    const clerkId = getClerkId(req);
    const { token } = req.body;

    if (!token || typeof token !== "string") {
      res.status(400).json({ error: "Token is required" });
      return;
    }

    const user = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkId, clerkId))
      .limit(1);

    if (!user.length) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Only the invited address may decline, and only while still pending.
    const [declined] = await db
      .update(invitationsTable)
      .set({ status: "declined" })
      .where(
        and(
          eq(invitationsTable.token, token),
          eq(invitationsTable.invitedEmail, user[0].email),
          eq(invitationsTable.status, "pending"),
        ),
      )
      .returning({ id: invitationsTable.id });

    if (!declined) {
      res.status(404).json({ error: "Invitation not found or no longer pending" });
      return;
    }

    res.json({ success: true });
    return;
  } catch (error) {
    console.error("Error declining invitation:", error);
    res.status(500).json({ error: "Failed to decline invitation" });
    return;
  }
});

export default router;

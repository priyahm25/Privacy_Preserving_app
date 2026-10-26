import { Router, type Request, type Response } from "express";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { db, notificationsTable, usersTable } from "@workspace/db";
import { getClerkId, requireAuth } from "../middlewares/auth";
import { logger } from "../lib/logger";

const router = Router();
router.use(requireAuth);

function databaseCode(error: unknown): string | undefined {
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth++) {
    if ("code" in current && typeof current.code === "string" && /^[0-9A-Z]{5}$/.test(current.code)) return current.code;
    current = "cause" in current ? current.cause : undefined;
  }
  return undefined;
}

function reportFailure(operation: string, error: unknown, res: Response): void {
  const code = databaseCode(error);
  // Log only the operation and standard PostgreSQL error code. Never include
  // SQL text, bound values, Clerk IDs, notification contents, or tokens.
  logger.error({ operation, databaseCode: code }, "Notifications request failed");
  const migrationRequired = code === "42P01" || code === "42703";
  res.status(500).json({
    error: migrationRequired ? "Notifications schema is missing or outdated. Apply database migration 005." : `Failed to ${operation}.`,
    code: code === "42P01" ? "NOTIFICATIONS_TABLE_MISSING" : migrationRequired ? "NOTIFICATIONS_SCHEMA_OUTDATED" : "NOTIFICATIONS_REQUEST_FAILED",
  });
}

router.get("/", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getClerkId(req);
    const parsedLimit = Number(req.query.limit ?? 30);
    const parsedOffset = Number(req.query.offset ?? 0);
    const limit = Number.isInteger(parsedLimit) ? Math.min(100, Math.max(1, parsedLimit)) : 30;
    const offset = Number.isInteger(parsedOffset) ? Math.max(0, parsedOffset) : 0;
    const rows = await db.select({ id: notificationsTable.id, type: notificationsTable.type,
      message: notificationsTable.message, resourceType: notificationsTable.resourceType,
      resourceId: notificationsTable.resourceId, readAt: notificationsTable.readAt,
      createdAt: notificationsTable.createdAt, actorName: usersTable.name,
    }).from(notificationsTable)
      .leftJoin(usersTable, eq(usersTable.clerkId, notificationsTable.actorUserId))
      .where(eq(notificationsTable.recipientUserId, userId))
      .orderBy(desc(notificationsTable.createdAt)).limit(limit).offset(offset);
    res.json({ notifications: rows });
  } catch (error) {
    reportFailure("load notifications", error, res);
  }
});

router.get("/unread-count", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getClerkId(req);
    const [result] = await db.select({ value: count() }).from(notificationsTable)
      .where(and(eq(notificationsTable.recipientUserId, userId), isNull(notificationsTable.readAt)));
    res.json({ count: result?.value ?? 0 });
  } catch (error) {
    reportFailure("load unread count", error, res);
  }
});

router.patch("/:id/read", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getClerkId(req);
    await db.update(notificationsTable).set({ readAt: new Date(), read: true })
      .where(and(eq(notificationsTable.id, String(req.params.id)), eq(notificationsTable.recipientUserId, userId), isNull(notificationsTable.readAt)));
    res.json({ success: true });
  } catch (error) {
    reportFailure("update notification", error, res);
  }
});

router.patch("/read-all", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getClerkId(req);
    await db.update(notificationsTable).set({ readAt: new Date(), read: true })
      .where(and(eq(notificationsTable.recipientUserId, userId), isNull(notificationsTable.readAt)));
    res.json({ success: true });
  } catch (error) {
    reportFailure("update notifications", error, res);
  }
});

export default router;

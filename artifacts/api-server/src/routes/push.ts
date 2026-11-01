import { Router, type Request, type Response } from "express";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, pushTokensTable } from "@workspace/db";
import { getClerkId, requireAuth } from "../middlewares/auth";
import { isExpoPushToken } from "../lib/pushDelivery";
import { logger } from "../lib/logger";

const router = Router();
router.use(requireAuth);

/** Active installations kept per account; older ones are disabled. */
const MAX_ACTIVE_TOKENS_PER_USER = 10;

function fail(res: Response, operation: string, error: unknown): void {
  const code = (error as { cause?: { code?: unknown } })?.cause?.code ?? (error as { code?: unknown })?.code;
  // Never log the token itself.
  logger.error({ operation, databaseCode: typeof code === "string" ? code : undefined }, "Push token request failed");
  res.status(code === "42P01" ? 503 : 500).json({
    error: code === "42P01" ? "Push notifications are not enabled on the server yet (migration 008)." : `Failed to ${operation}.`,
  });
}

/**
 * POST /api/push/tokens
 * Body: { token: "ExponentPushToken[...]", platform: "android" | "ios" }
 * Idempotent. A token already registered to another account moves to the
 * caller, because one installation can only belong to the signed-in user.
 */
router.post("/tokens", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getClerkId(req);
    const { token, platform } = req.body ?? {};
    if (!isExpoPushToken(token) || (platform !== "android" && platform !== "ios")) {
      res.status(400).json({ error: "A valid Expo push token and platform are required." });
      return;
    }
    await db.transaction(async (tx) => {
      await tx.insert(pushTokensTable).values({ userId, token, platform })
        .onConflictDoUpdate({
          target: pushTokensTable.token,
          set: { userId, platform, updatedAt: new Date(), disabledAt: null, disabledReason: null },
        });
      const active = await tx.select({ id: pushTokensTable.id }).from(pushTokensTable)
        .where(and(eq(pushTokensTable.userId, userId), isNull(pushTokensTable.disabledAt)))
        .orderBy(desc(pushTokensTable.updatedAt));
      const stale = active.slice(MAX_ACTIVE_TOKENS_PER_USER).map((row) => row.id);
      if (stale.length) {
        await tx.update(pushTokensTable).set({ disabledAt: sql`now()`, disabledReason: "superseded" })
          .where(inArray(pushTokensTable.id, stale));
      }
    });
    res.json({ success: true });
  } catch (error) {
    fail(res, "register push token", error);
  }
});

/**
 * POST /api/push/tokens/unregister
 * Body: { token }. Called before sign-out so the phone stops receiving this
 * account's notifications. Only the owner can disable a token.
 */
router.post("/tokens/unregister", async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = getClerkId(req);
    const { token } = req.body ?? {};
    if (!isExpoPushToken(token)) {
      res.status(400).json({ error: "A valid Expo push token is required." });
      return;
    }
    await db.update(pushTokensTable).set({ disabledAt: new Date(), disabledReason: "signed_out" })
      .where(and(eq(pushTokensTable.token, token), eq(pushTokensTable.userId, userId), isNull(pushTokensTable.disabledAt)));
    res.json({ success: true });
  } catch (error) {
    fail(res, "unregister push token", error);
  }
});

export default router;

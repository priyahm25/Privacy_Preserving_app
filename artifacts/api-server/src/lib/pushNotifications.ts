import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, notificationsTable, pushTokensTable, type NotificationType } from "@workspace/db";
import { logger } from "./logger";
import { deliverPush, type PushDeps } from "./pushDelivery";

/** A notification row that was just created or re-surfaced as unread. */
export interface PersistedNotification {
  id: string;
  recipientUserId: string;
  type: NotificationType;
  resourceType: string | null;
  resourceId: string | null;
}

/** Pass to `.returning()` on a notifications insert to get a PersistedNotification. */
export const persistedNotificationColumns = {
  id: notificationsTable.id,
  recipientUserId: notificationsTable.recipientUserId,
  type: notificationsTable.type,
  resourceType: notificationsTable.resourceType,
  resourceId: notificationsTable.resourceId,
};

function databaseCode(error: unknown): string | undefined {
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth++) {
    if ("code" in current && typeof current.code === "string" && /^[0-9A-Z]{5}$/.test(current.code)) return current.code;
    current = "cause" in current ? current.cause : undefined;
  }
  return undefined;
}

const deps: PushDeps = {
  fetch: (url, init) => fetch(url, init),
  accessToken: process.env.EXPO_ACCESS_TOKEN?.trim() || undefined,
  disableTokens: async (tokenIds, reason) => {
    if (!tokenIds.length) return;
    await db.update(pushTokensTable).set({ disabledAt: new Date(), disabledReason: reason })
      .where(and(inArray(pushTokensTable.id, tokenIds), isNull(pushTokensTable.disabledAt)));
  },
  log: (level, fields, message) => logger[level](fields, message),
};

let warnedMissingTable = false;

async function pushOne(notification: PersistedNotification): Promise<void> {
  let tokens: { id: string; token: string }[];
  try {
    tokens = await db.select({ id: pushTokensTable.id, token: pushTokensTable.token }).from(pushTokensTable)
      .where(and(eq(pushTokensTable.userId, notification.recipientUserId), isNull(pushTokensTable.disabledAt)));
  } catch (error) {
    if (databaseCode(error) === "42P01") {
      if (!warnedMissingTable) logger.warn("push_tokens table is missing; apply lib/db/sql/008_push_tokens.sql to enable phone notifications");
      warnedMissingTable = true;
      return;
    }
    throw error;
  }
  if (!tokens.length) return;
  const result = await deliverPush(deps, tokens, {
    notificationId: notification.id,
    type: notification.type,
    resourceType: notification.resourceType,
    resourceId: notification.resourceId,
  });
  logger.info({ type: notification.type, ...result }, "Push delivery");
}

/**
 * Send phone notifications for rows that were just committed. Call this only
 * after the transaction that wrote them, so a rolled-back event never pushes,
 * and only with rows the insert actually returned, so a deduplicated retry
 * never pushes twice. Fire-and-forget: it never delays or fails the request.
 */
export function queuePushNotifications(notifications: Array<PersistedNotification | null | undefined>): void {
  for (const notification of notifications) {
    if (!notification) continue;
    void pushOne(notification).catch((error) => {
      logger.error({ databaseCode: databaseCode(error) }, "Push delivery failed");
    });
  }
}

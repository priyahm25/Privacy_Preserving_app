import { pgTable, text, timestamp, uuid, index, uniqueIndex, boolean, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./teammates";

export type NotificationType = "file_shared" | "collaboration_invite" | "collaboration_accepted" | "chat_message";

/** Minimal event metadata only; never store message or document contents here. */
export const notificationsTable = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Keep the established column names to preserve existing notification rows.
    recipientUserId: text("user_id").notNull().references(() => usersTable.clerkId, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id").references(() => usersTable.clerkId, { onDelete: "set null" }),
    type: text("type").notNull().$type<NotificationType>(),
    title: text("title").notNull(),
    message: text("message").notNull(),
    resourceType: text("related_entity_type"),
    resourceId: text("related_entity_id"),
    read: boolean("read").notNull().default(false),
    dedupeKey: text("deduplication_key"),
    readAt: timestamp("read_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("notifications_recipient_created_idx").on(table.recipientUserId, table.createdAt), index("notifications_recipient_unread_idx").on(table.recipientUserId, table.readAt), uniqueIndex("notifications_user_dedup_idx").on(table.recipientUserId, table.dedupeKey).where(sql`${table.dedupeKey} is not null`)],
).enableRLS();

export type Notification = typeof notificationsTable.$inferSelect;

/**
 * Expo push tokens, one row per app installation (see sql/008).
 * A token re-registered under another account moves to that account, so a
 * shared phone never receives the previous user's alerts. Tokens that Expo
 * reports as unregistered are disabled rather than deleted.
 */
export const pushTokensTable = pgTable(
  "push_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull().references(() => usersTable.clerkId, { onDelete: "cascade" }),
    token: text("token").notNull(),
    platform: text("platform").notNull().$type<"android" | "ios">(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    disabledAt: timestamp("disabled_at"),
    disabledReason: text("disabled_reason"),
  },
  (table) => [uniqueIndex("push_tokens_token_unique_idx").on(table.token), index("push_tokens_user_active_idx").on(table.userId).where(sql`${table.disabledAt} is null`),
    check("push_tokens_platform_check", sql`${table.platform} in ('android', 'ios')`)],
).enableRLS();

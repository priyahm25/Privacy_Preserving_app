import { pgTable, text, timestamp, uuid, index, uniqueIndex, boolean } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./teammates";

export type NotificationType = "file_shared" | "collaboration_invite" | "collaboration_accepted";

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

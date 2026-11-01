import { pgTable, text, timestamp, uuid, index, uniqueIndex, check, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./teammates";
import { userDeviceKeysTable } from "./files";

// Table names are prefixed because the shared DB already has legacy `conversations`,
// `chat_messages` and `chat_keys` tables with a different shape (see sql/007).
/** One row per one-to-one pair, with participants stored in canonical order. */
export const conversationsTable = pgTable("secure_conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  participantAId: text("participant_a_id").notNull().references(() => usersTable.clerkId, { onDelete: "cascade" }),
  participantBId: text("participant_b_id").notNull().references(() => usersTable.clerkId, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("secure_conversations_pair_unique_idx").on(t.participantAId, t.participantBId),
  index("secure_conversations_participant_a_idx").on(t.participantAId),
  index("secure_conversations_participant_b_idx").on(t.participantBId),
  check("secure_conversations_distinct_participants", sql`${t.participantAId} <> ${t.participantBId}`),
]).enableRLS();

export const chatMessagesTable = pgTable("secure_chat_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id").notNull().references(() => conversationsTable.id, { onDelete: "cascade" }),
  senderId: text("sender_id").notNull().references(() => usersTable.clerkId, { onDelete: "cascade" }),
  senderDeviceKeyId: uuid("sender_device_key_id").notNull().references(() => userDeviceKeysTable.id),
  ciphertext: text("ciphertext").notNull(),
  iv: text("iv").notNull(),
  replyToMessageId: uuid("reply_to_message_id").references((): AnyPgColumn => chatMessagesTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  deliveredAt: timestamp("delivered_at"),
  readAt: timestamp("read_at"),
}, (t) => [
  index("secure_chat_messages_conversation_created_idx").on(t.conversationId, t.createdAt),
  index("secure_chat_messages_sender_idx").on(t.senderId),
]).enableRLS();

/** Each authorized device receives its own ECDH/HKDF/AES-GCM wrapped message key. */
export const chatKeysTable = pgTable("secure_chat_message_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  messageId: uuid("message_id").notNull().references(() => chatMessagesTable.id, { onDelete: "cascade" }),
  deviceKeyId: uuid("device_key_id").notNull().references(() => userDeviceKeysTable.id),
  wrappedKey: text("wrapped_key").notNull(),
  wrappingIv: text("wrapping_iv").notNull(),
}, (t) => [
  uniqueIndex("secure_chat_message_keys_message_device_unique_idx").on(t.messageId, t.deviceKeyId),
  index("secure_chat_message_keys_device_idx").on(t.deviceKeyId),
]).enableRLS();

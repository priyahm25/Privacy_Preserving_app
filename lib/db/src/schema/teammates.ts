import {
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

/**
 * Users table - stores Clerk user information
 * Primary key: clerkId (Clerk's unique identifier)
 * Never trust frontend user IDs; always derive from Clerk session
 */
export const usersTable = pgTable(
  "users",
  {
    clerkId: text("clerk_id").primaryKey(), // Clerk's unique user ID
    email: text("email").notNull().unique(),
    name: text("name"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("users_email_idx").on(table.email)],
).enableRLS();

/**
 * Teammates table - represents accepted teammate relationships
 * Bidirectional: (userA, userB) and (userB, userA) are different relationships
 * Unique constraint prevents duplicate relationships in same direction
 */
export const teammatesTable = pgTable(
  "teammates",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    userId: text("user_id")
      .notNull()
      .references(() => usersTable.clerkId, { onDelete: "cascade" }),

    teammateUserId: text("teammate_user_id")
      .notNull()
      .references(() => usersTable.clerkId, { onDelete: "cascade" }),

    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("teammates_unique_idx").on(table.userId, table.teammateUserId),
  ],
).enableRLS();

/**
 * Invitations table - tracks pending and accepted invitations
 * token: secure random string sent in invitation link
 * status: pending, accepted, expired, revoked, declined
 * expiresAt: invitation expires after 7 days (check on accept)
 */
export const invitationsTable = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    inviterId: text("inviter_id")
      .notNull()
      .references(() => usersTable.clerkId, { onDelete: "cascade" }),

    invitedEmail: text("invited_email").notNull(),

    token: text("token").notNull().unique(),

    status: text("status")
      .notNull()
      .$type<"pending" | "accepted" | "expired" | "revoked" | "declined">()
      .default("pending"),

    expiresAt: timestamp("expires_at").notNull(),

    acceptedAt: timestamp("accepted_at"),

    acceptedByUserId: text("accepted_by_user_id").references(
      () => usersTable.clerkId,
      { onDelete: "cascade" },
    ),

    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("invitations_token_idx").on(table.token),

    uniqueIndex("invitations_inviter_invited_idx").on(
      table.inviterId,
      table.invitedEmail,
    ),
  ],
).enableRLS();

// Zod schemas
export const insertUserSchema = createInsertSchema(usersTable).omit({
  createdAt: true,
});

// Use Drizzle's native insert type
export type InsertUser = typeof usersTable.$inferInsert;
export type User = typeof usersTable.$inferSelect;

export const insertTeammateSchema = createInsertSchema(teammatesTable).omit({
  id: true,
  createdAt: true,
});

// Use Drizzle's native insert type
export type InsertTeammate = typeof teammatesTable.$inferInsert;
export type Teammate = typeof teammatesTable.$inferSelect;

export const insertInvitationSchema = createInsertSchema(invitationsTable).omit(
  {
    id: true,
    createdAt: true,
    acceptedAt: true,
    acceptedByUserId: true,
  },
);

// Use Drizzle's native insert type
export type InsertInvitation = typeof invitationsTable.$inferInsert;
export type Invitation = typeof invitationsTable.$inferSelect;

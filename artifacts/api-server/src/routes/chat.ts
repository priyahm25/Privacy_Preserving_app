import { Router, type Request, type Response } from "express";
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db, chatKeysTable, chatMessagesTable, conversationsTable, notificationsTable, teammatesTable, userDeviceKeysTable, usersTable } from "@workspace/db";
import { getClerkId, requireAuth } from "../middlewares/auth";
import { makeNotificationEvent } from "../lib/notificationEvents";
import { persistedNotificationColumns, queuePushNotifications } from "../lib/pushNotifications";

const router = Router();
router.use(requireAuth);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const b64 = (v: unknown, min: number, max: number) => typeof v === "string" && v.length >= min && v.length <= max && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(v);
const fail = (res: Response, error: unknown, message: string) => { console.error(message, error); return res.status(500).json({ error: message }); };
async function displayName(executor: Pick<typeof db, "select">, userId: string): Promise<string> {
  const [u] = await executor.select({ name: usersTable.name, email: usersTable.email }).from(usersTable).where(eq(usersTable.clerkId, userId)).limit(1);
  return u?.name?.trim() || u?.email.split("@")[0] || "A teammate";
}
async function membership(conversationId: string, userId: string) {
  const [conversation] = await db.select().from(conversationsTable).where(and(eq(conversationsTable.id, conversationId), or(eq(conversationsTable.participantAId, userId), eq(conversationsTable.participantBId, userId)))).limit(1);
  return conversation;
}

router.post("/conversations", async (req: Request, res: Response) => {
  try {
    const userId = getClerkId(req); const peerId = typeof req.body?.participantId === "string" ? req.body.participantId : "";
    if (!peerId || peerId === userId || peerId.length > 128) return res.status(400).json({ error: "A different teammate is required." });
    const [friend] = await db.select({ id: teammatesTable.id }).from(teammatesTable).where(and(eq(teammatesTable.userId, userId), eq(teammatesTable.teammateUserId, peerId))).limit(1);
    if (!friend) return res.status(403).json({ error: "Conversation participants must be accepted teammates." });
    const [a] = [userId, peerId].sort();
    const [conversation] = await db.insert(conversationsTable).values({ participantAId: a, participantBId: a === userId ? peerId : userId }).onConflictDoNothing().returning();
    if (conversation) return res.status(201).json(await conversationSummary(conversation, userId));
    const [existing] = await db.select().from(conversationsTable).where(and(eq(conversationsTable.participantAId, a), eq(conversationsTable.participantBId, a === userId ? peerId : userId))).limit(1);
    return existing ? res.json(await conversationSummary(existing, userId)) : res.status(500).json({ error: "Could not create conversation." });
  } catch (error) { return fail(res, error, "Could not create conversation."); }
});

async function conversationSummary(c: typeof conversationsTable.$inferSelect, userId: string) {
  const peerId = c.participantAId === userId ? c.participantBId : c.participantAId;
  const [peer] = await db.select({ clerkId: usersTable.clerkId, name: usersTable.name, email: usersTable.email }).from(usersTable).where(eq(usersTable.clerkId, peerId)).limit(1);
  const [last] = await db.select({ createdAt: chatMessagesTable.createdAt }).from(chatMessagesTable).where(eq(chatMessagesTable.conversationId, c.id)).orderBy(desc(chatMessagesTable.createdAt)).limit(1);
  return { id: c.id, participant: peer, createdAt: c.createdAt, updatedAt: c.updatedAt, lastMessageAt: last?.createdAt ?? null };
}

router.get("/conversations", async (req: Request, res: Response) => {
  try {
    const userId = getClerkId(req);
    const rows = await db.select().from(conversationsTable).where(or(eq(conversationsTable.participantAId, userId), eq(conversationsTable.participantBId, userId)));
    const summaries = await Promise.all(rows.map((c) => conversationSummary(c, userId)));
    summaries.sort((a, b) => new Date(b.lastMessageAt ?? b.createdAt).getTime() - new Date(a.lastMessageAt ?? a.createdAt).getTime());
    return res.json({ conversations: summaries });
  } catch (error) { return fail(res, error, "Could not list conversations."); }
});

router.get("/conversations/:id/participants", async (req: Request, res: Response) => {
  try {
    const userId = getClerkId(req); const id = String(req.params.id);
    if (!UUID.test(id)) return res.status(400).json({ error: "Invalid conversation id." });
    const c = await membership(id, userId); if (!c) return res.status(404).json({ error: "Conversation not found." });
    const people = await db.select({ clerkId: usersTable.clerkId, name: usersTable.name, email: usersTable.email }).from(usersTable).where(inArray(usersTable.clerkId, [c.participantAId, c.participantBId]));
    return res.json({ participants: people });
  } catch (error) { return fail(res, error, "Could not retrieve participants."); }
});

router.get("/conversations/:id/messages", async (req: Request, res: Response) => {
  try {
    const userId = getClerkId(req); const id = String(req.params.id);
    if (!UUID.test(id)) return res.status(400).json({ error: "Invalid conversation id." });
    const c = await membership(id, userId); if (!c) return res.status(404).json({ error: "Conversation not found." });
    const devices = await db.select({ id: userDeviceKeysTable.id }).from(userDeviceKeysTable).where(and(eq(userDeviceKeysTable.userId, userId), isNull(userDeviceKeysTable.revokedAt)));
    const messages = await db.select().from(chatMessagesTable).where(eq(chatMessagesTable.conversationId, id)).orderBy(asc(chatMessagesTable.createdAt)).limit(300);
    const result = await Promise.all(messages.map(async (m) => {
      const [senderKey] = await db.select({ publicKey: userDeviceKeysTable.publicKey }).from(userDeviceKeysTable).where(eq(userDeviceKeysTable.id, m.senderDeviceKeyId)).limit(1);
      const keyRows = devices.length ? await db.select().from(chatKeysTable).where(and(eq(chatKeysTable.messageId, m.id), inArray(chatKeysTable.deviceKeyId, devices.map((d) => d.id)))) : [];
      return { id: m.id, senderId: m.senderId, senderDeviceKeyId: m.senderDeviceKeyId, senderDevicePublicKey: senderKey?.publicKey ?? null, ciphertext: m.ciphertext, iv: m.iv, createdAt: m.createdAt, deliveredAt: m.deliveredAt, readAt: m.readAt, replyToMessageId: m.replyToMessageId, keyCopies: keyRows.map((k) => ({ deviceKeyId: k.deviceKeyId, wrappedKey: k.wrappedKey, wrappingIv: k.wrappingIv })) };
    }));
    // Delivery receipt is timestamped server-side when the recipient fetches.
    if (messages.some((m) => m.senderId !== userId && m.deliveredAt === null)) await db.update(chatMessagesTable).set({ deliveredAt: new Date() }).where(and(eq(chatMessagesTable.conversationId, id), ne(chatMessagesTable.senderId, userId), isNull(chatMessagesTable.deliveredAt)));
    // Opening the conversation clears its "new message" notification.
    await db.update(notificationsTable).set({ read: true, readAt: new Date() }).where(and(eq(notificationsTable.recipientUserId, userId), eq(notificationsTable.dedupeKey, `chat_message:${id}`), isNull(notificationsTable.readAt)));
    return res.json({ messages: result });
  } catch (error) { return fail(res, error, "Could not retrieve messages."); }
});

router.post("/conversations/:id/messages", async (req: Request, res: Response) => {
  try {
    const userId = getClerkId(req); const id = String(req.params.id); const body = req.body ?? {};
    if (!UUID.test(id) || !UUID.test(body.id) || (body.replyToMessageId != null && !UUID.test(body.replyToMessageId))) return res.status(400).json({ error: "Invalid message or conversation id." });
    const c = await membership(id, userId); if (!c) return res.status(404).json({ error: "Conversation not found." });
    if (!b64(body.ciphertext, 24, 30_000) || !b64(body.iv, 16, 16) || !UUID.test(body.senderDeviceKeyId) || !Array.isArray(body.keyCopies) || body.keyCopies.length < 1 || body.keyCopies.length > 100) return res.status(400).json({ error: "Invalid encrypted message payload." });
    if (body.keyCopies.some((k: any) => !UUID.test(k?.deviceKeyId) || !b64(k?.wrappedKey, 64, 256) || !b64(k?.wrappingIv, 16, 16))) return res.status(400).json({ error: "Invalid wrapped message key." });
    const [senderKey] = await db.select({ id: userDeviceKeysTable.id }).from(userDeviceKeysTable).where(and(eq(userDeviceKeysTable.id, body.senderDeviceKeyId), eq(userDeviceKeysTable.userId, userId), isNull(userDeviceKeysTable.revokedAt))).limit(1);
    if (!senderKey) return res.status(403).json({ error: "Sender device key is not active." });
    const expectedDevices = await db.select({ id: userDeviceKeysTable.id, userId: userDeviceKeysTable.userId }).from(userDeviceKeysTable).where(and(inArray(userDeviceKeysTable.userId, [c.participantAId, c.participantBId]), isNull(userDeviceKeysTable.revokedAt)));
    const expected = new Set(expectedDevices.map((d) => d.id)); const supplied = new Set(body.keyCopies.map((k: any) => k.deviceKeyId));
    if (supplied.size !== body.keyCopies.length || supplied.size !== expected.size || [...expected].some((key) => !supplied.has(key))) return res.status(400).json({ error: "A wrapped key is required for every active participant device." });
    if (body.replyToMessageId) {
      const [reply] = await db.select({ id: chatMessagesTable.id }).from(chatMessagesTable).where(and(eq(chatMessagesTable.id, body.replyToMessageId), eq(chatMessagesTable.conversationId, id))).limit(1);
      if (!reply) return res.status(400).json({ error: "Reply target is not in this conversation." });
    }
    const recipientId = c.participantAId === userId ? c.participantBId : c.participantAId;
    const { message, notification } = await db.transaction(async (tx) => {
      const [created] = await tx.insert(chatMessagesTable).values({ id: body.id, conversationId: id, senderId: userId, senderDeviceKeyId: body.senderDeviceKeyId, ciphertext: body.ciphertext, iv: body.iv, replyToMessageId: body.replyToMessageId ?? null }).returning();
      await tx.insert(chatKeysTable).values(body.keyCopies.map((k: any) => ({ messageId: created.id, deviceKeyId: k.deviceKeyId, wrappedKey: k.wrappedKey, wrappingIv: k.wrappingIv })));
      await tx.update(conversationsTable).set({ updatedAt: new Date() }).where(eq(conversationsTable.id, id));
      // One notification per conversation, re-surfaced as unread on each new
      // message, so a busy chat does not flood the list. Server-authored text
      // only; the encrypted payload never touches the notification. A savepoint
      // keeps a notification failure from losing the message itself.
      const event = makeNotificationEvent({ recipientUserId: recipientId, actorUserId: userId, actorName: await displayName(tx, userId),
        type: "chat_message", resourceType: "conversation", resourceId: id });
      const notification = event ? await tx.transaction(async (sp) => {
        const [row] = await sp.insert(notificationsTable).values(event).onConflictDoUpdate({
          target: [notificationsTable.recipientUserId, notificationsTable.dedupeKey],
          targetWhere: sql`${notificationsTable.dedupeKey} is not null`,
          set: { read: false, readAt: null, createdAt: new Date(), actorUserId: userId, message: event.message },
        }).returning(persistedNotificationColumns);
        return row;
      }).catch((error) => { console.error("Could not record chat notification.", (error as { code?: unknown })?.code); return undefined; }) : undefined;
      return { message: created, notification };
    });
    queuePushNotifications([notification]);
    return res.status(201).json({ id: message.id, createdAt: message.createdAt });
  } catch (error) { return fail(res, error, "Could not send encrypted message."); }
});

router.patch("/messages/:id/read", async (req: Request, res: Response) => {
  try {
    const userId = getClerkId(req); const id = String(req.params.id); if (!UUID.test(id)) return res.status(400).json({ error: "Invalid message id." });
    const [m] = await db.select({ conversationId: chatMessagesTable.conversationId, senderId: chatMessagesTable.senderId }).from(chatMessagesTable).where(eq(chatMessagesTable.id, id)).limit(1);
    if (!m || m.senderId === userId || !await membership(m.conversationId, userId)) return res.status(404).json({ error: "Message not found." });
    await db.update(chatMessagesTable).set({ deliveredAt: new Date(), readAt: new Date() }).where(eq(chatMessagesTable.id, id));
    return res.json({ ok: true });
  } catch (error) { return fail(res, error, "Could not update message status."); }
});

export default router;

import { useAuthenticatedApi } from "./authenticatedApi";
import { useMemo } from "react";
import type { ChatDeviceKey } from "./deviceKeys";

export interface ChatParticipant { clerkId: string; name: string | null; email: string }
export interface Conversation { id: string; participant: ChatParticipant; createdAt: string; updatedAt: string; lastMessageAt: string | null }
export interface EncryptedMessage { id: string; senderId: string; senderDeviceKeyId: string; senderDevicePublicKey: JsonWebKey | string | null; ciphertext: string; iv: string; createdAt: string; deliveredAt: string | null; readAt: string | null; replyToMessageId: string | null; keyCopies: { deviceKeyId: string; wrappedKey: string; wrappingIv: string }[] }

export function useChatApi() {
  const { request } = useAuthenticatedApi();
  const parse = async <T,>(response: Response, fallback: string): Promise<T> => {
    if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || fallback); }
    return response.json() as Promise<T>;
  };
  return useMemo(() => ({
    listConversations: async () => (await parse<{ conversations: Conversation[] }>(await request("/api/chat/conversations"), "Could not load chats.")).conversations,
    listTeammates: async () => (await parse<{ teammates: ChatParticipant[] }>(await request("/api/teammates/list"), "Could not load teammates.")).teammates,
    createConversation: async (participantId: string) => parse<Conversation>(await request("/api/chat/conversations", { method: "POST", body: JSON.stringify({ participantId }) }), "Could not start chat."),
    getMyDevice: async (publicKey: JsonWebKey): Promise<ChatDeviceKey> => parse(await request("/api/keys/register", { method: "POST", body: JSON.stringify({ publicKey }) }), "Could not register this device."),
    getDevices: async (userId: string): Promise<ChatDeviceKey[]> => (await parse<{ devices: ChatDeviceKey[] }>(await request(`/api/keys/teammates/${encodeURIComponent(userId)}/devices`), "Could not load teammate devices.")).devices,
    getOwnDevices: async (): Promise<ChatDeviceKey[]> => (await parse<{ devices: ChatDeviceKey[] }>(await request("/api/keys/devices"), "Could not load your devices.")).devices,
    getMessages: async (conversationId: string) => (await parse<{ messages: EncryptedMessage[] }>(await request(`/api/chat/conversations/${conversationId}/messages`), "Could not load messages.")).messages,
    sendMessage: async (conversationId: string, payload: object) => parse(await request(`/api/chat/conversations/${conversationId}/messages`, { method: "POST", body: JSON.stringify(payload) }), "Could not send message."),
    markRead: async (messageId: string) => request(`/api/chat/messages/${messageId}/read`, { method: "PATCH" }),
  }), [request]);
}

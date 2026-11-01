import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useUser } from "@clerk/expo";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { useChatApi, type Conversation, type EncryptedMessage, type ChatParticipant } from "@/lib/chatApi";
import { decryptChatMessage, encryptChatMessage, ensureDeviceKey } from "@/lib/deviceKeys";

type DisplayMessage = EncryptedMessage & { plaintext: string; decryptError?: boolean };
export default function Chat() {
  const colors = useColors(); const insets = useSafeAreaInsets(); const { user } = useUser(); const api = useChatApi(); const { refreshNotificationCount } = useApp();
  const [conversations, setConversations] = useState<Conversation[]>([]); const [teammates, setTeammates] = useState<ChatParticipant[]>([]);
  const [active, setActive] = useState<Conversation | null>(null); const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [draft, setDraft] = useState(""); const [loading, setLoading] = useState(true); const [working, setWorking] = useState(false); const [error, setError] = useState(""); const [compose, setCompose] = useState(false);
  const refresh = useCallback(async () => {
    // Teammates come from the Team feature and must not disappear when the chat API fails.
    const [cs, ts] = await Promise.allSettled([api.listConversations(), api.listTeammates()]);
    if (cs.status === "fulfilled") setConversations(cs.value);
    if (ts.status === "fulfilled") setTeammates(ts.value);
    const failed = [cs, ts].find((r): r is PromiseRejectedResult => r.status === "rejected");
    setError(failed ? (failed.reason instanceof Error ? failed.reason.message : "Could not load chats.") : "");
    setLoading(false);
  }, [api]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (compose) api.listTeammates().then(setTeammates).catch((e) => setError(e instanceof Error ? e.message : "Could not load teammates."));
  }, [compose, api]);
  // Opened from a notification: load the latest list (the chat may be new) and open it.
  const { conversationId } = useLocalSearchParams<{ conversationId?: string }>();
  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    api.listConversations().then((cs) => {
      if (cancelled) return;
      setConversations(cs);
      const match = cs.find((c) => c.id === conversationId);
      if (match) { setCompose(false); setActive(match); setError(""); }
      else setError("That conversation is no longer available.");
    }).catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Could not load chats."); })
      .finally(() => { if (!cancelled) router.setParams({ conversationId: undefined }); });
    return () => { cancelled = true; };
  }, [conversationId, api]);

  const refreshMessages = useCallback(async (conversation: Conversation) => {
    if (!user?.id) return;
    try {
      const [raw, ownDevices, ownKey] = await Promise.all([api.getMessages(conversation.id), api.getOwnDevices(), ensureDeviceKey(user.id)]);
      const localKey = ownKey.publicKey;
      const device = ownDevices.find((d) => {
        const serverKey = typeof d.publicKey === "string" ? JSON.parse(d.publicKey) as JsonWebKey : d.publicKey;
        return serverKey.kty === localKey.kty && serverKey.crv === localKey.crv && serverKey.x === localKey.x && serverKey.y === localKey.y;
      });
      if (!device) throw new Error("This device is not registered. Sign out and back in to provision its secure key.");
      const decoded = await Promise.all(raw.map(async (message) => {
        const keyCopy = message.keyCopies.find((k) => k.deviceKeyId === device.id);
        if (!keyCopy || !message.senderDevicePublicKey) return { ...message, plaintext: "Unable to decrypt this message.", decryptError: true };
        try { const plaintext = await decryptChatMessage(user.id, { ...message, ...keyCopy, senderDevicePublicKey: message.senderDevicePublicKey }); return { ...message, plaintext }; }
        catch { return { ...message, plaintext: "Unable to decrypt this message.", decryptError: true }; }
      }));
      setMessages(decoded);
      for (const m of raw) if (m.senderId !== user.id && !m.readAt) void api.markRead(m.id);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load messages."); }
  }, [api, user?.id]);
  useEffect(() => {
    if (!active) return;
    // The first fetch marks this conversation's notification read on the server.
    void refreshMessages(active).then(refreshNotificationCount);
    const timer = setInterval(() => void refreshMessages(active), 5000);
    return () => clearInterval(timer);
  }, [active, refreshMessages, refreshNotificationCount]);

  const startChat = async (person: ChatParticipant) => {
    setWorking(true); setError("");
    try { const conversation = await api.createConversation(person.clerkId); setCompose(false); setActive(conversation); void refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not start chat."); }
    finally { setWorking(false); }
  };
  const send = async () => {
    const text = draft.trim(); if (!active || !user?.id || !text || working) return;
    setWorking(true); setError("");
    try {
      const local = await ensureDeviceKey(user.id); const own = await api.getMyDevice(local.publicKey);
      const [ownDevices, peerDevices] = await Promise.all([api.getOwnDevices(), api.getDevices(active.participant.clerkId)]);
      const encrypted = await encryptChatMessage(user.id, own.id, [...ownDevices, ...peerDevices], text);
      await api.sendMessage(active.id, { id: encrypted.clientMessageId, senderDeviceKeyId: own.id, ciphertext: encrypted.ciphertext, iv: encrypted.iv, keyCopies: encrypted.keyCopies });
      setDraft(""); await refreshMessages(active); void refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not send message."); }
    finally { setWorking(false); }
  };

  const renderConversation = ({ item }: { item: Conversation }) => (
    <Pressable onPress={() => { setActive(item); setError(""); }} style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.avatar, { backgroundColor: `${colors.primary}20` }]}><Ionicons name="person" size={22} color={colors.primary} /></View>
      <View style={styles.grow}><Text style={[styles.name, { color: colors.foreground }]}>{item.participant.name || item.participant.email}</Text><Text style={[styles.meta, { color: colors.mutedForeground }]} numberOfLines={1}>{item.participant.email}</Text></View>
      <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
    </Pressable>
  );
  const headerTop = Platform.OS === "web" ? 16 : insets.top + 8;
  return <View style={[styles.container, { backgroundColor: colors.background }]}>
    <View style={[styles.header, { paddingTop: headerTop }]}><View><Text style={[styles.title, { color: colors.foreground }]}>Secure Chat</Text><Text style={[styles.meta, { color: colors.mutedForeground }]}>End-to-end encrypted messages</Text></View><Pressable onPress={() => setCompose(true)} style={[styles.add, { backgroundColor: colors.primary }]}><Ionicons name="add" size={24} color={colors.primaryForeground} /></Pressable></View>
    {error && !active && <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text>}
    {loading ? <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} /> : conversations.length === 0 ? <View style={styles.empty}><Ionicons name="lock-closed-outline" size={54} color={colors.primary} /><Text style={[styles.name, { color: colors.foreground, marginTop: 16 }]}>No conversations yet</Text><Text style={[styles.meta, { color: colors.mutedForeground, textAlign: "center", marginTop: 6 }]}>Start an encrypted conversation with an accepted teammate.</Text><Pressable onPress={() => setCompose(true)} style={[styles.button, { backgroundColor: colors.primary }]}><Text style={{ color: colors.primaryForeground, fontWeight: "600" }}>Start a chat</Text></Pressable></View> : <FlatList data={conversations} keyExtractor={(item) => item.id} renderItem={renderConversation} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100, gap: 10 }} />}
    <Modal visible={compose} animationType="slide" onRequestClose={() => setCompose(false)}><View style={[styles.modal, { backgroundColor: colors.background, paddingTop: headerTop }]}><View style={styles.modalHeader}><Text style={[styles.title, { color: colors.foreground }]}>New conversation</Text><Pressable onPress={() => setCompose(false)}><Ionicons name="close" size={26} color={colors.foreground} /></Pressable></View>{working && <ActivityIndicator color={colors.primary} />}{error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}{teammates.length === 0 ? <Text style={[styles.meta, { color: colors.mutedForeground, margin: 20 }]}>No accepted teammates found.</Text> : <FlatList data={teammates} keyExtractor={(item) => item.clerkId} renderItem={({ item }) => <Pressable disabled={working} onPress={() => void startChat(item)} style={[styles.row, { borderColor: colors.border }]}><View style={[styles.avatar, { backgroundColor: `${colors.primary}20` }]}><Ionicons name="person" size={20} color={colors.primary} /></View><View style={styles.grow}><Text style={[styles.name, { color: colors.foreground }]}>{item.name || item.email}</Text><Text style={[styles.meta, { color: colors.mutedForeground }]}>{item.email}</Text></View><Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} /></Pressable>} contentContainerStyle={{ padding: 16, gap: 8 }} />}</View></Modal>
    <Modal visible={!!active} animationType="slide" onRequestClose={() => setActive(null)}><KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={[styles.modal, { backgroundColor: colors.background, paddingTop: headerTop }]}><View style={styles.modalHeader}><Pressable onPress={() => setActive(null)}><Ionicons name="arrow-back" size={23} color={colors.foreground} /></Pressable><View style={styles.grow}><Text style={[styles.name, { color: colors.foreground }]}>{active?.participant.name || active?.participant.email}</Text><Text style={[styles.meta, { color: colors.mutedForeground }]}>Encrypted conversation</Text></View><Ionicons name="lock-closed" size={19} color={colors.primary} /></View>
      <ScrollView style={styles.messageList} contentContainerStyle={styles.messageContent}>{messages.length === 0 ? <Text style={[styles.meta, { color: colors.mutedForeground, textAlign: "center", marginTop: 28 }]}>Messages are encrypted on your device. Say hello.</Text> : messages.map((m) => { const mine = m.senderId === user?.id; return <View key={m.id} style={[styles.bubble, { alignSelf: mine ? "flex-end" : "flex-start", backgroundColor: mine ? colors.primary : colors.card, borderColor: colors.border }]}><Text style={{ color: mine ? colors.primaryForeground : colors.foreground }}>{m.plaintext}</Text><View style={styles.statusRow}><Text style={{ color: mine ? colors.primaryForeground : colors.mutedForeground, fontSize: 10 }}>{new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text>{mine && <Text style={{ color: mine ? colors.primaryForeground : colors.mutedForeground, fontSize: 10 }}>{m.readAt ? " · Read" : m.deliveredAt ? " · Delivered" : " · Sent"}</Text>}</View></View>; })}</ScrollView>
      {error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}<View style={[styles.composer, { borderColor: colors.border }]}><TextInput value={draft} onChangeText={setDraft} placeholder="Write an encrypted message…" placeholderTextColor={colors.mutedForeground} multiline maxLength={10_000} style={[styles.input, { color: colors.foreground, borderColor: colors.border }]} /><Pressable onPress={() => void send()} disabled={!draft.trim() || working} style={[styles.send, { backgroundColor: draft.trim() && !working ? colors.primary : colors.muted }]}>{working ? <ActivityIndicator size="small" color={colors.primaryForeground} /> : <Ionicons name="send" size={18} color={colors.primaryForeground} />}</Pressable></View>
    </KeyboardAvoidingView></Modal>
  </View>;
}

const styles = StyleSheet.create({ container: { flex: 1 }, header: { paddingHorizontal: 20, paddingBottom: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, title: { fontSize: 25, fontFamily: "Inter_700Bold" }, meta: { fontSize: 13, fontFamily: "Inter_400Regular" }, add: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" }, row: { minHeight: 72, padding: 12, borderWidth: 1, borderRadius: 14, flexDirection: "row", alignItems: "center", gap: 12 }, avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" }, grow: { flex: 1 }, name: { fontSize: 15, fontFamily: "Inter_600SemiBold" }, empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40 }, button: { marginTop: 22, borderRadius: 12, paddingHorizontal: 22, paddingVertical: 13 }, modal: { flex: 1 }, modalHeader: { minHeight: 56, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: StyleSheet.hairlineWidth }, messageList: { flex: 1 }, messageContent: { padding: 14, gap: 10 }, bubble: { maxWidth: "82%", padding: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: 16 }, statusRow: { flexDirection: "row", justifyContent: "flex-end", marginTop: 4 }, composer: { flexDirection: "row", padding: 10, gap: 8, borderTopWidth: 1, alignItems: "flex-end" }, input: { flex: 1, minHeight: 44, maxHeight: 120, borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10 }, send: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" }, error: { marginHorizontal: 16, marginBottom: 8, fontSize: 13 }, });

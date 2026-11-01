import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { formatBytes, SecureFileRecord, useFilesApi } from "@/lib/filesApi";

type Tab = "byMe" | "byOthers";
type ConfirmAction = "ownerDeleteMe" | "deleteEveryone" | "recipientDeleteMe";
type Feedback = { tone: "success" | "error"; text: string };

const when = (date?: string) => (date ? new Date(date).toLocaleDateString() : "");

export default function Shared() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const api = useFilesApi();
  const apiRef = useRef(api);
  apiRef.current = api;

  const [tab, setTab] = useState<Tab>("byMe");
  const [owned, setOwned] = useState<SecureFileRecord[]>([]);
  const [received, setReceived] = useState<SecureFileRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [menuFor, setMenuFor] = useState<SecureFileRecord | null>(null);
  const [rename, setRename] = useState<{ file: SecureFileRecord; value: string } | null>(null);
  const [confirm, setConfirm] = useState<{ file: SecureFileRecord; action: ConfirmAction } | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const data = await apiRef.current.listFiles();
      // Shared by Me: owned files that have recipients and the owner hasn't hidden.
      setOwned(data.owned.filter((file) => (file.shares?.length ?? 0) > 0 && !file.hiddenFromShared));
      setReceived(data.sharedWithMe);
    } catch {
      setError("Could not load shared files.");
    }
  }, []);

  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  const files = tab === "byMe" ? owned : received;
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const closeMenu = () => setMenuFor(null);

  const startRename = (file: SecureFileRecord) => {
    closeMenu();
    setFeedback(null);
    setRename({ file, value: file.name });
  };

  const submitRename = async () => {
    if (!rename || busy) return;
    const value = rename.value.trim();
    if (!value) {
      setFeedback({ tone: "error", text: "The name cannot be empty." });
      return;
    }
    setBusy(true);
    try {
      if (tab === "byMe") {
        await apiRef.current.renameFile(rename.file.id, value);
      } else {
        await apiRef.current.setDisplayName(rename.file.id, value);
      }
      setRename(null);
      await refresh();
      setFeedback({ tone: "success", text: "File renamed." });
    } catch (e) {
      setFeedback({ tone: "error", text: e instanceof Error ? e.message : "Could not rename the file." });
    } finally {
      setBusy(false);
    }
  };

  const runConfirm = async () => {
    if (!confirm || busy) return;
    setBusy(true);
    try {
      if (confirm.action === "ownerDeleteMe") {
        await apiRef.current.hideFromShared(confirm.file.id);
      } else if (confirm.action === "recipientDeleteMe") {
        await apiRef.current.removeSharedWithMe(confirm.file.id);
      } else {
        await apiRef.current.deleteFile(confirm.file.id);
      }
      setConfirm(null);
      await refresh();
      setFeedback({
        tone: "success",
        text: confirm.action === "deleteEveryone" ? "File deleted and all access revoked." : "Removed from your list.",
      });
    } catch (e) {
      setFeedback({ tone: "error", text: e instanceof Error ? e.message : "The action could not be completed." });
    } finally {
      setBusy(false);
    }
  };

  const confirmCopy = useMemo(() => {
    if (!confirm) return null;
    const name = confirm.file.name;
    if (confirm.action === "deleteEveryone") {
      return {
        title: "Delete for everyone?",
        body: `This permanently deletes "${name}" and revokes access for all recipients. They will no longer be able to open or download it. This cannot be undone.`,
        cta: "Delete for Everyone",
        danger: true,
      };
    }
    if (confirm.action === "ownerDeleteMe") {
      return {
        title: "Remove from your shared list?",
        body: `"${name}" will be hidden from your Shared by Me list. Recipients keep their access and the file stays in your My Files.`,
        cta: "Delete for Me",
        danger: false,
      };
    }
    return {
      title: "Remove this shared file?",
      body: `You will lose access to "${name}". The owner's file and other people's access are not affected.`,
      cta: "Delete for Me",
      danger: false,
    };
  }, [confirm]);

  const renderItem = ({ item }: { item: SecureFileRecord }) => (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Pressable style={styles.cardMain} onPress={() => router.push(`/file-details/${item.id}`)}>
        <Ionicons name="lock-closed" size={22} color={colors.primary} />
        <View style={styles.grow}>
          <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>{item.name}</Text>
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>
            {item.type.toUpperCase()} · {formatBytes(item.sizeBytes)}
          </Text>
          {tab === "byMe" ? (
            <Text style={[styles.detail, { color: colors.mutedForeground }]} numberOfLines={1}>
              {item.shares?.length === 1
                ? `Shared with ${item.shares[0].name || item.shares[0].email} · ${item.shares[0].permission}`
                : `Shared with ${item.shares?.length ?? 0} teammates`}
            </Text>
          ) : (
            <Text style={[styles.detail, { color: colors.mutedForeground }]} numberOfLines={1}>
              Shared by {item.sharedBy?.name || item.sharedBy?.email} · {item.permission} · {when(item.sharedAt)}
            </Text>
          )}
        </View>
      </Pressable>
      <TouchableOpacity
        accessibilityLabel="File actions"
        onPress={() => { setFeedback(null); setMenuFor(item); }}
        hitSlop={8}
        style={styles.menuBtn}
      >
        <Ionicons name="ellipsis-vertical" size={18} color={colors.mutedForeground} />
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.icon, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Ionicons name="arrow-back" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.foreground }]}>Shared Files</Text>
        <View style={styles.icon} />
      </View>

      <View style={[styles.tabs, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {([["byMe", "Shared by Me"], ["byOthers", "Shared by Others"]] as const).map(([value, label]) => (
          <TouchableOpacity key={value} onPress={() => setTab(value)} style={[styles.tab, tab === value && { backgroundColor: colors.primary }]}>
            <Text style={[styles.tabText, { color: tab === value ? colors.primaryForeground : colors.mutedForeground }]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.listHeader}>
        <Text style={[styles.count, { color: colors.mutedForeground }]}>
          {files.length} file{files.length !== 1 ? "s" : ""}
        </Text>
        {feedback && (
          <Text style={[styles.feedback, { color: feedback.tone === "success" ? colors.success : colors.destructive }]} numberOfLines={1}>
            {feedback.text}
          </Text>
        )}
      </View>

      <FlatList
        data={files}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={renderItem}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="share-social-outline" size={48} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              {error || (tab === "byMe" ? "Not sharing any files" : "No files shared with you")}
            </Text>
            {error && (
              <TouchableOpacity onPress={() => void refresh()}>
                <Text style={[styles.retry, { color: colors.primary }]}>Try again</Text>
              </TouchableOpacity>
            )}
          </View>
        }
      />

      {/* Action sheet */}
      <Modal visible={!!menuFor} transparent animationType="fade" onRequestClose={closeMenu}>
        <Pressable style={styles.backdrop} onPress={closeMenu}>
          <Pressable style={[styles.sheet, { backgroundColor: colors.background, borderColor: colors.border, paddingBottom: insets.bottom + 12 }]} onPress={() => {}}>
            <View style={styles.sheetHandleWrap}><View style={[styles.sheetHandle, { backgroundColor: colors.border }]} /></View>
            <Text style={[styles.sheetTitle, { color: colors.foreground }]} numberOfLines={1}>{menuFor?.name}</Text>

            <TouchableOpacity style={styles.action} onPress={() => menuFor && startRename(menuFor)}>
              <Ionicons name="create-outline" size={20} color={colors.foreground} />
              <Text style={[styles.actionText, { color: colors.foreground }]}>
                {tab === "byMe" ? "Rename" : "Rename (only you see this)"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.action}
              onPress={() => { const f = menuFor; closeMenu(); if (f) setConfirm({ file: f, action: tab === "byMe" ? "ownerDeleteMe" : "recipientDeleteMe" }); }}
            >
              <Ionicons name="remove-circle-outline" size={20} color={colors.foreground} />
              <Text style={[styles.actionText, { color: colors.foreground }]}>Delete for Me</Text>
            </TouchableOpacity>

            {tab === "byMe" && (
              <TouchableOpacity
                style={styles.action}
                onPress={() => { const f = menuFor; closeMenu(); if (f) setConfirm({ file: f, action: "deleteEveryone" }); }}
              >
                <Ionicons name="trash-outline" size={20} color={colors.destructive} />
                <Text style={[styles.actionText, { color: colors.destructive }]}>Delete for Everyone</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={[styles.cancel, { borderColor: colors.border }]} onPress={closeMenu}>
              <Text style={[styles.cancelText, { color: colors.foreground }]}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Rename */}
      <Modal visible={!!rename} transparent animationType="fade" onRequestClose={() => !busy && setRename(null)}>
        <Pressable style={styles.backdrop} onPress={() => !busy && setRename(null)}>
          <Pressable style={[styles.dialog, { backgroundColor: colors.background, borderColor: colors.border }]} onPress={() => {}}>
            <Text style={[styles.dialogTitle, { color: colors.foreground }]}>
              {tab === "byMe" ? "Rename file" : "Rename for yourself"}
            </Text>
            <Text style={[styles.dialogBody, { color: colors.mutedForeground }]}>
              {tab === "byMe"
                ? "Recipients will see the new name. The file extension is kept."
                : "Only you see this name. The owner and other recipients are not affected."}
            </Text>
            <TextInput
              value={rename?.value ?? ""}
              onChangeText={(value) => setRename((prev) => (prev ? { ...prev, value } : prev))}
              placeholder="File name"
              placeholderTextColor={colors.mutedForeground}
              editable={!busy}
              autoFocus
              style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
              onSubmitEditing={() => void submitRename()}
            />
            <View style={styles.dialogActions}>
              <TouchableOpacity style={[styles.dialogBtn, { borderColor: colors.border }]} disabled={busy} onPress={() => setRename(null)}>
                <Text style={[styles.dialogBtnText, { color: colors.foreground }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.dialogBtn, { backgroundColor: colors.primary, borderColor: colors.primary }]} disabled={busy} onPress={() => void submitRename()}>
                {busy ? <ActivityIndicator size="small" color={colors.primaryForeground} /> : <Text style={[styles.dialogBtnText, { color: colors.primaryForeground }]}>Save</Text>}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Confirm destructive action */}
      <Modal visible={!!confirm} transparent animationType="fade" onRequestClose={() => !busy && setConfirm(null)}>
        <Pressable style={styles.backdrop} onPress={() => !busy && setConfirm(null)}>
          <Pressable style={[styles.dialog, { backgroundColor: colors.background, borderColor: colors.border }]} onPress={() => {}}>
            <Text style={[styles.dialogTitle, { color: colors.foreground }]}>{confirmCopy?.title}</Text>
            <Text style={[styles.dialogBody, { color: colors.mutedForeground }]}>{confirmCopy?.body}</Text>
            <View style={styles.dialogActions}>
              <TouchableOpacity style={[styles.dialogBtn, { borderColor: colors.border }]} disabled={busy} onPress={() => setConfirm(null)}>
                <Text style={[styles.dialogBtnText, { color: colors.foreground }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.dialogBtn, confirmCopy?.danger ? { backgroundColor: colors.destructive, borderColor: colors.destructive } : { backgroundColor: colors.primary, borderColor: colors.primary }]}
                disabled={busy}
                onPress={() => void runConfirm()}
              >
                {busy ? <ActivityIndicator size="small" color={colors.primaryForeground} /> : <Text style={[styles.dialogBtnText, { color: colors.primaryForeground }]}>{confirmCopy?.cta}</Text>}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingBottom: 16 },
  icon: { width: 40, height: 40, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 20, fontFamily: "Inter_700Bold" },
  tabs: { flexDirection: "row", marginHorizontal: 20, borderRadius: 12, borderWidth: 1, padding: 4, marginBottom: 12 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: "center" },
  tabText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  listHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, marginBottom: 8, gap: 12 },
  count: { fontSize: 13, fontFamily: "Inter_400Regular" },
  feedback: { fontSize: 13, fontFamily: "Inter_500Medium", flexShrink: 1 },
  list: { paddingHorizontal: 20, paddingBottom: 28 },
  card: { flexDirection: "row", alignItems: "center", borderRadius: 14, borderWidth: 1, paddingLeft: 14, marginBottom: 10 },
  cardMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14 },
  grow: { flex: 1 },
  name: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  meta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 3 },
  detail: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 5 },
  menuBtn: { paddingHorizontal: 14, paddingVertical: 18, alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", paddingTop: 60, gap: 12 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  retry: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", paddingHorizontal: 24 },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, paddingHorizontal: 20, paddingTop: 8 },
  sheetHandleWrap: { alignItems: "center", paddingVertical: 8 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2 },
  sheetTitle: { fontSize: 15, fontFamily: "Inter_700Bold", marginBottom: 8 },
  action: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 15 },
  actionText: { fontSize: 15, fontFamily: "Inter_500Medium" },
  cancel: { marginTop: 8, borderWidth: 1, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  cancelText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  dialog: { borderRadius: 18, borderWidth: 1, padding: 22, gap: 14 },
  dialogTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  dialogBody: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21 },
  input: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, height: 48, fontSize: 15, fontFamily: "Inter_400Regular" },
  dialogActions: { flexDirection: "row", gap: 12, marginTop: 4 },
  dialogBtn: { flex: 1, height: 48, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  dialogBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});

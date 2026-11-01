import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useUser } from "@clerk/expo";
import { useColors } from "@/hooks/useColors";
import { retrieveKeySecurely } from "@/lib/encryption";
import { ensureDeviceKey, wrapFileKey } from "@/lib/deviceKeys";
import { formatBytes, SecureFileRecord, TeammateSummary, useFilesApi } from "@/lib/filesApi";

type Progress = "idle" | "preparing" | "fetching" | "wrapping" | "creating" | "done" | "error";

export default function ShareFile() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const params = useLocalSearchParams<{ fileId?: string }>();
  const api = useFilesApi();
  const [files, setFiles] = useState<SecureFileRecord[]>([]);
  const [teammates, setTeammates] = useState<TeammateSummary[]>([]);
  const [fileId, setFileId] = useState<string | null>(params.fileId ?? null);
  const [teammateId, setTeammateId] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  useEffect(() => {
    let active = true;
    Promise.all([api.listFiles(), api.listTeammates()]).then(([listed, team]) => {
      if (!active) return;
      setFiles(listed.owned.filter((file) => file.encrypted));
      setTeammates(team);
    }).catch(() => active && setMessage("Could not load files and teammates.") );
    return () => { active = false; };
  // API functions are request-bound and intentionally loaded once per screen visit.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const share = useCallback(async () => {
    if (!fileId || !teammateId || !user?.id || progress !== "idle") return;
    try {
      setMessage(null);
      setProgress("preparing");
      const fileKey = await retrieveKeySecurely(fileId);
      if (!fileKey) throw new Error("This file’s local encryption key is unavailable on this device. It cannot be shared from here.");
      setProgress("fetching");
      const localDevice = await ensureDeviceKey(user.id);
      const [ownerKey, recipientKey] = await Promise.all([api.getMyDeviceKey(localDevice.publicKey), api.getTeammateDeviceKey(teammateId)]);
      setProgress("wrapping");
      const wrapped = await wrapFileKey(user.id, recipientKey.publicKey as JsonWebKey, fileId, fileKey);
      setProgress("creating");
      await api.createSecureShare(fileId, {
        recipientId: teammateId,
        recipientDeviceKeyId: recipientKey.id,
        ownerDeviceKeyId: ownerKey.id,
        ...wrapped,
      });
      setProgress("done");
      setMessage("Share successful. The encrypted file was not uploaded again.");
    } catch (error) {
      setProgress("error");
      setMessage(error instanceof Error ? error.message : "Could not create the secure share.");
    }
  }, [api, fileId, progress, teammateId, user?.id]);

  const selectedFile = files.find((file) => file.id === fileId);
  const running = ["preparing", "fetching", "wrapping", "creating"].includes(progress);
  const status = progress === "preparing" ? "Preparing secure share…" : progress === "fetching" ? "Fetching teammate key…" : progress === "wrapping" ? "Wrapping encryption key locally…" : progress === "creating" ? "Creating secure share…" : null;

  return <View style={[styles.container, { backgroundColor: colors.background }]}>
    <View style={[styles.header, { paddingTop: topPad + 16 }]}>
      <TouchableOpacity onPress={() => router.back()} style={[styles.back, { backgroundColor: colors.card, borderColor: colors.border }]}><Ionicons name="arrow-back" size={20} color={colors.foreground} /></TouchableOpacity>
      <Text style={[styles.title, { color: colors.foreground }]}>Share Encrypted File</Text><View style={styles.back} />
    </View>
    <FlatList
      data={files}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={<><Text style={[styles.heading, { color: colors.foreground }]}>Select file</Text><Text style={[styles.help, { color: colors.mutedForeground }]}>Choose an existing encrypted file. It will not be scanned, encrypted, or uploaded again.</Text></>}
      renderItem={({ item }) => <TouchableOpacity disabled={running} onPress={() => setFileId(item.id)} style={[styles.choice, { backgroundColor: colors.card, borderColor: fileId === item.id ? colors.primary : colors.border }]}><Ionicons name="lock-closed" size={20} color={colors.primary} /><View style={styles.grow}><Text style={[styles.name, { color: colors.foreground }]}>{item.name}</Text><Text style={[styles.meta, { color: colors.mutedForeground }]}>{item.type.toUpperCase()} · {formatBytes(item.sizeBytes)} · Encrypted</Text></View>{fileId === item.id && <Ionicons name="checkmark-circle" size={20} color={colors.primary} />}</TouchableOpacity>}
      ListEmptyComponent={<Text style={[styles.help, { color: colors.mutedForeground }]}>No encrypted uploads are available on this device.</Text>}
      ListFooterComponent={<View><Text style={[styles.heading, { color: colors.foreground }]}>Share with</Text>{teammates.map((person) => <TouchableOpacity key={person.clerkId} disabled={running} onPress={() => setTeammateId(person.clerkId)} style={[styles.choice, { backgroundColor: colors.card, borderColor: teammateId === person.clerkId ? colors.primary : colors.border }]}><Ionicons name="person" size={20} color={colors.primary} /><View style={styles.grow}><Text style={[styles.name, { color: colors.foreground }]}>{person.name || person.email}</Text><Text style={[styles.meta, { color: colors.mutedForeground }]}>{person.email}</Text></View>{teammateId === person.clerkId && <Ionicons name="checkmark-circle" size={20} color={colors.primary} />}</TouchableOpacity>)}</View>}
      contentContainerStyle={styles.content}
    />
    <View style={[styles.footer, { backgroundColor: colors.background, borderTopColor: colors.border }]}>{message && <Text style={[styles.message, { color: progress === "error" ? colors.destructive : colors.success }]}>{message}</Text>}{running && <View style={styles.status}><ActivityIndicator color={colors.primary} /><Text style={[styles.help, { color: colors.mutedForeground }]}>{status}</Text></View>}<TouchableOpacity disabled={!selectedFile || !teammateId || running || progress === "done"} onPress={() => void share()} style={[styles.share, { backgroundColor: selectedFile && teammateId && !running && progress !== "done" ? colors.primary : colors.muted }]}><Ionicons name="shield-checkmark" size={18} color={colors.primaryForeground} /><Text style={[styles.shareText, { color: colors.primaryForeground }]}>{progress === "done" ? "Shared Securely" : "Share Securely"}</Text></TouchableOpacity></View>
  </View>;
}

const styles = StyleSheet.create({ container: { flex: 1 }, header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 16 }, back: { width: 40, height: 40, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" }, title: { fontSize: 18, fontFamily: "Inter_700Bold" }, content: { padding: 20, gap: 10, paddingBottom: 24 }, heading: { fontSize: 17, fontFamily: "Inter_700Bold", marginTop: 10 }, help: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19, marginBottom: 8 }, choice: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, borderWidth: 1, marginBottom: 10 }, grow: { flex: 1 }, name: { fontSize: 15, fontFamily: "Inter_600SemiBold" }, meta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 3 }, footer: { padding: 20, borderTopWidth: 1, gap: 10 }, status: { flexDirection: "row", alignItems: "center", gap: 8 }, message: { fontSize: 13, fontFamily: "Inter_500Medium" }, share: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8, paddingVertical: 15, borderRadius: 14 }, shareText: { fontSize: 15, fontFamily: "Inter_600SemiBold" } });

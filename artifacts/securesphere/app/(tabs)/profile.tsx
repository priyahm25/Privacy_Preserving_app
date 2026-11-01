import { useClerk } from "@clerk/expo";

import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Alert,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useApp } from "@/context/AppContext";
import { UserAvatar } from "@/components/UserCard";
import { SecurityScore } from "@/components/SecurityScore";
import { useProfileApi, type ProfileSummary } from "@/lib/profileApi";
import { calculateSecurityScore, formatStorageBytes, type SecurityCheck } from "@/lib/profileSecurity";
import { useAuthenticatedApi } from "@/lib/authenticatedApi";
import { unregisterPushToken } from "@/lib/pushNotifications";

const MENU_ITEMS = [
  {
    icon: "settings-outline",
    label: "Settings",
    route: "/settings",
    color: "#7A9BB5",
  },
  {
    icon: "sparkles-outline",
    label: "AI Assistant",
    route: "/ai-assistant",
    color: "#FF8C00",
  },
  {
    icon: "people-outline",
    label: "Members & Collaboration",
    route: "/members",
    color: "#0066FF",
  },
  {
    icon: "share-social-outline",
    label: "Shared Files",
    route: "/shared",
    color: "#B44FFF",
  },
  {
    icon: "notifications-outline",
    label: "Notifications",
    route: "/notifications",
    color: "#00D4FF",
  },
  {
    icon: "shield-checkmark-outline",
    label: "Security Settings",
    route: "/settings",
    color: "#00E676",
  },
] as const;

export default function Profile() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { currentUser, isAuthenticated } = useApp();
  const profileApi = useProfileApi();
  const [summary, setSummary] = useState<ProfileSummary | null>(null);
  const [deviceStatus, setDeviceStatus] = useState<"passed" | "failed" | "unknown">("unknown");
  const [summaryError, setSummaryError] = useState(false);
  const [loading, setLoading] = useState(true);
  const { signOut } = useClerk();
  const { request } = useAuthenticatedApi();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  useFocusEffect(useCallback(() => {
    let active = true;
    setLoading(true);
    setSummaryError(false);
    if (!isAuthenticated) {
      setSummary(null);
      setDeviceStatus("unknown");
      setLoading(false);
      return () => { active = false; };
    }
    void Promise.allSettled([profileApi.getSummary(), profileApi.checkDeviceKey(currentUser.id)]).then(([summaryResult, keyResult]) => {
      if (!active) return;
      if (summaryResult.status === "fulfilled") setSummary(summaryResult.value);
      else { setSummary(null); setSummaryError(true); }
      setDeviceStatus(keyResult.status === "fulfilled" ? keyResult.value : "unknown");
      setLoading(false);
    });
    return () => { active = false; };
  }, [isAuthenticated, currentUser.id]));

  const calculated = calculateSecurityScore({
    deviceKey: deviceStatus,
    fileCount: summary ? summary.files.count : null,
    encryptedFileCount: summary?.files.encryptedCount ?? null,
    shareCount: summary?.shares.count ?? null,
    wrappedShareCount: summary?.shares.wrappedKeyCount ?? null,
  });

  const handleLogout = async () => {
    console.log("Logout started");

    try {
      // Before signOut, while the session can still authenticate the request.
      await unregisterPushToken(request);
      await signOut();

      console.log("Signed out successfully");

      router.replace("/auth/login");
    } catch (err) {
      console.log("Logout Error:");
      console.log(err);

      Alert.alert("Error", JSON.stringify(err));
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.orbTL} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingBottom: Platform.OS === "web" ? 84 : 100,
        }}
      >
        {/* Hero gradient header */}
        <LinearGradient
          colors={["#0D1B2A", "#050B18"]}
          style={[styles.profileHeader, { paddingTop: topPad + 24 }]}
        >
          <View style={styles.avatarRow}>
            <UserAvatar
              name={currentUser.name}
              color={currentUser.avatarColor}
              size={72}
            />
            <TouchableOpacity
              style={[styles.editBtn, { borderColor: colors.border }]}
            >
              <Ionicons name="pencil" size={16} color={colors.primary} />
            </TouchableOpacity>
          </View>
          <Text style={[styles.profileName, { color: colors.foreground }]}>
            {currentUser.name}
          </Text>
          <Text
            style={[styles.profileEmail, { color: colors.mutedForeground }]}
          >
            {currentUser.email}
          </Text>
          <View
            style={[
              styles.planBadge,
              {
                backgroundColor: "rgba(0,212,255,0.12)",
                borderColor: "rgba(0,212,255,0.3)",
              },
            ]}
          >
            <Ionicons name="diamond" size={12} color={colors.primary} />
            <Text style={[styles.planText, { color: colors.primary }]}>
              Pro Plan
            </Text>
          </View>
        </LinearGradient>

        <View style={styles.content}>
          {/* Score + Storage row */}
          <View style={styles.metricsRow}>
            <View
              style={[
                styles.metricCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Text
                style={[styles.metricLabel, { color: colors.mutedForeground }]}
              >
                Security Score
              </Text>
                {calculated.score === null ? <Text style={[styles.unknownValue, { color: colors.mutedForeground }]}>—</Text> : <SecurityScore score={calculated.score} size={110} />}
                <Text style={[styles.checkDetail, { color: colors.mutedForeground }]}>verified points out of 100</Text>
            </View>
            <View
              style={[
                styles.metricCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Text
                style={[styles.metricLabel, { color: colors.mutedForeground }]}
              >
                Storage Used
              </Text>
              <Text style={[styles.storageValue, { color: colors.foreground }]}>{summary ? formatStorageBytes(summary.storageBytes) : "—"}</Text>
              <Text style={[styles.storageTotal, { color: colors.mutedForeground }]}>{summary ? "bytes stored" : loading ? "Loading account data…" : "Unavailable"}</Text>
            </View>
          </View>

          <View style={[styles.securityBreakdown, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.breakdownTitle, { color: colors.foreground }]}>Security checks</Text>
            {calculated.checks.map((check: SecurityCheck) => (
              <View key={check.id} style={styles.checkRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.checkLabel, { color: colors.foreground }]}>{check.label}</Text>
                  <Text style={[styles.checkDetail, { color: colors.mutedForeground }]}>{check.detail}</Text>
                </View>
                <Text style={[styles.checkStatus, { color: check.status === "passed" ? colors.primary : check.status === "failed" ? colors.destructive : colors.mutedForeground }]}>{check.status === "passed" ? `+${check.points}` : check.status === "not_applicable" ? "N/A" : `0/${check.points}`} · {check.status.replaceAll("_", " ")}</Text>
              </View>
            ))}
            {summaryError && <Text style={[styles.checkDetail, { color: colors.warning }]}>Account security and storage metadata could not be loaded.</Text>}
          </View>

          {/* Menu */}
          <View style={styles.menuSection}>
            {MENU_ITEMS.map((item) => (
              <TouchableOpacity
                key={item.label}
                onPress={() => router.push(item.route as any)}
                activeOpacity={0.75}
                style={[
                  styles.menuItem,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <View
                  style={[
                    styles.menuIconBg,
                    { backgroundColor: `${item.color}18` },
                  ]}
                >
                  <Ionicons
                    name={item.icon as any}
                    size={20}
                    color={item.color}
                  />
                </View>
                <Text style={[styles.menuLabel, { color: colors.foreground }]}>
                  {item.label}
                </Text>
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color={colors.mutedForeground}
                />
              </TouchableOpacity>
            ))}
          </View>

          {/* Logout */}
          <TouchableOpacity
            onPress={handleLogout}
            style={[
              styles.logoutBtn,
              {
                backgroundColor: "rgba(255,59,92,0.08)",
                borderColor: "rgba(255,59,92,0.25)",
              },
            ]}
          >
            <Ionicons
              name="log-out-outline"
              size={20}
              color={colors.destructive}
            />
            <Text style={[styles.logoutText, { color: colors.destructive }]}>
              Sign Out
            </Text>
          </TouchableOpacity>

          <Text style={[styles.version, { color: colors.mutedForeground }]}>
            SecureSphere v1.0.0 · Privacy-first
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  orbTL: {
    position: "absolute",
    top: -60,
    right: -60,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: "rgba(0,212,255,0.04)",
  },
  profileHeader: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingBottom: 28,
    gap: 10,
  },
  avatarRow: { position: "relative" },
  editBtn: {
    position: "absolute",
    bottom: 0,
    right: -4,
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: "#0D1B2A",
    alignItems: "center",
    justifyContent: "center",
  },
  profileName: { fontSize: 24, fontFamily: "Inter_700Bold", marginTop: 4 },
  profileEmail: { fontSize: 14, fontFamily: "Inter_400Regular" },
  planBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  planText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  content: { paddingHorizontal: 20, paddingTop: 20, gap: 16 },
  metricsRow: { flexDirection: "row", gap: 12 },
  metricCard: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    alignItems: "center",
    gap: 6,
  },
  metricLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  storageValue: { fontSize: 26, fontFamily: "Inter_700Bold", marginTop: 8 },
  storageTotal: { fontSize: 12, fontFamily: "Inter_400Regular" },
  storageBar: {
    width: "100%",
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
    marginTop: 4,
  },
  unknownValue: { fontSize: 36, fontFamily: "Inter_700Bold", lineHeight: 110 },
  securityBreakdown: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 12 },
  breakdownTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  checkLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  checkDetail: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  checkStatus: { fontSize: 10, fontFamily: "Inter_600SemiBold", textTransform: "capitalize" },
  menuSection: { gap: 8 },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
  },
  menuIconBg: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  menuLabel: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium" },
  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 4,
  },
  logoutText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  version: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginTop: 4,
  },
});

import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  Platform,
  Alert,
  ActivityIndicator,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useAuth, useUser } from "@clerk/expo";
import { UserAvatar } from "@/components/UserCard";
import * as Haptics from "expo-haptics";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";

interface Teammate {
  clerkId: string;
  email: string;
  name?: string;
  createdAt: string;
}

interface InvitationData {
  id: string;
  token: string;
  invitedEmail: string;
  inviterName: string;
  inviterEmail: string;
  status: string;
  expiresAt?: string;
}

type DisplayItem = Teammate | InvitationData;

const SECTION_TABS = ["My Teammates", "Pending"] as const;
type SectionTab = (typeof SECTION_TABS)[number];

export default function Members() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, isLoaded: isUserLoaded } = useUser();
  const { getToken, isLoaded: isAuthLoaded, isSignedIn } = useAuth();
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<SectionTab>("My Teammates");
  const [teammates, setTeammates] = useState<Teammate[]>([]);
  const [invitations, setInvitations] = useState<InvitationData[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const botPad = Platform.OS === "web" ? 34 : insets.bottom;

  // Fetch teammates and invitations
  const fetchData = async () => {
    if (!user?.id || !isUserLoaded || !isAuthLoaded || !isSignedIn) return;

    try {
      setLoading(true);
      const token = await getToken();
      if (!token) {
        throw new Error("Clerk session token is unavailable.");
      }

      const tmResponse = await fetch(`${API_BASE_URL}/api/teammates/list`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const invResponse = await fetch(
        `${API_BASE_URL}/api/teammates/invitations/pending`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      // Report failures instead of showing an empty list that looks like
      // "no teammates".
      const errors: string[] = [];
      if (tmResponse.ok) {
        const tmData = await tmResponse.json();
        setTeammates(tmData.teammates || []);
      } else {
        const body = await tmResponse.json().catch(() => ({}));
        errors.push(body?.error || `Could not load teammates (${tmResponse.status}).`);
      }
      if (invResponse.ok) {
        const invData = await invResponse.json();
        setInvitations(invData.invitations || []);
      } else {
        const body = await invResponse.json().catch(() => ({}));
        errors.push(body?.error || `Could not load invitations (${invResponse.status}).`);
      }
      setLoadError(errors.length ? errors.join("\n") : null);
    } catch (err) {
      console.error("Error fetching teammates:", err);
      setLoadError(
        err instanceof Error ? err.message : "Could not reach the server.",
      );
    } finally {
      setLoading(false);
    }
  };

  // Fetch on screen focus
  useFocusEffect(
    React.useCallback(() => {
      if (isUserLoaded && user?.id) {
        fetchData();
      }
    }, [user?.id, isUserLoaded]),
  );

  const filteredTeammates = teammates.filter(
    (t) =>
      t.name?.toLowerCase().includes(search.toLowerCase()) ||
      t.email.toLowerCase().includes(search.toLowerCase()),
  );

  const filteredInvitations = invitations.filter(
    (inv) =>
      inv.inviterName?.toLowerCase().includes(search.toLowerCase()) ||
      inv.inviterEmail?.toLowerCase().includes(search.toLowerCase()),
  );

  const handleInvitePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push("/invite-teammate");
  };

  const handleAcceptInvitation = async (invitationToken: string) => {
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      const token = await getToken();
      if (!token) {
        Alert.alert("Error", "Clerk session token is unavailable.");
        return;
      }

      const response = await fetch(`${API_BASE_URL}/api/teammates/accept`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token: invitationToken }),
      });

      if (response.ok) {
        Alert.alert("Success", "Invitation accepted! You are now teammates.");
        fetchData();
      } else {
        const errorData = await response.json().catch(() => ({}));
        Alert.alert("Error", errorData?.error || "Failed to accept invitation");
      }
    } catch (err) {
      console.error("Error accepting invitation:", err);
      Alert.alert("Error", "Failed to accept invitation");
    }
  };

  const handleDeclineInvitation = async (invitationToken: string) => {
    try {
      const token = await getToken();
      if (!token) {
        Alert.alert("Error", "Clerk session token is unavailable.");
        return;
      }

      const response = await fetch(`${API_BASE_URL}/api/teammates/reject`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token: invitationToken }),
      });

      if (response.ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        fetchData();
      } else {
        const errorData = await response.json().catch(() => ({}));
        Alert.alert("Error", errorData?.error || "Failed to decline invitation");
      }
    } catch (err) {
      console.error("Error declining invitation:", err);
      Alert.alert("Error", "Failed to decline invitation");
    }
  };

  const handleRemoveTeammate = (teammate: Teammate) => {
    Alert.alert(
      "Remove Teammate",
      `Remove ${teammate.name || teammate.email} from your teammates?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            setTeammates((prev) =>
              prev.filter((t) => t.clerkId !== teammate.clerkId),
            );
          },
        },
      ],
    );
  };

  const renderTeammate = ({ item }: { item: Teammate }) => (
    <View
      style={[
        styles.userCard,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={styles.avatarWrap}>
        <UserAvatar name={item.name || item.email} color="#0066FF" size={46} />
      </View>

      <View style={styles.userInfo}>
        <Text style={[styles.userName, { color: colors.foreground }]}>
          {item.name || item.email.split("@")[0]}
        </Text>
        <Text
          style={[styles.userEmail, { color: colors.mutedForeground }]}
          numberOfLines={1}
        >
          {item.email}
        </Text>
      </View>

      <TouchableOpacity
        onPress={() => handleRemoveTeammate(item)}
        style={[styles.actionIconBtn, { borderColor: colors.border }]}
      >
        <Ionicons name="person-remove" size={16} color={colors.destructive} />
      </TouchableOpacity>
    </View>
  );

  const renderInvitation = ({ item }: { item: InvitationData }) => (
    <View
      style={[
        styles.userCard,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={styles.avatarWrap}>
        <UserAvatar name={item.inviterName} color="#B44FFF" size={46} />
      </View>

      <View style={styles.userInfo}>
        <Text style={[styles.userName, { color: colors.foreground }]}>
          {item.inviterName}
        </Text>
        <Text
          style={[styles.userEmail, { color: colors.mutedForeground }]}
          numberOfLines={1}
        >
          {item.inviterEmail}
        </Text>
      </View>

      <TouchableOpacity
        onPress={() => handleAcceptInvitation(item.token)}
        style={[
          styles.actionIconBtn,
          {
            borderColor: colors.border,
            backgroundColor: "rgba(0,230,118,0.1)",
          },
        ]}
      >
        <Ionicons name="checkmark" size={16} color={colors.success} />
      </TouchableOpacity>

      <TouchableOpacity
        onPress={() => handleDeclineInvitation(item.token)}
        style={[styles.actionIconBtn, { borderColor: colors.border }]}
      >
        <Ionicons name="close" size={16} color={colors.destructive} />
      </TouchableOpacity>
    </View>
  );

  const displayData: DisplayItem[] =
    activeTab === "My Teammates" ? filteredTeammates : filteredInvitations;
  const emptyMessage =
    activeTab === "My Teammates"
      ? "No teammates yet"
      : "No pending invitations";
  const emptySubtext =
    activeTab === "My Teammates"
      ? "Invite people you work with to collaborate securely."
      : "You don't have any pending teammate invitations.";

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.orbTL} />
      <View style={[styles.header, { paddingTop: topPad + 8 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[
            styles.backBtn,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Ionicons name="arrow-back" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.foreground }]}>
          Teammates
        </Text>
        <TouchableOpacity
          onPress={handleInvitePress}
          style={[styles.backBtn, { backgroundColor: colors.primary }]}
        >
          <Ionicons
            name="person-add"
            size={18}
            color={colors.primaryForeground}
          />
        </TouchableOpacity>
      </View>

      {/* Stats bar */}
      <View style={styles.statsBar}>
        {[
          {
            label: "Teammates",
            count: teammates.length,
            color: colors.primary,
          },
          {
            label: "Pending",
            count: invitations.length,
            color: colors.warning,
          },
        ].map((stat) => (
          <View
            key={stat.label}
            style={[
              styles.statItem,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <Text style={[styles.statCount, { color: stat.color }]}>
              {stat.count}
            </Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
              {stat.label}
            </Text>
          </View>
        ))}
      </View>

      {/* Search */}
      <View
        style={[
          styles.searchBar,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <Ionicons name="search" size={18} color={colors.mutedForeground} />
        <TextInput
          style={[styles.searchInput, { color: colors.foreground }]}
          value={search}
          onChangeText={setSearch}
          placeholder="Search teammates..."
          placeholderTextColor={colors.mutedForeground}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch("")}>
            <Ionicons
              name="close-circle"
              size={18}
              color={colors.mutedForeground}
            />
          </TouchableOpacity>
        )}
      </View>

      {/* Tabs */}
      <View style={styles.tabsRow}>
        {SECTION_TABS.map((tab) => (
          <TouchableOpacity
            key={tab}
            onPress={() => setActiveTab(tab)}
            style={[
              styles.tabChip,
              activeTab === tab
                ? {
                    backgroundColor: colors.primary,
                    borderColor: colors.primary,
                  }
                : { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text
              style={[
                styles.tabText,
                {
                  color:
                    activeTab === tab
                      ? colors.primaryForeground
                      : colors.mutedForeground,
                },
              ]}
            >
              {tab}
            </Text>
            {tab === "Pending" && invitations.length > 0 && (
              <View
                style={[
                  styles.tabBadge,
                  {
                    backgroundColor:
                      activeTab === tab ? "#050B18" : colors.warning,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.tabBadgeText,
                    {
                      color: activeTab === tab ? colors.warning : "#FFFFFF",
                    },
                  ]}
                >
                  {invitations.length}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        ))}
      </View>

      {loadError && !loading && (
        <TouchableOpacity onPress={fetchData} style={styles.errorBanner}>
          <Text style={[styles.errorText, { color: colors.destructive }]}>
            {loadError} Tap to retry.
          </Text>
        </TouchableOpacity>
      )}

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : displayData.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons
            name="people-outline"
            size={48}
            color={colors.mutedForeground}
          />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            {emptyMessage}
          </Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            {emptySubtext}
          </Text>
          {activeTab === "My Teammates" && (
            <TouchableOpacity
              onPress={handleInvitePress}
              style={[styles.inviteButton, { backgroundColor: colors.primary }]}
            >
              <Ionicons
                name="person-add"
                size={16}
                color={colors.primaryForeground}
              />
              <Text
                style={[
                  styles.inviteButtonText,
                  { color: colors.primaryForeground },
                ]}
              >
                Invite Teammate
              </Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <FlatList<DisplayItem>
          data={displayData}
          keyExtractor={(item) => ("clerkId" in item ? item.clerkId : item.id)}
          contentContainerStyle={[styles.list, { paddingBottom: botPad + 24 }]}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) =>
            activeTab === "My Teammates"
              ? renderTeammate({ item: item as Teammate })
              : renderInvitation({ item: item as InvitationData })
          }
        />
      )}
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
    backgroundColor: "rgba(0,102,255,0.05)",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 14,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 20, fontFamily: "Inter_700Bold" },
  statsBar: {
    flexDirection: "row",
    paddingHorizontal: 20,
    gap: 10,
    marginBottom: 14,
  },
  statItem: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  statCount: { fontSize: 22, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 20,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    height: 46,
    gap: 10,
    marginBottom: 12,
  },
  searchInput: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  tabsRow: {
    flexDirection: "row",
    paddingHorizontal: 20,
    gap: 8,
    marginBottom: 12,
  },
  tabChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
  },
  tabText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  tabBadge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  tabBadgeText: { fontSize: 10, fontFamily: "Inter_700Bold" },
  list: { paddingHorizontal: 20, gap: 10 },
  userCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    gap: 12,
  },
  avatarWrap: { position: "relative" },
  userInfo: { flex: 1, gap: 4 },
  userName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  userEmail: { fontSize: 12, fontFamily: "Inter_400Regular" },
  actionIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  empty: { alignItems: "center", paddingTop: 60, gap: 12 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  emptyText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  inviteButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    gap: 8,
    marginTop: 20,
  },
  inviteButtonText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  errorBanner: { marginHorizontal: 20, marginBottom: 12 },
  errorText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});

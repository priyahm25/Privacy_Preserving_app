import React, { useCallback, useRef, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Platform, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { AppNotification, useNotificationsApi } from '@/lib/notificationsApi';

function getNotificationIcon(type: AppNotification['type']): { icon: string; color: string } {
  switch (type) {
    case 'file_shared': return { icon: 'share-social', color: '#0066FF' };
    case 'collaboration_invite': return { icon: 'person-add', color: '#00D4FF' };
    case 'collaboration_accepted': return { icon: 'checkmark-circle', color: '#00E676' };
    default: return { icon: 'notifications', color: '#FF8C00' };
  }
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diff = (now.getTime() - date.getTime()) / 1000;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

export default function Notifications() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const api = useNotificationsApi();
  const apiRef = useRef(api);
  apiRef.current = api;
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const botPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const refresh = useCallback(async () => {
    try { setError(null); setNotifications(await apiRef.current.getNotifications()); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load notifications.'); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(timer);
  }, [refresh]));
  const markAllRead = async () => {
    try { await apiRef.current.markAllRead(); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not update notifications.'); }
  };
  const markRead = async (item: AppNotification) => {
    try {
      if (!item.readAt) { await apiRef.current.markRead(item.id); await refresh(); }
      if (item.resourceType === 'file' && item.resourceId) router.push(`/file-details/${item.resourceId}`);
      else if (item.resourceType === 'invitation') router.push('/members');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not update notification.'); }
  };

  const unreadCount = notifications.filter(n => !n.readAt).length;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.orbTL} />
      <View style={[styles.header, { paddingTop: topPad + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Ionicons name="arrow-back" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <View>
          <Text style={[styles.title, { color: colors.foreground }]}>Notifications</Text>
          {unreadCount > 0 && (
            <Text style={[styles.unreadLabel, { color: colors.mutedForeground }]}>{unreadCount} unread</Text>
          )}
        </View>
        <TouchableOpacity onPress={() => void markAllRead()} style={[styles.markAllBtn, { borderColor: colors.border }]}>
          <Text style={[styles.markAllText, { color: colors.primary }]}>Mark all read</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={notifications}
        keyExtractor={item => item.id}
        contentContainerStyle={[styles.list, { paddingBottom: botPad + 24 }]}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => {
          const iconInfo = getNotificationIcon(item.type);
          return (
            <TouchableOpacity
              onPress={() => void markRead(item)}
              activeOpacity={0.75}
              style={[
                styles.notifCard,
                {
                  backgroundColor: item.readAt ? colors.card : `${colors.primary}08`,
                  borderColor: item.readAt ? colors.border : `${colors.primary}30`,
                },
              ]}
            >
              <View style={[styles.notifIcon, { backgroundColor: `${iconInfo.color}18` }]}>
                <Ionicons name={iconInfo.icon as any} size={20} color={iconInfo.color} />
              </View>
              <View style={styles.notifContent}>
                <View style={styles.notifTitleRow}>
                  <Text style={[styles.notifTitle, { color: colors.foreground }]}>{item.actorName || 'SecureSphere'}</Text>
                  {!item.readAt && <View style={[styles.unreadDot, { backgroundColor: colors.primary }]} />}
                </View>
                <Text style={[styles.notifMessage, { color: colors.mutedForeground }]} numberOfLines={2}>
                  {item.message}
                </Text>
                <Text style={[styles.notifTime, { color: `${colors.mutedForeground}80` }]}>
                  {formatTime(item.createdAt)}
                </Text>
              </View>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            {loading ? <ActivityIndicator color={colors.primary} /> : null}
            <Ionicons name="notifications-off-outline" size={48} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>{error || (loading ? 'Loading notifications…' : 'No notifications')}</Text>
            {error && <TouchableOpacity onPress={() => void refresh()}><Text style={[styles.markAllText, { color: colors.primary }]}>Try again</Text></TouchableOpacity>}
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  orbTL: { position: 'absolute', top: -60, right: -60, width: 200, height: 200, borderRadius: 100, backgroundColor: 'rgba(0,212,255,0.04)' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 16 },
  backBtn: { width: 40, height: 40, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  unreadLabel: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  markAllBtn: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
  markAllText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  list: { paddingHorizontal: 20, gap: 10 },
  notifCard: { flexDirection: 'row', alignItems: 'flex-start', padding: 14, borderRadius: 14, borderWidth: 1, gap: 12 },
  notifIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  notifContent: { flex: 1, gap: 4 },
  notifTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  notifTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', flex: 1 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, marginLeft: 8 },
  notifMessage: { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 18 },
  notifTime: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  empty: { alignItems: 'center', paddingTop: 80, gap: 12 },
  emptyTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold' },
});

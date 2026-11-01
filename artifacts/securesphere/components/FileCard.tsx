import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { SecureFile, FileType } from '@/data/mockData';

function getFileIcon(type: FileType): { name: string; color: string } {
  switch (type) {
    case 'pdf': return { name: 'file-pdf-box', color: '#FF3B5C' };
    case 'docx': return { name: 'file-word', color: '#0066FF' };
    case 'pptx': return { name: 'file-powerpoint', color: '#FF8C00' };
    case 'xlsx': return { name: 'file-excel', color: '#00E676' };
    case 'image': return { name: 'file-image', color: '#B44FFF' };
    default: return { name: 'file-document', color: '#7A9BB5' };
  }
}

interface FileCardProps {
  file: SecureFile;
  onPress?: () => void;
  /** 'list' (default) is the full-width row; 'grid' is a compact vertical card. */
  layout?: 'list' | 'grid';
}

export function FileCard({ file, onPress, layout = 'list' }: FileCardProps) {
  const colors = useColors();
  const icon = getFileIcon(file.type);

  if (layout === 'grid') {
    return (
      <TouchableOpacity
        activeOpacity={0.75}
        onPress={onPress}
        style={[styles.gridCard, { backgroundColor: colors.card, borderColor: colors.border }]}
      >
        <View style={styles.gridTop}>
          <View style={[styles.gridIconBox, { backgroundColor: `${icon.color}18` }]}>
            <MaterialCommunityIcons name={icon.name as any} size={22} color={icon.color} />
          </View>
          {file.encrypted && (
            <View style={[styles.badge, { backgroundColor: 'rgba(0, 212, 255, 0.12)', borderColor: 'rgba(0, 212, 255, 0.25)' }]}>
              <Ionicons name="lock-closed" size={10} color={colors.primary} />
            </View>
          )}
        </View>
        <Text style={[styles.gridName, { color: colors.foreground }]} numberOfLines={2}>
          {file.name}
        </Text>
        <Text style={[styles.meta, { color: colors.mutedForeground }]} numberOfLines={1}>
          {file.size}
        </Text>
        <Text style={[styles.meta, { color: colors.mutedForeground }]} numberOfLines={1}>
          {file.modifiedAt}
        </Text>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={onPress}
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
    >
      <View style={[styles.iconBox, { backgroundColor: `${icon.color}18` }]}>
        <MaterialCommunityIcons name={icon.name as any} size={28} color={icon.color} />
      </View>

      <View style={styles.info}>
        <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
          {file.name}
        </Text>
        <Text style={[styles.meta, { color: colors.mutedForeground }]}>
          {file.size} · {file.modifiedAt}
        </Text>
      </View>

      <View style={styles.badges}>
        {file.encrypted && (
          <View style={[styles.badge, { backgroundColor: 'rgba(0, 212, 255, 0.12)', borderColor: 'rgba(0, 212, 255, 0.25)' }]}>
            <Ionicons name="lock-closed" size={10} color={colors.primary} />
          </View>
        )}
        {file.shared && (
          <View style={[styles.badge, { backgroundColor: 'rgba(0, 102, 255, 0.12)', borderColor: 'rgba(0, 102, 255, 0.25)' }]}>
            <Ionicons name="people" size={10} color={colors.accent} />
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 10,
    gap: 12,
  },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: {
    flex: 1,
    gap: 4,
  },
  name: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
  meta: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  badges: {
    flexDirection: 'row',
    gap: 6,
  },
  badge: {
    width: 24,
    height: 24,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridCard: {
    flex: 1,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    gap: 6,
  },
  gridTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  gridIconBox: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridName: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    minHeight: 34,
  },
});

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, Platform, Modal, Pressable, ScrollView, useWindowDimensions } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { FileCard } from '@/components/FileCard';
import { SecureFile, FileType } from '@/data/mockData';
import { formatBytes, SecureFileRecord, useFilesApi } from '@/lib/filesApi';
import { applyFileView, gridColumns, type DateKey, type SortKey } from '@/lib/fileListView';

const FILTERS: { label: string; type: FileType | 'all' }[] = [
  { label: 'All', type: 'all' },
  { label: 'PDF', type: 'pdf' },
  { label: 'DOCX', type: 'docx' },
  { label: 'PPTX', type: 'pptx' },
  { label: 'XLSX', type: 'xlsx' },
  { label: 'Images', type: 'image' },
];

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'newest', label: 'Newest First' },
  { key: 'oldest', label: 'Oldest First' },
  { key: 'name-asc', label: 'Name A–Z' },
  { key: 'name-desc', label: 'Name Z–A' },
  { key: 'size-desc', label: 'Largest File First' },
  { key: 'size-asc', label: 'Smallest File First' },
];
const DEFAULT_SORT: SortKey = 'newest';

const DATE_RANGES: { key: DateKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: '3m', label: 'Last 3 months' },
  { key: 'custom', label: 'Custom date range' },
];

// A row keeps the raw metadata (ms timestamp, byte size) needed for date
// filtering and size sorting alongside the display strings FileCard renders.
type FileRow = SecureFile & { modifiedMs: number; createdMs: number; sizeBytes: number };

function toFileCard(record: SecureFileRecord): FileRow {
  const modified = new Date(record.modifiedAt);
  const created = new Date(record.createdAt);
  const modifiedMs = modified.getTime();

  return {
    id: record.id,
    name: record.name,
    type: record.type,
    size: formatBytes(record.sizeBytes),
    sizeBytes: record.sizeBytes,
    encrypted: record.encrypted,
    // This tab intentionally lists only files owned by the signed-in user.
    // Sharing status is not part of the upload metadata returned by /api/files.
    shared: false,
    ownerId: record.ownerId,
    sharedWith: [],
    createdAt: record.createdAt,
    createdMs: created.getTime(),
    modifiedMs: Number.isNaN(modifiedMs) ? 0 : modifiedMs,
    modifiedAt: Number.isNaN(modifiedMs) ? record.modifiedAt : modified.toLocaleDateString(),
  };
}

export default function Files() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { listFiles } = useFilesApi();
  const listFilesRef = useRef(listFiles);
  listFilesRef.current = listFiles;
  const [filter, setFilter] = useState<FileType | 'all'>('all');
  const [search, setSearch] = useState('');
  const [files, setFiles] = useState<FileRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Filter/sort/layout controls are independent, so switching any one of them
  // preserves the others.
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [sort, setSort] = useState<SortKey>(DEFAULT_SORT);
  const [dateKey, setDateKey] = useState<DateKey>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [showFilter, setShowFilter] = useState(false);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const loadOwnedFiles = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);

    try {
      const { owned } = await listFilesRef.current();
      setFiles(owned.map(toFileCard));
    } catch (error) {
      setFiles([]);
      setLoadError(error instanceof Error ? error.message : 'Could not load your files.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadOwnedFiles();
    }, [loadOwnedFiles]),
  );

  const dateActive = dateKey !== 'all';
  const filtersActive = dateActive || sort !== DEFAULT_SORT;

  const visible = useMemo(
    () => applyFileView(files, { typeFilter: filter, search, dateKey, customFrom, customTo, sort }),
    [files, filter, search, dateKey, customFrom, customTo, sort],
  );

  const numColumns = view === 'grid' ? gridColumns(width) : 1;

  // In grid mode, pad the last row with blank placeholders so cards keep a
  // consistent width instead of the final row stretching to fill the space.
  const gridData = useMemo(() => {
    if (view !== 'grid') return visible;
    const remainder = visible.length % numColumns;
    if (remainder === 0) return visible;
    return [...visible, ...Array.from({ length: numColumns - remainder }, (_, i) => ({ id: `__blank_${i}`, blank: true } as unknown as FileRow))];
  }, [visible, view, numColumns]);

  const clearFilters = () => {
    setSort(DEFAULT_SORT);
    setDateKey('all');
    setCustomFrom('');
    setCustomTo('');
  };

  const sortLabel = SORTS.find(s => s.key === sort)?.label ?? 'Sort';

  const renderFile = ({ item }: { item: FileRow & { blank?: boolean } }) => {
    if (view === 'grid') {
      if (item.blank) return <View style={{ flex: 1 }} />;
      return <FileCard file={item} layout="grid" />;
    }
    return <FileCard file={item} layout="list" />;
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.orbTL} />
      <View style={[styles.header, { paddingTop: topPad + 16 }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>My Files</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            accessibilityLabel="Filter and sort"
            onPress={() => setShowFilter(true)}
            style={[styles.iconBtn, { backgroundColor: colors.card, borderColor: filtersActive ? colors.primary : colors.border }]}
          >
            <Ionicons name="funnel-outline" size={18} color={filtersActive ? colors.primary : colors.foreground} />
            {filtersActive && <View style={[styles.activeDot, { backgroundColor: colors.primary, borderColor: colors.background }]} />}
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityLabel={view === 'list' ? 'Switch to grid view' : 'Switch to list view'}
            onPress={() => setView(v => (v === 'list' ? 'grid' : 'list'))}
            style={[styles.iconBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Ionicons name={view === 'list' ? 'grid-outline' : 'list-outline'} size={18} color={colors.foreground} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={[styles.searchBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Ionicons name="search" size={18} color={colors.mutedForeground} />
        <TextInput
          style={[styles.searchInput, { color: colors.foreground }]}
          value={search}
          onChangeText={setSearch}
          placeholder="Search files..."
          placeholderTextColor={colors.mutedForeground}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.filtersWrap}>
        <FlatList
          data={FILTERS}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={item => item.type}
          contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => setFilter(item.type)}
              style={[
                styles.filterChip,
                filter === item.type
                  ? { backgroundColor: colors.primary, borderColor: colors.primary }
                  : { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Text style={[
                styles.filterText,
                { color: filter === item.type ? colors.primaryForeground : colors.mutedForeground }
              ]}>
                {item.label}
              </Text>
            </TouchableOpacity>
          )}
        />
      </View>

      <View style={styles.listHeader}>
        <Text style={[styles.listCount, { color: colors.mutedForeground }]}>
          {visible.length} file{visible.length !== 1 ? 's' : ''}
        </Text>
        <TouchableOpacity onPress={() => setShowFilter(true)} style={styles.sortTrigger}>
          <Ionicons name="swap-vertical" size={14} color={colors.primary} />
          <Text style={[styles.sortText, { color: colors.primary }]}>{sortLabel}</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        // Remount when the column count changes; FlatList can't switch numColumns in place.
        key={`${view}-${numColumns}`}
        data={gridData}
        keyExtractor={item => item.id}
        renderItem={renderFile}
        numColumns={numColumns}
        columnWrapperStyle={numColumns > 1 ? { gap: 12, paddingHorizontal: 20 } : undefined}
        contentContainerStyle={{
          paddingHorizontal: numColumns > 1 ? 0 : 20,
          paddingBottom: Platform.OS === 'web' ? 84 : 90,
          gap: view === 'grid' ? 12 : 0,
        }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="documents-outline" size={48} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              {isLoading ? 'Loading files…' : loadError ? 'Could not load files' : 'No files found'}
            </Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              {loadError ?? (isLoading ? 'Fetching your encrypted file metadata' : dateActive || search || filter !== 'all' ? 'No files match the current filters' : 'Upload your first file to see it here')}
            </Text>
            {loadError && (
              <TouchableOpacity onPress={() => void loadOwnedFiles()}>
                <Text style={[styles.retryText, { color: colors.primary }]}>Try again</Text>
              </TouchableOpacity>
            )}
          </View>
        }
      />

      <Modal visible={showFilter} animationType="fade" transparent onRequestClose={() => setShowFilter(false)}>
        <Pressable style={styles.backdrop} onPress={() => setShowFilter(false)}>
          <Pressable
            style={[styles.sheet, { backgroundColor: colors.background, borderColor: colors.border, paddingBottom: insets.bottom + 16 }]}
            onPress={() => {}}
          >
            <View style={styles.sheetHandleWrap}>
              <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.sheetHeader}>
                <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Filter & Sort</Text>
                <Pressable onPress={() => setShowFilter(false)} hitSlop={10}>
                  <Ionicons name="close" size={22} color={colors.foreground} />
                </Pressable>
              </View>

              <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Date Modified</Text>
              <View style={styles.optionWrap}>
                {DATE_RANGES.map(option => {
                  const selected = dateKey === option.key;
                  return (
                    <TouchableOpacity
                      key={option.key}
                      onPress={() => setDateKey(selected && option.key !== 'custom' ? 'all' : option.key)}
                      style={[styles.option, selected
                        ? { backgroundColor: `${colors.primary}1A`, borderColor: colors.primary }
                        : { backgroundColor: colors.card, borderColor: colors.border }]}
                    >
                      <Text style={[styles.optionText, { color: selected ? colors.primary : colors.foreground }]}>{option.label}</Text>
                      {selected && <Ionicons name="checkmark" size={16} color={colors.primary} />}
                    </TouchableOpacity>
                  );
                })}
              </View>

              {dateKey === 'custom' && (
                <View style={styles.customRow}>
                  <View style={styles.customField}>
                    <Text style={[styles.customLabel, { color: colors.mutedForeground }]}>From</Text>
                    <TextInput
                      value={customFrom}
                      onChangeText={setCustomFrom}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor={colors.mutedForeground}
                      autoCapitalize="none"
                      style={[styles.customInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
                    />
                  </View>
                  <View style={styles.customField}>
                    <Text style={[styles.customLabel, { color: colors.mutedForeground }]}>To</Text>
                    <TextInput
                      value={customTo}
                      onChangeText={setCustomTo}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor={colors.mutedForeground}
                      autoCapitalize="none"
                      style={[styles.customInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
                    />
                  </View>
                </View>
              )}

              <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 20 }]}>Sort By</Text>
              <View style={styles.optionWrap}>
                {SORTS.map(option => {
                  const selected = sort === option.key;
                  return (
                    <TouchableOpacity
                      key={option.key}
                      onPress={() => setSort(option.key)}
                      style={[styles.option, selected
                        ? { backgroundColor: `${colors.primary}1A`, borderColor: colors.primary }
                        : { backgroundColor: colors.card, borderColor: colors.border }]}
                    >
                      <Text style={[styles.optionText, { color: selected ? colors.primary : colors.foreground }]}>{option.label}</Text>
                      {selected && <Ionicons name="checkmark" size={16} color={colors.primary} />}
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={styles.sheetActions}>
                <TouchableOpacity
                  onPress={clearFilters}
                  disabled={!filtersActive}
                  style={[styles.clearBtn, { borderColor: colors.border, opacity: filtersActive ? 1 : 0.5 }]}
                >
                  <Ionicons name="refresh" size={16} color={colors.foreground} />
                  <Text style={[styles.clearText, { color: colors.foreground }]}>Clear Filters</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setShowFilter(false)} style={[styles.applyBtn, { backgroundColor: colors.primary }]}>
                  <Text style={[styles.applyText, { color: colors.primaryForeground }]}>Done</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  orbTL: { position: 'absolute', top: -60, right: -60, width: 200, height: 200, borderRadius: 100, backgroundColor: 'rgba(0,102,255,0.05)' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 16 },
  title: { fontSize: 26, fontFamily: 'Inter_700Bold' },
  headerActions: { flexDirection: 'row', gap: 10 },
  iconBtn: { width: 38, height: 38, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  activeDot: { position: 'absolute', top: -3, right: -3, width: 10, height: 10, borderRadius: 5, borderWidth: 1.5 },
  searchBar: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 20, borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, height: 46, gap: 10, marginBottom: 12 },
  searchInput: { flex: 1, fontSize: 15, fontFamily: 'Inter_400Regular' },
  filtersWrap: { marginBottom: 12 },
  filterChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  filterText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  listHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 8 },
  listCount: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  sortTrigger: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sortText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  empty: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold' },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular', textAlign: 'center', paddingHorizontal: 40 },
  retryText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, paddingHorizontal: 20, paddingTop: 8, maxHeight: '85%' },
  sheetHandleWrap: { alignItems: 'center', paddingVertical: 8 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sheetTitle: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  sectionLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  optionWrap: { gap: 8 },
  option: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, borderWidth: 1 },
  optionText: { fontSize: 14, fontFamily: 'Inter_500Medium' },
  customRow: { flexDirection: 'row', gap: 12, marginTop: 12 },
  customField: { flex: 1, gap: 6 },
  customLabel: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  customInput: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, height: 44, fontSize: 14, fontFamily: 'Inter_400Regular' },
  sheetActions: { flexDirection: 'row', gap: 12, marginTop: 24 },
  clearBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 48, borderRadius: 12, borderWidth: 1 },
  clearText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  applyBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', height: 48, borderRadius: 12 },
  applyText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
});

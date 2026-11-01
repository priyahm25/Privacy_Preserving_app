import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { FileCard } from "@/components/FileCard";
import { useUser } from "@clerk/expo";
import { createQuerySearchTokens } from "@/lib/searchIndex";
import { formatBytes, SecureFileRecord, useFilesApi } from "@/lib/filesApi";


type SearchDisplayFile = {
  id: string;
  name: string;
  type: SecureFileRecord["type"];
  size: string;
  encrypted: boolean;
  shared: boolean;
  ownerId: string;
  sharedWith: string[];
  createdAt: string;
  modifiedAt: string;
};

function toCardFile(file: SecureFileRecord): SearchDisplayFile {
  return {
    id: file.id,
    name: file.name,
    type: file.type,
    size: formatBytes(file.sizeBytes),
    encrypted: file.encrypted,
    shared: (file.shares?.length ?? 0) > 0,
    ownerId: file.ownerId,
    sharedWith: file.shares?.map((share) => share.clerkId) ?? [],
    createdAt: file.createdAt,
    modifiedAt: file.modifiedAt,
  };
}

export default function Search() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const { searchFiles, listFiles } = useFilesApi();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchDisplayFile[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<SearchDisplayFile[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const searchGeneration = useRef(0);
  const searchFilesRef = useRef(searchFiles);
  const listFilesRef = useRef(listFiles);
  searchFilesRef.current = searchFiles;
  listFilesRef.current = listFiles;

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  useEffect(() => {
    let cancelled = false;
    if (!user?.id) {
      setUploadedFiles([]);
      return () => {
        cancelled = true;
      };
    }

    void listFilesRef.current()
      .then(({ owned }) => {
        if (!cancelled) setUploadedFiles(owned.map(toCardFile));
      })
      .catch(() => {
        if (!cancelled) setUploadedFiles([]);
      });

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    let cancelled = false;
    const generation = ++searchGeneration.current;
    setNextPage(null);
    setLoadingMore(false);
    setSearchError(null);
    if (!query.trim() || !user?.id) {
      setResults([]);
      return () => { cancelled = true; };
    }
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const tokens = await createQuerySearchTokens(user.id, query);
          // Blind-index match requires all query tokens to match (unchanged default).
          const response = await searchFilesRef.current(tokens, "AND");
          console.info("Secure search", {
            queryTokenCount: tokens.length,
            matchedFileCount: response.files.length,
          });
          if (!cancelled && generation === searchGeneration.current) {
            setResults(response.files.map(toCardFile));
            setNextPage(response.nextPage);
          }
        } catch (error) {
          if (!cancelled && generation === searchGeneration.current) {
            setResults([]);
            setNextPage(null);
            setSearchError(
              error instanceof Error
                ? error.message
                : "Encrypted search is unavailable.",
            );
          }
        }
      })();
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, user?.id]);

  const loadMore = async () => {
    if (nextPage === null || loadingMore || !user?.id) return;
    const generation = searchGeneration.current;
    setLoadingMore(true);
    try {
      const tokens = await createQuerySearchTokens(user.id, query);
      const response = await searchFilesRef.current(tokens, "AND", nextPage);
      console.info("Secure search", {
        queryTokenCount: tokens.length,
        matchedFileCount: response.files.length,
      });
      if (generation === searchGeneration.current) {
        setResults((current) => [...current, ...response.files.map(toCardFile)]);
        setNextPage(response.nextPage);
      }
    } catch (error) {
      // Retain the existing page and allow the user to retry.
      setSearchError(
        error instanceof Error ? error.message : "Could not load more results.",
      );
    } finally {
      if (generation === searchGeneration.current) setLoadingMore(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.orbTL} />

      <View style={[styles.header, { paddingTop: topPad + 16 }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>
          Secure Search
        </Text>

        <View
          style={[
            styles.encryptBadge,
            {
              backgroundColor: "rgba(0,230,118,0.12)",
              borderColor: "rgba(0,230,118,0.3)",
            },
          ]}
        >
          <Ionicons name="lock-closed" size={10} color={colors.success} />

          <Text style={[styles.encryptBadgeText, { color: colors.success }]}>
            Encrypted
          </Text>
        </View>
      </View>

      <View
        style={[
          styles.searchBar,
          {
            backgroundColor: colors.card,
            borderColor:
              query.length > 0 ? `${colors.primary}60` : colors.border,
          },
        ]}
      >
        <Ionicons
          name="search"
          size={20}
          color={query.length > 0 ? colors.primary : colors.mutedForeground}
        />

        <TextInput
          style={[styles.searchInput, { color: colors.foreground }]}
          value={query}
          onChangeText={setQuery}
          placeholder="Search encrypted files..."
          placeholderTextColor={colors.mutedForeground}
          autoFocus={false}
          maxLength={4096}
        />

        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery("")}>
            <Ionicons
              name="close-circle"
              size={18}
              color={colors.mutedForeground}
            />
          </TouchableOpacity>
        )}
      </View>

      <FlatList<SearchDisplayFile>
        data={query.length > 0 ? results : uploadedFiles}
        keyExtractor={(item, i) =>
          item.id + i
        }
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: Platform.OS === "web" ? 84 : 90,
        }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          query.length === 0 ? (
            <View>
              <Text
                style={[styles.sectionLabel, { color: colors.mutedForeground }]}
              >
                Your Encrypted Files
              </Text>
            </View>
          ) : results.length > 0 ? (
            <Text
              style={[styles.sectionLabel, { color: colors.mutedForeground }]}
            >
              {results.length} result{results.length !== 1 ? "s" : ""}
            </Text>
          ) : null
        }
        renderItem={({ item }) => (
            <FileCard
              file={item}
              onPress={() => router.push(`/file-details/${item.id}`)}
            />
        )}
        ListEmptyComponent={
          query.length > 0 ? (
            <View style={styles.empty}>
              <Ionicons
                name="search-outline"
                size={48}
                color={colors.mutedForeground}
              />

              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                {searchError ? "Search unavailable" : "No results"}
              </Text>

              <Text
                style={[styles.emptyText, { color: colors.mutedForeground }]}
              >
                {searchError ?? `No encrypted files match "${query}"`}
              </Text>
            </View>
          ) : null
        }
        ListFooterComponent={
          query.length > 0 && nextPage !== null ? (
            <TouchableOpacity
              onPress={loadMore}
              disabled={loadingMore}
              style={[styles.loadMore, { borderColor: colors.border }]}
            >
              <Text style={[styles.loadMoreText, { color: colors.primary }]}>
                {loadingMore ? "Loading..." : "Load more"}
              </Text>
            </TouchableOpacity>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  orbTL: {
    position: "absolute",
    top: -60,
    right: -60,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: "rgba(0,212,255,0.04)",
  },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 16,
  },

  title: {
    fontSize: 26,
    fontFamily: "Inter_700Bold",
  },

  encryptBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
  },

  encryptBadgeText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },

  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 20,
    borderRadius: 14,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    height: 50,
    gap: 10,
    marginBottom: 14,
  },

  searchInput: {
    flex: 1,
    fontSize: 16,
    fontFamily: "Inter_400Regular",
  },

  sectionLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 12,
  },

  empty: {
    alignItems: "center",
    paddingTop: 60,
    gap: 12,
  },

  loadMore: {
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 10,
    marginVertical: 10,
    paddingVertical: 10,
  },

  loadMoreText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },

  emptyTitle: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
  },

  emptyText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
});

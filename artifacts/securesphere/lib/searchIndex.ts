import { unzipSync, strFromU8 } from "fflate";
import { deriveSearchHmacKey } from "./deviceKeys";
import { normalizeSearchTerms } from "./searchTerms";
import { createHmacSearchTokens } from "./searchTokens";
import { MAX_INDEXED_SEARCH_TOKENS, prepareDocumentSearchTerms } from "./documentSearchTerms";

export { normalizeSearchTerms } from "./searchTerms";

/** Bound client CPU, request size, and database rows per encrypted file. */
export { MAX_INDEXED_SEARCH_TOKENS, prepareDocumentSearchTerms } from "./documentSearchTerms";
export const MAX_QUERY_SEARCH_TERMS = 25;
export const MAX_QUERY_SEARCH_CHARACTERS = 4_096;
const MAX_ZIP_ENTRIES = 200;
const MAX_ZIP_ENTRY_BYTES = 2 * 1024 * 1024;
const MAX_ZIP_TOTAL_BYTES = 8 * 1024 * 1024;

function stripXml(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/&(?:amp|lt|gt|quot|apos);/g, " ");
}

function zipText(bytes: Uint8Array, predicate: (name: string) => boolean): string {
  try {
    let entryCount = 0;
    let totalBytes = 0;
    let exceededLimit = false;
    const archive = unzipSync(bytes, {
      // fflate evaluates this filter from ZIP metadata before inflating an
      // entry, so irrelevant and oversized XML is never decompressed.
      filter: (entry) => {
        entryCount += 1;
        if (entryCount > MAX_ZIP_ENTRIES) {
          exceededLimit = true;
          return false;
        }
        if (!predicate(entry.name)) return false;
        totalBytes += entry.originalSize;
        if (entry.originalSize > MAX_ZIP_ENTRY_BYTES || totalBytes > MAX_ZIP_TOTAL_BYTES) {
          exceededLimit = true;
          return false;
        }
        return true;
      },
    });
    if (exceededLimit) return "";
    return Object.entries(archive)
      .map(([, content]) => stripXml(strFromU8(content)))
      .join(" ");
  } catch {
    return "";
  }
}

export function extractSearchableText(bytes: Uint8Array, fileName: string, mimeType?: string): string {
  const extension = fileName.toLowerCase().split(".").pop() ?? "";
  if (extension === "docx" || mimeType?.includes("wordprocessingml")) {
    return zipText(bytes, (name) => /^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/.test(name));
  }
  if (extension === "xlsx" || extension === "xlsm" || mimeType?.includes("spreadsheetml")) {
    return zipText(bytes, (name) => name === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
  }
  if (extension === "pptx" || mimeType?.includes("presentationml")) {
    return zipText(bytes, (name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  }
  if (extension === "pdf" || mimeType === "application/pdf") return "";
  if (["txt", "csv", "json", "html", "htm", "xml", "md"].includes(extension) || mimeType?.startsWith("text/")) {
    const text = new TextDecoder().decode(bytes);
    return extension === "html" || extension === "htm" || extension === "xml" ? stripXml(text) : text;
  }
  return "";
}

async function blindTokens(userId: string, value: string[]): Promise<string[]> {
  const key = await deriveSearchHmacKey(userId);
  return createHmacSearchTokens(key, value);
}

export async function createDocumentSearchTokens(userId: string, searchableText: string): Promise<string[]> {
  return blindTokens(userId, prepareDocumentSearchTerms(searchableText));
}

export async function createQuerySearchTokens(userId: string, query: string): Promise<string[]> {
  return blindTokens(
    userId,
    [...new Set(normalizeSearchTerms(query.slice(0, MAX_QUERY_SEARCH_CHARACTERS)))].slice(
      0,
      MAX_QUERY_SEARCH_TERMS,
    ),
  );
}

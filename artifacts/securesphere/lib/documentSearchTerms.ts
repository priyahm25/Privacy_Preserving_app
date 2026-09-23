import { normalizeSearchTerms } from "./searchTerms";

export const MAX_INDEXED_SEARCH_TOKENS = 5_000;

/** The exact plaintext-to-term boundary before HMAC blinding. */
export function prepareDocumentSearchTerms(searchableText: string): string[] {
  return [...new Set(normalizeSearchTerms(searchableText))].slice(0, MAX_INDEXED_SEARCH_TOKENS);
}

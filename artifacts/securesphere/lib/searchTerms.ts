/** Stable, locale-independent tokenization shared by indexing and query generation. */
export function normalizeSearchTerms(text: string): string[] {
  return text
    .normalize("NFKC")
    // PDF producers sometimes put invisible characters inside painted words.
    .replace(/[\u00ad\u200b-\u200d\ufeff]/g, "")
    .replace(/([\p{L}\p{N}])[-\u2010-\u2015]\s*\n\s*([\p{L}\p{N}])/gu, "$1$2")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? [];
}

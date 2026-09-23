export const SEARCH_TOKEN_PATTERN = /^[0-9a-f]{64}$/;
export const MAX_INDEXED_SEARCH_TOKENS = 5_000;
export const MAX_QUERY_SEARCH_TOKENS = 25;
export const DEFAULT_SEARCH_PAGE_SIZE = 25;
export const MAX_SEARCH_PAGE_SIZE = 50;
export const MAX_SEARCH_RESULTS = 1_000;

/** Accept only opaque HMAC-SHA-256 values, never terms or document content. */
export function parseSearchTokens(value: unknown, max = MAX_INDEXED_SEARCH_TOKENS): string[] | null {
  if (typeof value !== "string" || value.length > max * 67 + 1) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length > max) return null;
    if (!parsed.every((token) => typeof token === "string" && SEARCH_TOKEN_PATTERN.test(token))) return null;
    return [...new Set(parsed)];
  } catch {
    return null;
  }
}

function boundedInteger(value: unknown, fallback: number, maximum: number): number | null {
  if (value === undefined) return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= maximum ? parsed : null;
}

export interface SearchRequest {
  tokens: string[];
  mode: "AND" | "OR";
  page: number;
  pageSize: number;
}

export function parseSearchRequest(value: unknown): SearchRequest | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (!Array.isArray(body.tokens)) return null;
  const tokens = parseSearchTokens(JSON.stringify(body.tokens), MAX_QUERY_SEARCH_TOKENS);
  const page = boundedInteger(body.page, 0, MAX_SEARCH_RESULTS);
  const pageSize = boundedInteger(body.pageSize, DEFAULT_SEARCH_PAGE_SIZE, MAX_SEARCH_PAGE_SIZE);
  if (tokens === null || (body.mode !== "AND" && body.mode !== "OR") || page === null || pageSize === null || pageSize === 0) return null;
  return { tokens, mode: body.mode, page, pageSize };
}

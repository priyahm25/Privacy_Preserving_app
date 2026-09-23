export const SEARCH_TOKEN_DOMAIN = "SecureSphere/blind-index/token/v1\0";

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer;

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

/** Create opaque HMAC-SHA-256 blind-index values from already-normalized terms. */
export async function createHmacSearchTokens(key: CryptoKey, terms: string[]): Promise<string[]> {
  return Promise.all(terms.map(async (term) =>
    hex(new Uint8Array(await crypto.subtle.sign(
      "HMAC",
      key,
      toArrayBuffer(new TextEncoder().encode(SEARCH_TOKEN_DOMAIN + term)),
    ))),
  ));
}

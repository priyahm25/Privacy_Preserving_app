import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { MAX_INDEXED_SEARCH_TOKENS, parseSearchRequest, parseSearchTokens } from "../../artifacts/api-server/src/lib/searchValidation.ts";
import { normalizeSearchTerms } from "../../artifacts/securesphere/lib/searchTerms.ts";
import { createHmacSearchTokens } from "../../artifacts/securesphere/lib/searchTokens.ts";
import { extractPdfText } from "../../artifacts/securesphere/lib/pdfTextExtractor.ts";

const encoder = new TextEncoder();
const importKey = (value: string) => crypto.subtle.importKey(
  "raw",
  encoder.encode(value),
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign"],
);
const token = "a".repeat(64);

const textPdf = new TextEncoder().encode(`%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /Contents 4 0 R >> endobj
4 0 obj << /Length 45 >> stream
BT /F1 12 Tf 72 720 Td [(QUAN) 0 (TUM)] TJ T* (hyphen-) Tj T* (ated) Tj T* <FEFF00430061006600E9> Tj ET
endstream endobj
trailer << /Root 1 0 R >>
%%EOF`);

const multiPageTextPdf = new TextEncoder().encode(`%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /Contents 5 0 R >> endobj
4 0 obj << /Type /Page /Parent 2 0 R /Contents 6 0 R >> endobj
5 0 obj << /Length 42 >> stream
BT /F1 12 Tf 72 720 Td (Privacy preserving) Tj ET
endstream endobj
6 0 obj << /Length 43 >> stream
BT /F1 12 Tf 72 720 Td (collaboration platform) Tj ET
endstream endobj
trailer << /Root 1 0 R >>
%%EOF`);

test("extracts readable text from a text PDF before search-term preparation", () => {
  const extraction = extractPdfText(textPdf);
  assert.equal(extraction.pageCount, 1);
  assert.ok(extraction.text.length > 0);
  assert.match(extraction.text, /QUANTUM/);
  assert.match(extraction.text, /hyphenated/);
  assert.match(extraction.text, /Café/);

  // This models the upload boundary: the HMAC/token path receives extracted
  // text, not the PDF's raw object/stream bytes.
  const terms = normalizeSearchTerms(extraction.text);
  assert.ok(terms.includes("quantum"));
  assert.ok(terms.includes("hyphenated"));
  assert.ok(terms.includes("café"));
  assert.ok(!terms.includes("catalog"));
});

test("extracts searchable text from every PDF page", () => {
  const extraction = extractPdfText(multiPageTextPdf);
  assert.equal(extraction.pageCount, 2);
  assert.deepEqual(normalizeSearchTerms(extraction.text), [
    "privacy", "preserving", "collaboration", "platform",
  ]);
});

test("the upload path passes extracted PDF text, never raw PDF bytes, to document tokenization", async () => {
  const uploadSource = await readFile(
    new URL("../../artifacts/securesphere/app/(tabs)/upload.tsx", import.meta.url),
    "utf8",
  );
  assert.match(uploadSource, /const searchableText = pdfExtraction\s*\? pdfExtraction\.text/);
  assert.match(uploadSource, /createDocumentSearchTokens\(\s*user\.id,\s*searchableText,/);
  assert.doesNotMatch(uploadSource, /createDocumentSearchTokens\(\s*user\.id,\s*plaintext,/);
});

test("normalization is Unicode-safe and exact-token oriented", () => {
  assert.deepEqual(normalizeSearchTerms("  HELLO, hello!  "), ["hello", "hello"]);
  assert.deepEqual(normalizeSearchTerms("SECU\u200BRITY\u00AD"), ["security"]);
  assert.deepEqual(normalizeSearchTerms("line-\nbreak"), ["linebreak"]);
  assert.deepEqual(normalizeSearchTerms("Ｆoo\t42—café"), ["foo", "42", "café"]);
  assert.deepEqual(normalizeSearchTerms("  … -- "), []);
});

test("HMAC blind-index tokens are deterministic, keyed, and opaque", async () => {
  const firstKey = await importKey("a".repeat(32));
  const secondKey = await importKey("b".repeat(32));
  const [first] = await createHmacSearchTokens(firstKey, ["report"]);
  const [repeat] = await createHmacSearchTokens(firstKey, ["report"]);
  const [differentTerm] = await createHmacSearchTokens(firstKey, ["invoice"]);
  const [differentKey] = await createHmacSearchTokens(secondKey, ["report"]);

  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(first, repeat);
  assert.notEqual(first, differentTerm);
  assert.notEqual(first, differentKey);
  assert.notEqual(first, "report");
});

test("maximum client-generated upload tokens pass backend validation", async () => {
  const key = await importKey("upload-search-token-regression-key");
  const terms = Array.from({ length: MAX_INDEXED_SEARCH_TOKENS }, (_, index) => `term-${index}`);
  const tokens = await createHmacSearchTokens(key, terms);
  const multipartFieldValue = JSON.stringify(tokens);

  assert.equal(multipartFieldValue.length, MAX_INDEXED_SEARCH_TOKENS * 67 + 1);
  assert.deepEqual(parseSearchTokens(multipartFieldValue), tokens);
});

test("search request validation rejects plaintext-shaped and malformed input", () => {
  assert.equal(parseSearchRequest({ mode: "AND", page: 0, pageSize: 25 }), null);
  assert.equal(parseSearchRequest({ tokens: ["report"], mode: "AND" }), null);
  assert.equal(parseSearchRequest({ tokens: [token], mode: "contains" }), null);
  assert.equal(parseSearchRequest({ tokens: [token], mode: "AND", page: -1 }), null);
  assert.equal(parseSearchRequest({ tokens: [token], mode: "AND", pageSize: 51 }), null);
  assert.deepEqual(parseSearchRequest({ tokens: [], mode: "OR" }), {
    tokens: [], mode: "OR", page: 0, pageSize: 25,
  });
  assert.deepEqual(parseSearchRequest({ tokens: [token, token], mode: "AND", page: 1, pageSize: 10 }), {
    tokens: [token], mode: "AND", page: 1, pageSize: 10,
  });
});

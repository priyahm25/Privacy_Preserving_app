# Secure Search

SecureSphere uses client-side AES-256-GCM encryption for file bytes. The client performs local malware scanning, text extraction, token generation, and encryption before calling `POST /api/files/upload`. The API receives ciphertext, a public IV, scan metadata, and opaque search tokens; it never receives file plaintext, search words, or file/search keys. Client-side decryption occurs only after an authorized ciphertext download.

For supported text-bearing formats, the client normalizes text with Unicode NFKC, lowercase conversion, and Unicode letter/number tokenization. It removes duplicate terms per document and creates deterministic HMAC-SHA-256 tokens under a search key derived with HKDF-SHA-256 from the device-local ECDH private key. Tokens are exact-keyword tokens: substring, fuzzy, and phrase search are not supported.

PostgreSQL stores the opaque tokens in `file_search_tokens`, associated with a file and its owner. A query is normalized and tokenized on the client; only the resulting tokens are sent to `POST /api/files/search`. The API performs an indexed exact lookup and additionally filters both token rows and file rows by the authenticated owner. Shared-file search is intentionally not implemented. Adding it safely requires client-generated per-recipient tokens, never server-side token derivation.

This is not zero-leakage encryption. The service can observe encrypted-token equality, repeated searches, token and result counts, access patterns, and file metadata such as filename, MIME type, size, timestamps, and ownership. The HMAC key prevents the service from directly guessing a word from a token, but device-key loss, rotation, or a second device cannot reproduce existing indexes in the current design.

The former plaintext upload route, `POST /api/files/share`, is retired and returns `410 Gone`. Use `POST /api/files/upload` only.

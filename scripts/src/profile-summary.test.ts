import assert from "node:assert/strict";
import test from "node:test";
import { summarizeProfileState } from "../../artifacts/api-server/src/lib/profileSummary.ts";
import { calculateSecurityScore, formatStorageBytes } from "../../artifacts/securesphere/lib/profileSecurity.ts";

test("storage and security metadata include only authenticated owner's files and shares", () => {
  const result = summarizeProfileState("user-a", [
    { ownerClerkId: "user-a", sizeBytes: 1024, encrypted: true, iv: "a".repeat(24) },
    { ownerClerkId: "user-a", sizeBytes: 512, encrypted: false, iv: "b".repeat(24) },
    { ownerClerkId: "user-b", sizeBytes: 9000, encrypted: true, iv: "c".repeat(24) },
  ], [
    { ownerClerkId: "user-a", wrappedFileKey: "wrapped", wrappingIv: "iv", wrappingAlgorithm: "ECDH" },
    { ownerClerkId: "user-b", wrappedFileKey: null, wrappingIv: null, wrappingAlgorithm: null },
  ]);
  assert.equal(result.storageBytes, 1536);
  assert.deepEqual(result.files, { count: 2, encryptedCount: 1 });
  assert.deepEqual(result.shares, { count: 1, wrappedKeyCount: 1 });
});

test("empty account reports zero storage and marks file/share checks not applicable", () => {
  const result = summarizeProfileState("empty", [], []);
  assert.equal(result.storageBytes, 0);
  assert.deepEqual(result.files, { count: 0, encryptedCount: 0 });
  assert.deepEqual(result.shares, { count: 0, wrappedKeyCount: 0 });
  const score = calculateSecurityScore({ deviceKey: "passed", fileCount: 0, encryptedFileCount: 0, shareCount: 0, wrappedShareCount: 0 });
  assert.equal(score.score, 40);
  assert.equal(score.checks[1].status, "not_applicable");
  assert.equal(score.checks[2].status, "not_applicable");
});

test("unknown checks earn no points while failures remain distinct", () => {
  const result = calculateSecurityScore({ deviceKey: "failed", fileCount: null, encryptedFileCount: null, shareCount: null, wrappedShareCount: null });
  assert.equal(result.score, 0);
  assert.equal(result.checks[0].status, "failed");
  assert.equal(result.checks[1].status, "unknown");
  assert.equal(result.checks[2].status, "unknown");
  const unknown = calculateSecurityScore({ deviceKey: "unknown", fileCount: null, encryptedFileCount: null, shareCount: null, wrappedShareCount: null });
  assert.equal(unknown.score, null);
});

test("storage formatting uses binary units", () => {
  assert.equal(formatStorageBytes(0), "0 B");
  assert.equal(formatStorageBytes(1024), "1.0 KB");
  assert.equal(formatStorageBytes(1024 * 1024), "1.0 MB");
});

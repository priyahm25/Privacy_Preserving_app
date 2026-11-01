import assert from "node:assert/strict";
import test from "node:test";
import { applyRename, fileExtension, RenameError, sanitizeDisplayName } from "../../artifacts/api-server/src/lib/fileNaming.ts";

test("owner rename always preserves the original extension", () => {
  assert.equal(applyRename("report.pdf", "Quarterly Report"), "Quarterly Report.pdf");
  // Re-typing the same extension does not double it.
  assert.equal(applyRename("report.pdf", "Quarterly Report.pdf"), "Quarterly Report.pdf");
  assert.equal(applyRename("report.PDF", "final.pdf"), "final.PDF"); // keeps original ext casing
  // A different extension in the request is treated as part of the base name.
  assert.equal(applyRename("notes.docx", "notes.exe"), "notes.exe.docx");
  // Dotless originals stay dotless.
  assert.equal(applyRename("LICENSE", "readme"), "readme");
});

test("owner rename strips paths and control characters", () => {
  assert.equal(applyRename("a.pptx", "  Deck  "), "Deck.pptx");
  assert.equal(applyRename("a.pdf", "../../etc/passwd"), "passwd.pdf");
  assert.equal(applyRename("a.pdf", "name\u0000\u001F"), "name.pdf");
});

test("owner rename rejects empty or over-long names", () => {
  assert.throws(() => applyRename("a.pdf", "   "), RenameError);
  assert.throws(() => applyRename("a.pdf", ".pdf"), RenameError); // nothing left after stripping ext
  assert.throws(() => applyRename("a.pdf", "x".repeat(260)), RenameError);
});

test("fileExtension handles dotfiles and multi-dot names", () => {
  assert.equal(fileExtension("a.tar.gz"), ".gz");
  assert.equal(fileExtension(".env"), "");
  assert.equal(fileExtension("plain"), "");
  assert.equal(fileExtension("dir/name.PDF"), ".PDF");
});

test("recipient display name is trimmed and validated (no extension rules)", () => {
  assert.equal(sanitizeDisplayName("  My copy  "), "My copy");
  assert.equal(sanitizeDisplayName("Budget 2026 (shared)"), "Budget 2026 (shared)");
  assert.throws(() => sanitizeDisplayName(""), RenameError);
  assert.throws(() => sanitizeDisplayName("y".repeat(300)), RenameError);
});

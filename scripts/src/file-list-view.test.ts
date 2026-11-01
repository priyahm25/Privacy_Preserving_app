import assert from "node:assert/strict";
import test from "node:test";
import { applyFileView, gridColumns, parseDay, rangeStart, type ViewableFile } from "../../artifacts/securesphere/lib/fileListView.ts";

const NOW = new Date(2026, 10, 1, 12, 0, 0).getTime(); // 2026-11-01 12:00 local
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d, 9, 0, 0).getTime();

// Synthetic metadata only (no app data). Sizes in bytes, modified timestamps.
const FILES: (ViewableFile & { id: string })[] = [
  { id: "a", name: "Zebra report.pdf", type: "pdf", modifiedMs: day(2026, 11, 1), sizeBytes: 500 },      // today
  { id: "b", name: "alpha notes.docx", type: "docx", modifiedMs: day(2026, 10, 28), sizeBytes: 9000 },   // 4 days ago
  { id: "c", name: "Mango slides.pptx", type: "pptx", modifiedMs: day(2026, 10, 10), sizeBytes: 100 },    // ~22 days ago
  { id: "d", name: "budget.xlsx", type: "xlsx", modifiedMs: day(2026, 9, 15), sizeBytes: 300000 },        // ~47 days ago
  { id: "e", name: "old archive.pdf", type: "pdf", modifiedMs: day(2026, 6, 1), sizeBytes: 50 },          // ~5 months ago
];

const base = { typeFilter: "all", search: "", dateKey: "all", customFrom: "", customTo: "", sort: "newest", now: NOW } as const;
const ids = (rows: { id: string }[]) => rows.map(r => r.id);
const run = (opts: Partial<typeof base>) => applyFileView(FILES, { ...base, ...opts });

test("default is newest-first by modified date", () => {
  assert.deepEqual(ids(run({})), ["a", "b", "c", "d", "e"]);
});

test("all six sort orders operate on real metadata", () => {
  assert.deepEqual(ids(run({ sort: "oldest" })), ["e", "d", "c", "b", "a"]);
  assert.deepEqual(ids(run({ sort: "name-asc" })), ["b", "d", "c", "e", "a"]);   // alpha, budget, Mango, old, Zebra (case-insensitive)
  assert.deepEqual(ids(run({ sort: "name-desc" })), ["a", "e", "c", "d", "b"]);
  assert.deepEqual(ids(run({ sort: "size-desc" })), ["d", "b", "a", "c", "e"]);  // 300000,9000,500,100,50
  assert.deepEqual(ids(run({ sort: "size-asc" })), ["e", "c", "a", "b", "d"]);
});

test("relative date ranges filter on modified timestamp", () => {
  assert.deepEqual(ids(run({ dateKey: "today" })), ["a"]);
  assert.deepEqual(ids(run({ dateKey: "7d" })), ["a", "b"]);
  assert.deepEqual(ids(run({ dateKey: "30d" })), ["a", "b", "c"]);
  assert.deepEqual(ids(run({ dateKey: "3m" })), ["a", "b", "c", "d"]);
  assert.deepEqual(ids(run({ dateKey: "all" })), ["a", "b", "c", "d", "e"]);
});

test("custom date range is inclusive of both endpoints' full days", () => {
  // Oct 10 to Oct 28 inclusive -> c and b.
  assert.deepEqual(new Set(ids(run({ dateKey: "custom", customFrom: "2026-10-10", customTo: "2026-10-28" }))), new Set(["b", "c"]));
  // Open-ended "from" only.
  assert.deepEqual(ids(run({ dateKey: "custom", customFrom: "2026-10-29", sort: "oldest" })), ["a"]);
  // Open-ended "to" only: Sep 15 (d) and Jun 1 (e) fall on/before Sep 30.
  assert.deepEqual(ids(run({ dateKey: "custom", customTo: "2026-09-30", sort: "newest" })), ["d", "e"]);
  // Invalid/blank custom inputs impose no bound.
  assert.equal(run({ dateKey: "custom", customFrom: "not-a-date" }).length, 5);
});

test("type tab, search and date range combine, and sorting still applies", () => {
  assert.deepEqual(ids(run({ typeFilter: "pdf" })), ["a", "e"]);
  assert.deepEqual(ids(run({ typeFilter: "pdf", dateKey: "30d" })), ["a"]);
  assert.deepEqual(ids(run({ search: "report" })), ["a"]);
  // Case-insensitive 'o': alpha(notes), Mango, old archive, Zebra(report); budget has none.
  assert.deepEqual(ids(run({ search: "O", sort: "name-asc" })), ["b", "c", "e", "a"]);
  assert.deepEqual(ids(run({ typeFilter: "pdf", sort: "size-asc" })), ["e", "a"]);
});

test("applyFileView does not mutate the input array", () => {
  const before = ids(FILES);
  run({ sort: "size-desc" });
  assert.deepEqual(ids(FILES), before);
});

test("parseDay and rangeStart edge cases", () => {
  assert.equal(parseDay("2026-01-05"), new Date(2026, 0, 5).getTime());
  assert.equal(parseDay("2026-1-5"), null);
  assert.equal(parseDay(""), null);
  assert.equal(rangeStart("today", NOW), new Date(2026, 10, 1).getTime());
  assert.ok(rangeStart("7d", NOW) < NOW);
});

test("grid columns: 5 desktop / 3 tablet / 2 mobile", () => {
  assert.equal(gridColumns(1280), 5);
  assert.equal(gridColumns(900), 5);
  assert.equal(gridColumns(768), 3);
  assert.equal(gridColumns(600), 3);
  assert.equal(gridColumns(400), 2);
  assert.equal(gridColumns(320), 2);
});

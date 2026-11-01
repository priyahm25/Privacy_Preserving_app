// Pure filter + sort logic for the My Files screen, kept free of React/Expo
// imports so it can be unit tested under plain Node. Operates on real file
// metadata (modified timestamp in ms, byte size, name, type).

export type SortKey = 'newest' | 'oldest' | 'name-asc' | 'name-desc' | 'size-desc' | 'size-asc';
export type DateKey = 'all' | 'today' | '7d' | '30d' | '3m' | 'custom';

export interface ViewableFile {
  name: string;
  type: string;
  modifiedMs: number;
  sizeBytes: number;
}

export interface ViewOptions {
  /** File-type tab: a FileType value or 'all'. */
  typeFilter: string;
  search: string;
  dateKey: DateKey;
  customFrom: string;
  customTo: string;
  sort: SortKey;
  /** Reference "now" for relative ranges; defaults to Date.now(). */
  now?: number;
}

/** Parse a YYYY-MM-DD string to a local-midnight timestamp, or null if invalid. */
export function parseDay(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

/** Inclusive lower bound (ms) for a relative "Date Modified" range. */
export function rangeStart(key: Exclude<DateKey, 'all' | 'custom'>, now: number): number {
  const ref = new Date(now);
  if (key === 'today') return new Date(ref.getFullYear(), ref.getMonth(), ref.getDate()).getTime();
  if (key === '7d') return now - 7 * 86_400_000;
  if (key === '30d') return now - 30 * 86_400_000;
  const threeMonths = new Date(ref);
  threeMonths.setMonth(threeMonths.getMonth() - 3);
  return threeMonths.getTime();
}

export function applyFileView<T extends ViewableFile>(rows: T[], options: ViewOptions): T[] {
  const { typeFilter, dateKey, sort } = options;
  const now = options.now ?? Date.now();
  const term = options.search.trim().toLowerCase();
  const customFromMs = parseDay(options.customFrom);
  const customToMs = parseDay(options.customTo);
  // Include the whole "to" day by extending to just before the next midnight.
  const customToEnd = customToMs === null ? null : customToMs + 86_400_000 - 1;
  const presetStart = dateKey !== 'all' && dateKey !== 'custom' ? rangeStart(dateKey, now) : null;

  const filtered = rows.filter(f => {
    if (typeFilter !== 'all' && f.type !== typeFilter) return false;
    if (term && !f.name.toLowerCase().includes(term)) return false;
    if (presetStart !== null && f.modifiedMs < presetStart) return false;
    if (dateKey === 'custom') {
      if (customFromMs !== null && f.modifiedMs < customFromMs) return false;
      if (customToEnd !== null && f.modifiedMs > customToEnd) return false;
    }
    return true;
  });

  const byName = (a: T, b: T) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  // Copy before sorting so the caller's array is not mutated.
  return [...filtered].sort((a, b) => {
    switch (sort) {
      case 'oldest': return a.modifiedMs - b.modifiedMs;
      case 'name-asc': return byName(a, b);
      case 'name-desc': return byName(b, a);
      case 'size-desc': return b.sizeBytes - a.sizeBytes;
      case 'size-asc': return a.sizeBytes - b.sizeBytes;
      case 'newest':
      default: return b.modifiedMs - a.modifiedMs;
    }
  });
}

/** Grid columns by viewport width: 5 desktop, 3 tablet, 2 mobile. */
export function gridColumns(width: number): number {
  return width >= 900 ? 5 : width >= 600 ? 3 : 2;
}

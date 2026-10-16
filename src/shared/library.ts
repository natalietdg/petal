// The Library: domain knowledge Petal collects from sessions, one Markdown note per topic. Shapes and the list's sort and filter.

export interface LibraryEntry {
  slug: string; // the note's file name without .md
  title: string;
  category: string;
  updated: string; // ISO time from the note, or its file time
  updatedMs: number;
  sources: number; // sessions it was gathered from
  preview: string; // its first facts, as plain text
}

export interface LibraryList {
  allowed: boolean; // the Claude folder gate: off means no new notes can be gathered
  autoBuild: boolean; // Customize › Organizer › Build my Library from sessions
  running: boolean;
  entries: LibraryEntry[];
}

export type LibraryDoc = { slug: string; title: string; category: string; updated: string; sources: string[]; markdown: string } | { missing: true };

export interface LibraryRunResult {
  added: number; // new topic notes
  updated: number; // notes that gained facts
  lessons?: number; // new lessons kept from the same run, when Learn lessons is on
  skipped?: string; // why nothing ran
}

// A note she renamed, recategorised, merged or deleted; trashId undoes a delete.
export type LibraryEditResult = { slug: string; trashId?: string } | { error: string };

export const LIBRARY_SORTS = [
  ['az', 'A to Z'],
  ['za', 'Z to A'],
  ['recent', 'Recently updated'],
] as const;
export type LibrarySort = (typeof LIBRARY_SORTS)[number][0];
export const isLibrarySort = (value: unknown): value is LibrarySort => LIBRARY_SORTS.some(([id]) => id === value);

const byTitle = (a: LibraryEntry, b: LibraryEntry) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) || a.slug.localeCompare(b.slug);

export function sortEntries(entries: readonly LibraryEntry[], sort: LibrarySort): LibraryEntry[] {
  const list = [...entries];
  if (sort === 'recent') return list.sort((a, b) => b.updatedMs - a.updatedMs || byTitle(a, b));
  list.sort(byTitle);
  return sort === 'za' ? list.reverse() : list;
}

// Every category present, A to Z, each once (case-insensitive).
export function categoriesOf(entries: readonly LibraryEntry[]): string[] {
  const seen = new Map<string, string>();
  for (const { category } of entries) if (!seen.has(category.toLowerCase())) seen.set(category.toLowerCase(), category);
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

export interface LibraryFilter {
  category: string | null; // null is All
  text: string;
}

// Category by name (any case); text matches the title, category or preview, every word somewhere.
export function filterEntries(entries: readonly LibraryEntry[], { category, text }: LibraryFilter): LibraryEntry[] {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((entry) => {
    if (category && entry.category.toLowerCase() !== category.toLowerCase()) return false;
    const haystack = `${entry.title} ${entry.category} ${entry.preview}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

// The rim letter for a title: A to Z, or # for anything else.
export const letterOf = (title: string): string => {
  const first = title.trim().charAt(0).toUpperCase();
  return /[A-Z]/.test(first) ? first : '#';
};

// ---- Colour: each category keeps one of the theme's label hues, by its name, so it never changes between runs.
export const CATEGORY_HUES = ['next', 'done', 'watch', 'why', 'decide'] as const;
export type CategoryHue = (typeof CATEGORY_HUES)[number];
// The starter categories are spread by hand so the common ones never share a hue; any other name hashes.
const STARTER_HUES: Record<string, CategoryHue> = {
  payments: 'next', auth: 'why', data: 'done', infra: 'watch', integrations: 'decide',
  billing: 'done', messaging: 'watch', product: 'decide', operations: 'next', compliance: 'why', general: 'next',
};

export function categoryHue(category: string): CategoryHue {
  const name = category.trim().toLowerCase();
  const starter = STARTER_HUES[name];
  if (starter) return starter;
  let hash = 2166136261; // FNV-1a
  for (let i = 0; i < name.length; i += 1) hash = Math.imul(hash ^ name.charCodeAt(i), 16777619) >>> 0;
  return CATEGORY_HUES[hash % CATEGORY_HUES.length] ?? 'next';
}

// ---- The session header's Add to Library button.
export interface AddButtonState {
  hidden: boolean; // no Claude session in this tab: nothing to add
  disabled: boolean;
  title: string; // says why when it is off
}

export const ADD_TITLE = 'Save this session’s domain knowledge to your Library';

export function addButtonState({ sessionId, folderAllowed, busy }: { sessionId: string | null | undefined; folderAllowed: boolean; busy: boolean }): AddButtonState {
  if (!sessionId) return { hidden: true, disabled: true, title: 'This tab has no Claude session' };
  if (!folderAllowed) return { hidden: false, disabled: true, title: 'Allow reading your Claude folder first, in the Library' };
  if (busy) return { hidden: false, disabled: true, title: 'Reading this session…' };
  return { hidden: false, disabled: false, title: ADD_TITLE };
}

// The status line after an add: short, in her words.
export function addResultText(result: LibraryRunResult): string {
  if (result.skipped) return `Nothing added: ${result.skipped}.`;
  if (!result.added && !result.updated) return 'Nothing new since this session was last read.';
  const parts = [result.added ? `Added ${result.added} note${result.added === 1 ? '' : 's'}` : '', result.updated ? `updated ${result.updated}` : ''].filter(Boolean);
  const text = parts.join(', ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

// ---- Reading past sessions.
export const BACKFILL_RANGES = [
  [30, 'Last 30 days'],
  [90, 'Last 90 days'],
  [0, 'All'],
] as const;
export type BackfillDays = (typeof BACKFILL_RANGES)[number][0]; // 0 is all
export const isBackfillDays = (value: unknown): value is BackfillDays => BACKFILL_RANGES.some(([days]) => days === value);

export interface BackfillPlan {
  days: BackfillDays;
  sessions: number; // logs with something not read yet
  calls: number; // about how many Claude calls, at the per-run cap
}

export interface BackfillState {
  running: boolean;
  stopping: boolean; // Stop pressed; ends after the current run
  done: number;
  total: number;
  added: number;
  updated: number;
  days: BackfillDays;
  note?: string; // why it ended early, when it did
}

export const IDLE_BACKFILL: BackfillState = { running: false, stopping: false, done: 0, total: 0, added: 0, updated: 0, days: 30 };

export const rangeText = (days: BackfillDays): string => (days ? `from the last ${days} days` : 'from all your sessions');

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
  skipped?: string; // why nothing ran
}

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

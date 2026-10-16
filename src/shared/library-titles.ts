// When two Library titles name the same topic: case, punctuation, plurals and small words don't count,
// and an abbreviation another title spells out (SI for Settlement Instruction) counts as those words.
// Exact matches merge on their own (library-store.ts); near ones are only offered in Tidy duplicates.

const SMALL_WORDS = new Set(['a', 'an', 'and', 'the', 'of', 'for', 'to', 'in', 'on', 'by', 'with', 'vs']);
const ACRONYM_MIN = 2;
const ACRONYM_MAX = 5;
const NEAR_JACCARD = 0.65; // share of words in common: "X bank details" and "X issuer details" yes, "X email" and "X numbering" no

const wordsOf = (title: string): string[] => title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);

// "details" and "detail" are one word; short words and ones ending in "ss" keep their s.
const singular = (word: string): string => (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word);

// Every run of 2 to 5 words in the titles, keyed by its initials: "settlement instruction" gives "si".
export function aliasesFrom(titles: readonly string[]): Map<string, string[]> {
  const aliases = new Map<string, string[]>();
  for (const title of titles) {
    const words = wordsOf(title).filter((w) => !SMALL_WORDS.has(w) && /^[a-z]/.test(w));
    for (let start = 0; start < words.length; start += 1) {
      for (let size = ACRONYM_MIN; size <= ACRONYM_MAX && start + size <= words.length; size += 1) {
        const run = words.slice(start, start + size);
        if (run.some((w) => w.length < 3)) continue; // "vn si" is not the spelled-out form of anything
        const initials = run.map((w) => w[0]).join('');
        if (!aliases.has(initials)) aliases.set(initials, run);
      }
    }
  }
  return aliases;
}

// The words a title stands for, abbreviations spelled out, plurals folded, small words dropped.
export function topicWords(title: string, aliases: ReadonlyMap<string, readonly string[]>): string[] {
  const out: string[] = [];
  for (const word of wordsOf(title)) {
    if (SMALL_WORDS.has(word)) continue;
    const spelled = word.length >= ACRONYM_MIN && word.length <= ACRONYM_MAX ? aliases.get(word) : undefined;
    out.push(...(spelled ?? [word]).map(singular));
  }
  return out;
}

export const topicKey = (title: string, aliases: ReadonlyMap<string, readonly string[]>): string => topicWords(title, aliases).join(' ');

export type Likeness = 'same' | 'near' | null;

// same: the same words; near: one title's words inside the other's, or most words shared.
export function likeness(a: string, b: string, aliases: ReadonlyMap<string, readonly string[]>): Likeness {
  const wa = new Set(topicWords(a, aliases));
  const wb = new Set(topicWords(b, aliases));
  if (!wa.size || !wb.size) return null;
  const shared = [...wa].filter((w) => wb.has(w)).length;
  if (shared === wa.size && shared === wb.size) return 'same';
  const smaller = Math.min(wa.size, wb.size);
  if (shared === smaller && smaller >= 2) return 'near';
  return shared / (wa.size + wb.size - shared) >= NEAR_JACCARD ? 'near' : null;
}

export interface DuplicateNote { slug: string; title: string; category: string; facts: number; sources: number }
export interface DuplicatePair { keep: DuplicateNote; fold: DuplicateNote } // fold merges into keep

const pairKey = (a: string, b: string): string => [a, b].sort().join('|');
export const keepBothKey = pairKey;

// Likely duplicates in the same category, each note in one pair at most; the fuller note is the one kept.
export function findDuplicates(notes: readonly DuplicateNote[], keptBoth: ReadonlySet<string> = new Set()): DuplicatePair[] {
  const aliases = aliasesFrom(notes.map((n) => n.title));
  const used = new Set<string>();
  const pairs: DuplicatePair[] = [];
  const sorted = [...notes].sort((x, y) => x.title.localeCompare(y.title));
  for (const [i, a] of sorted.entries()) {
    for (const b of sorted.slice(i + 1)) {
      if (used.has(a.slug) || used.has(b.slug)) continue;
      if (a.category.toLowerCase() !== b.category.toLowerCase() || keptBoth.has(pairKey(a.slug, b.slug))) continue;
      if (!likeness(a.title, b.title, aliases)) continue;
      const fuller = (x: DuplicateNote, y: DuplicateNote) => y.sources - x.sources || y.facts - x.facts || y.title.length - x.title.length;
      const [keep, fold] = [a, b].sort(fuller) as [DuplicateNote, DuplicateNote];
      pairs.push({ keep, fold });
      used.add(a.slug);
      used.add(b.slug);
    }
  }
  return pairs;
}

// Lessons: how-to-work rules Petal distils from sessions (corrections, mistakes, approved approaches), apart from the Library's domain facts.
// Shapes, plus the text likeness used to drop repeats against CLAUDE.md and earlier lessons.

export const LESSON_SCOPES = ['global', 'project'] as const;
export type LessonScope = (typeof LESSON_SCOPES)[number];
export const isLessonScope = (value: unknown): value is LessonScope => LESSON_SCOPES.some((s) => s === value);

export interface LessonInput {
  rule: string; // one imperative line, e.g. "Run the check before claiming a deploy landed"
  why: string;
  evidence: string; // a short quote or pointer into the session
  scope: LessonScope;
}

// new: waiting on a card; added: written to a CLAUDE.md; dismissed or merged: kept only so it never comes back.
export type LessonStatus = 'new' | 'added' | 'dismissed' | 'merged';

export interface Lesson extends LessonInput {
  id: string;
  sessionIds: string[]; // first is where it was learned; merges add theirs
  cwd: string | null; // the session's folder, for the project's CLAUDE.md
  at: string; // ISO time learned
  status: LessonStatus;
  addedTo?: LessonScope;
}

export interface LessonsList {
  allowed: boolean; // the Claude folder gate
  learn: boolean; // Customize › Organizer › Learn lessons from sessions
  lessons: Lesson[]; // status new only, newest first
  similar: [string, string][]; // pairs of new lessons that read alike, for Merge with similar
}

export type LessonTarget = LessonScope; // which CLAUDE.md: global (Claude folder) or the session's project

export interface DiffLine { kind: 'same' | 'add'; text: string }
export interface LessonPreview {
  token: string; // hands the confirm back to main; a write without one is refused
  file: string; // shown to her as is
  created: boolean; // the file doesn't exist yet
  lines: DiffLine[]; // a few lines of context around what gets added
}
export type LessonPreviewResult = LessonPreview | { error: string };
export type LessonEditResult = { ok: true } | { error: string };

export const LESSONS_HEADING = '## Lessons from Petal';

const SMALL_WORDS = new Set(['a', 'an', 'and', 'the', 'of', 'for', 'to', 'in', 'on', 'by', 'with', 'is', 'it', 'be', 'or', 'at', 'as', 'that', 'this', 'when', 'you', 'your']);
export const DUPLICATE_LIKENESS = 0.8; // share of words in common that counts as the same rule
export const SIMILAR_LIKENESS = 0.45; // close enough to offer Merge with similar

// Lower case, accents and punctuation gone, list markers and bold stripped, spaces collapsed.
export function normaliseRule(text: string): string {
  return text
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/\*\*|__|`/g, '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const singular = (word: string): string => (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word);
const wordSet = (text: string): Set<string> => new Set(normaliseRule(text).split(' ').filter((w) => w && !SMALL_WORDS.has(w)).map(singular));

// 0 to 1: words in common over words in either (Jaccard), after normalising.
export function likeness(a: string, b: string): number {
  const wa = wordSet(a);
  const wb = wordSet(b);
  if (!wa.size || !wb.size) return 0;
  const shared = [...wa].filter((w) => wb.has(w)).length;
  return shared / (wa.size + wb.size - shared);
}

// Same text once normalised, or most of the same words.
export const isSameRule = (a: string, b: string): boolean => {
  const na = normaliseRule(a);
  return Boolean(na) && (na === normaliseRule(b) || likeness(a, b) >= DUPLICATE_LIKENESS);
};

// The rule-like lines of a CLAUDE.md: bullets and plain sentences, not headings, fences or blank lines.
export function ruleLines(markdown: string): string[] {
  const lines: string[] = [];
  let fenced = false;
  for (const raw of markdown.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(raw)) { fenced = !fenced; continue; }
    if (fenced || /^\s*(#|>|\|)/.test(raw) || !raw.trim()) continue;
    lines.push(raw.trim());
  }
  return lines;
}

// Pairs of lessons that read alike but aren't repeats, each lesson in one pair at most.
export function similarPairs(lessons: readonly Pick<Lesson, 'id' | 'rule'>[]): [string, string][] {
  const used = new Set<string>();
  const pairs: [string, string][] = [];
  for (const [i, a] of lessons.entries()) {
    for (const b of lessons.slice(i + 1)) {
      if (used.has(a.id) || used.has(b.id) || likeness(a.rule, b.rule) < SIMILAR_LIKENESS) continue;
      pairs.push([a.id, b.id]);
      used.add(a.id);
      used.add(b.id);
    }
  }
  return pairs;
}

// The line written under the heading: the rule, then why, each ending in a full stop.
export function lessonLine({ rule, why }: Pick<LessonInput, 'rule' | 'why'>): string {
  const stop = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);
  const body = stop(rule.trim());
  return `- ${why.trim() ? `${body} Why: ${stop(why.trim())}` : body}`;
}

export interface Appended {
  text: string;
  at: number; // line index of the first added line
  added: string[];
}

// Adds a lesson under "## Lessons from Petal", making the heading at the end when missing. Nothing else in the file changes.
export function appendLesson(markdown: string, line: string): Appended {
  const lines = markdown.length ? markdown.replace(/\r?\n$/, '').split(/\r?\n/) : [];
  const head = lines.findIndex((l) => l.trim() === LESSONS_HEADING);
  if (head === -1) {
    const added = [...(lines.length && lines.at(-1)?.trim() ? [''] : []), LESSONS_HEADING, '', line];
    const at = lines.length;
    return { text: `${[...lines, ...added].join('\n')}\n`, at, added };
  }
  let end = lines.length; // the section runs to the next heading of level 1 or 2
  for (let i = head + 1; i < lines.length; i += 1) if (/^#{1,2}\s/.test(lines[i] ?? '')) { end = i; break; }
  let last = end - 1;
  while (last > head && !(lines[last] ?? '').trim()) last -= 1;
  const at = last + 1;
  const added = last === head ? ['', line] : [line];
  const next = [...lines.slice(0, at), ...added, ...lines.slice(at)];
  return { text: `${next.join('\n')}\n`, at, added };
}

const CONTEXT = 3;
// What she sees before confirming: a few lines either side of the insertion.
export function diffLines(before: string, { at, added }: Appended): DiffLine[] {
  const lines = before.length ? before.replace(/\r?\n$/, '').split(/\r?\n/) : [];
  return [
    ...lines.slice(Math.max(0, at - CONTEXT), at).map((text): DiffLine => ({ kind: 'same', text })),
    ...added.map((text): DiffLine => ({ kind: 'add', text })),
    ...lines.slice(at, at + CONTEXT).map((text): DiffLine => ({ kind: 'same', text })),
  ];
}

// The Library's notes: <userData>/library/<slug>.md, one per domain topic. Petal owns the folder; nothing here touches ~/.claude.
// Reads never follow a symlink or leave the folder and stop at MAX_NOTE_BYTES; writes only ever add facts.
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { writeFileAtomic } from './atomic-file';
import type { LibraryDoc, LibraryEntry } from '../shared/library';

export const MAX_NOTE_BYTES = 512 * 1024;
const SLUG_CHARS = 60;
const TITLE_CHARS = 80;
const CATEGORY_CHARS = 32;
const FACT_CHARS = 500;
const EVIDENCE_CHARS = 300;
const PREVIEW_FACTS = 3;
const PREVIEW_CHARS = 360;
const EVIDENCE_HEADING = '## Evidence';
const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;

// Categories the extractor is offered first; it reuses these or one already in the Library before inventing one.
export const STARTER_CATEGORIES = ['Auth', 'Billing', 'Data', 'Infra', 'Integrations', 'Messaging', 'Payments', 'Product', 'Operations', 'Compliance'];

export const libraryDir = (): string => path.join(app.getPath('userData'), 'library');

// One topic the extractor found; facts are single-line Markdown bullets without the dash.
export interface TopicInput {
  topic: string;
  category: string;
  facts: string[];
  evidence: string;
}

export interface NoteSource {
  sessionId: string;
  date: string; // YYYY-MM-DD
}

interface Note {
  slug: string;
  title: string;
  category: string;
  updated: string;
  sources: string[]; // "<session id> <date>"
  facts: string; // the Markdown before the Evidence heading, as written
  evidence: string; // the Markdown after it
  mtimeMs: number;
}

export const squash = (text: unknown, max: number): string => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function slugify(topic: string): string {
  const slug = topic.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, SLUG_CHARS).replace(/-+$/, '');
  return slug || 'topic';
}

// The comparison key for a fact: case, punctuation and spacing don't make it new.
export const factKey = (fact: string): string => fact.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// A fact as one bullet line: no leading dash or bullet, no line breaks.
export const cleanFact = (fact: unknown): string => squash(String(fact ?? '').replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ''), FACT_CHARS);

// The top-level bullets of a block of Markdown, with indented continuation lines joined on.
export function bulletsOf(markdown: string): string[] {
  const out: string[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) out.push(bullet[1] ?? '');
    else if (/^\s+\S/.test(line) && out.length) out[out.length - 1] += ` ${line.trim()}`;
  }
  return out.map((b) => b.trim()).filter(Boolean);
}

// A frontmatter value: quoted when it could be misread.
const yamlValue = (text: string): string => (/^[\w(][^:#"']*$/.test(text) && !/\s$/.test(text) ? text : JSON.stringify(text));

function unquote(value: string): string {
  const text = value.trim();
  if (text.startsWith('"')) {
    try { return String(JSON.parse(text)); } catch { return text.slice(1, -1); }
  }
  return text.replace(/^'(.*)'$/, '$1');
}

// title, category, updated as text; sources as a list. Anything else is ignored.
export function parseNote(text: string, slug: string, mtimeMs = 0): Note {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  const meta: Record<string, string> = {};
  const sources: string[] = [];
  let inSources = false;
  for (const line of match?.[1]?.split(/\r?\n/) ?? []) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (inSources && item) { sources.push(unquote(item[1] ?? '')); continue; }
    const pair = /^([A-Za-z]+):\s*(.*)$/.exec(line);
    inSources = pair?.[1] === 'sources';
    if (pair?.[1] && !inSources) meta[pair[1]] = unquote(pair[2] ?? '');
  }
  const body = match ? text.slice(match[0].length) : text;
  const at = body.indexOf(`\n${EVIDENCE_HEADING}`);
  const split = body.startsWith(EVIDENCE_HEADING) ? 0 : at === -1 ? -1 : at + 1;
  return {
    slug,
    title: squash(meta.title, TITLE_CHARS) || slug,
    category: squash(meta.category, CATEGORY_CHARS) || 'General',
    updated: meta.updated ?? '',
    sources,
    facts: (split === -1 ? body : body.slice(0, split)).trim(),
    evidence: split === -1 ? '' : body.slice(split + EVIDENCE_HEADING.length).trim(),
    mtimeMs,
  };
}

export function serializeNote(note: Pick<Note, 'title' | 'category' | 'updated' | 'sources' | 'facts' | 'evidence'>): string {
  const head = [
    '---',
    `title: ${yamlValue(note.title)}`,
    `category: ${yamlValue(note.category)}`,
    `updated: ${note.updated}`,
    'sources:',
    ...note.sources.map((s) => `  - ${yamlValue(s)}`),
    '---',
    '',
  ];
  const evidence = note.evidence ? `\n\n${EVIDENCE_HEADING}\n\n${note.evidence}` : '';
  return `${head.join('\n')}\n${note.facts}${evidence}\n`;
}

// The note file's real path, or null when it is missing, too big, a link, or outside the folder.
function safeNotePath(dir: string, slug: string): { file: string; size: number; mtimeMs: number } | null {
  if (!SLUG.test(slug)) return null;
  const file = path.join(dir, `${slug}.md`);
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > MAX_NOTE_BYTES) return null; // lstat: a symlink is never a file here
    const root = fs.realpathSync(dir);
    if (path.dirname(fs.realpathSync(file)) !== root) return null;
    return { file, size: stat.size, mtimeMs: stat.mtimeMs };
  } catch {
    return null;
  }
}

function readNote(dir: string, slug: string): Note | null {
  const found = safeNotePath(dir, slug);
  if (!found) return null;
  try {
    return parseNote(fs.readFileSync(found.file, 'utf8'), slug, found.mtimeMs);
  } catch {
    return null;
  }
}

export function readNotes(dir: string = libraryDir()): Note[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names.filter((n) => n.endsWith('.md')).flatMap((n) => readNote(dir, n.slice(0, -3)) ?? []);
}

const updatedMsOf = (note: Note): number => {
  const ms = Date.parse(note.updated);
  return Number.isFinite(ms) ? ms : note.mtimeMs;
};

// Its first facts, without Markdown marks, for the Library's preview.
const previewOf = (facts: string): string =>
  bulletsOf(facts).slice(0, PREVIEW_FACTS).map((f) => f.replace(/[*_`[\]]/g, '').replace(/\]\([^)]*\)/g, '')).join('\n').slice(0, PREVIEW_CHARS);

export function listEntries(dir: string = libraryDir()): LibraryEntry[] {
  return readNotes(dir).map((note) => ({
    slug: note.slug,
    title: note.title,
    category: note.category,
    updated: note.updated || new Date(note.mtimeMs).toISOString(),
    updatedMs: updatedMsOf(note),
    sources: note.sources.length,
    preview: previewOf(note.facts),
  }));
}

export function readDoc(slug: unknown, dir: string = libraryDir()): LibraryDoc {
  const note = typeof slug === 'string' ? readNote(dir, slug) : null;
  if (!note) return { missing: true };
  const evidence = note.evidence ? `\n\n${EVIDENCE_HEADING}\n\n${note.evidence}` : '';
  return { slug: note.slug, title: note.title, category: note.category, updated: note.updated || new Date(note.mtimeMs).toISOString(), sources: note.sources, markdown: `${note.facts}${evidence}` };
}

// Her spelling of a category already in use, else a starter one, else the new name with a capital first letter.
export function canonicalCategory(raw: unknown, known: readonly string[]): string {
  const name = squash(raw, CATEGORY_CHARS).replace(/[^\p{L}\p{N} &/+-]/gu, '').trim();
  if (!name) return 'General';
  const match = [...known, ...STARTER_CATEGORIES].find((k) => k.toLowerCase() === name.toLowerCase());
  return match ?? name.charAt(0).toUpperCase() + name.slice(1);
}

// lstat: true for a dangling link too, which existsSync would miss.
const present = (file: string): boolean => { try { fs.lstatSync(file); return true; } catch { return false; } };

// A free slug for a new topic: the plain one, else -2, -3, ...
function freeSlug(dir: string, base: string, taken: Set<string>): string {
  for (let n = 1; ; n += 1) {
    const slug = n === 1 ? base : `${base.slice(0, SLUG_CHARS - String(n).length - 1)}-${n}`;
    if (!taken.has(slug) && !present(path.join(dir, `${slug}.md`))) return slug;
  }
}

export interface MergeResult {
  added: number;
  updated: number;
  slugs: string[]; // every note written
}

// New topics become notes; a topic already there (same title, any case) gains only facts it lacks.
export function mergeTopics(topics: readonly TopicInput[], source: NoteSource, { dir = libraryDir(), now = new Date() }: { dir?: string; now?: Date } = {}): MergeResult {
  fs.mkdirSync(dir, { recursive: true });
  const notes = readNotes(dir);
  const byTitle = new Map(notes.map((n) => [n.title.toLowerCase(), n]));
  const taken = new Set(notes.map((n) => n.slug));
  const categories = notes.map((n) => n.category);
  const sourceLine = `${source.sessionId} ${source.date}`;
  const result: MergeResult = { added: 0, updated: 0, slugs: [] };
  const added = new Set<string>(); // made this run, so a repeat topic isn't counted as an update
  for (const topic of topics) {
    const title = squash(topic.topic, TITLE_CHARS);
    const facts = topic.facts.map(cleanFact).filter(Boolean);
    if (!title || !facts.length) continue;
    const existing = byTitle.get(title.toLowerCase());
    const known = new Set(bulletsOf(existing?.facts ?? '').map(factKey));
    const fresh = facts.filter((f) => { const key = factKey(f); if (!key || known.has(key)) return false; known.add(key); return true; });
    if (!fresh.length) continue;
    const evidence = squash(topic.evidence, EVIDENCE_CHARS);
    const evidenceLine = evidence ? `- ${source.date} · ${evidence}` : '';
    const note: Note = existing ?? {
      slug: freeSlug(dir, slugify(title), taken),
      title,
      category: canonicalCategory(topic.category, categories),
      updated: '',
      sources: [],
      facts: '',
      evidence: '',
      mtimeMs: 0,
    };
    note.facts = [note.facts.trim(), fresh.map((f) => `- ${f}`).join('\n')].filter(Boolean).join('\n');
    if (evidenceLine && !note.evidence.includes(evidenceLine)) note.evidence = [note.evidence.trim(), evidenceLine].filter(Boolean).join('\n');
    if (!note.sources.includes(sourceLine)) note.sources.push(sourceLine);
    note.updated = now.toISOString();
    const file = path.join(dir, `${note.slug}.md`);
    if (present(file) && fs.lstatSync(file).isSymbolicLink()) continue; // never write through a link
    writeFileAtomic(file, serializeNote(note));
    if (existing) {
      if (!added.has(note.slug)) result.updated += 1;
    } else {
      added.add(note.slug);
      result.added += 1;
      byTitle.set(title.toLowerCase(), note);
      taken.add(note.slug);
      categories.push(note.category);
    }
    if (!result.slugs.includes(note.slug)) result.slugs.push(note.slug);
  }
  return result;
}

// The shared context store: what every session decided, left open and set as next, keyed by topic so a new session
// can read what related sessions already settled. Pure: the main process persists it, the Related view draws it.
import { confirmedItems, type ConfirmedReply } from './confirmed';
import { parseThreads } from './reply-threads';
import { newestStatus } from './status-lines';

export type ContextKind = 'decided' | 'open' | 'next';

export interface ContextEntry {
  kind: ContextKind;
  text: string; // plain markdown, one line
}

// One session's contribution: its topics, its entries, the files it edited, and when it last wrote.
export interface SessionContext {
  sessionId: string;
  cwd: string | null;
  repo: string | null;
  title: string; // the newest headline, or the first prompt
  topics: string[];
  entries: ContextEntry[];
  files: string[]; // files this session edited, for the overlap view
  firstAt: number | null;
  lastAt: number | null;
}

// Topics are what sessions share: a repo name and any ticket ids ("AB#10496", "PAY-412") in the replies.
const TICKET = /\b(?:[A-Z]{2,}#\d{2,}|[A-Z][A-Z0-9]{1,9}-\d{1,6})\b/g;
const MAX_TOPICS = 24;
const MAX_ENTRIES = 40;
const MAX_FILES = 200;

export function topicsOf(markdowns: readonly string[], repo: string | null): string[] {
  const found = new Set<string>();
  if (repo) found.add(repo);
  for (const text of markdowns) for (const id of text.match(TICKET) ?? []) found.add(id);
  return [...found].slice(0, MAX_TOPICS);
}

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

// Decided comes from the Confirmed grouping (a Decide answered by her next prompt), open from Open threads, next from the status strip.
export function entriesOf(newestFirst: readonly ConfirmedReply[]): ContextEntry[] {
  const groups = confirmedItems(newestFirst);
  const decided = groups.decided.map((item) => ({ kind: 'decided' as const, text: oneLine(item.answer ? `${item.text} · ${item.answer}` : item.text) }));
  const open = newestFirst[0] ? parseThreads(newestFirst[0].markdown).map((thread) => ({ kind: 'open' as const, text: oneLine(thread.question) })) : [];
  const next = newestStatus(newestFirst.map((r) => r.markdown))?.next;
  const nextEntry = next ? [{ kind: 'next' as const, text: oneLine(next) }] : [];
  return [...decided, ...open, ...nextEntry].slice(0, MAX_ENTRIES);
}

export const limitFiles = (files: readonly string[]): string[] => [...new Set(files)].slice(0, MAX_FILES);

// Related sessions, split by time: earlier ones this session could read (waits on), later ones that read it (waiting on this).
export interface RelatedWork {
  waitsOn: SessionContext[];
  waitingOnThis: SessionContext[];
  sharedTopics: Record<string, string[]>; // sessionId -> topics shared with this session (a plain object, so it crosses IPC)
  overlap: { file: string; sessions: SessionContext[] }[]; // a file this session edited that another session edited too
}

export function relatedWork(self: SessionContext, others: readonly SessionContext[]): RelatedWork {
  const mine = new Set(self.topics);
  const sharedTopics: Record<string, string[]> = {};
  const related: SessionContext[] = [];
  for (const other of others) {
    if (other.sessionId === self.sessionId) continue;
    const shared = other.topics.filter((topic) => mine.has(topic));
    if (!shared.length) continue;
    sharedTopics[other.sessionId] = shared;
    related.push(other);
  }
  const start = self.firstAt ?? 0;
  const byRecency = (a: SessionContext, b: SessionContext) => (b.lastAt ?? 0) - (a.lastAt ?? 0);
  const waitsOn = related.filter((s) => (s.firstAt ?? 0) < start).sort(byRecency);
  const waitingOnThis = related.filter((s) => (s.firstAt ?? 0) >= start).sort(byRecency);
  const myFiles = new Set(self.files);
  const overlap = [...myFiles]
    .map((file) => ({ file, sessions: others.filter((s) => s.sessionId !== self.sessionId && s.files.includes(file)) }))
    .filter(({ sessions }) => sessions.length > 0);
  return { waitsOn, waitingOnThis, sharedTopics, overlap };
}

// One line for the reader head when a session has related work, so it is seen without opening the tab; null when there is none.
export function relatedLine(work: RelatedWork): string | null {
  const parts: string[] = [];
  if (work.overlap.length) parts.push(work.overlap.length === 1 ? '1 file also being changed elsewhere' : `${work.overlap.length} files also being changed elsewhere`);
  const decided = work.waitsOn.reduce((sum, s) => sum + s.entries.filter((e) => e.kind === 'decided').length, 0);
  if (decided) parts.push(decided === 1 ? '1 decision made earlier' : `${decided} decisions made earlier`);
  else if (work.waitsOn.length) parts.push(work.waitsOn.length === 1 ? '1 earlier session' : `${work.waitsOn.length} earlier sessions`);
  if (work.waitingOnThis.length) parts.push(work.waitingOnThis.length === 1 ? '1 later session builds on this' : `${work.waitingOnThis.length} later sessions build on this`);
  return parts.length ? parts.join(' · ') : null;
}

// Short name for a file in the overlap list: the last two path segments.
export const shortFile = (file: string): string => file.split('/').slice(-2).join('/');

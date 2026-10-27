// Read-only index of recent Claude Code sessions, from bounded head/tail reads cached by mtime.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readHead, readTail, type JsonlSlice } from './jsonl-window';
import { promptText, commandText, queuedPromptText, trimTo } from './prompts';
import { liveSessions } from './sessions-monitor';
import { SESSION_ID } from './session-id';
import type { TranscriptEntry } from './transcript-entry';
import { historyFixture, isSnapshotRun } from './snapshot-mode';
import { allowedClaudeHome, claudeFolderAllowed } from './claude-folder';

const WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const HEAD_BYTES = 32 * 1024;
const TAIL_BYTES = 64 * 1024;
const FIRST_PROMPT_CHARS = 160;
const GROWN_BYTES_MAX = 8 * 1024 * 1024; // a window that holds no whole message grows up to this (pasted images make megabyte lines)
const NEWEST_SHOWN = 3;

export interface SessionRecord {
  sessionId: string;
  file: string;
  cwd: string | null;
  title: string; // latest ai-title, else first prompt: the name before naming was pinned (session-names.ts)
  firstAiTitle?: string | null; // Claude Code's first ai-title; fixtures leave it out
  customTitle?: string | null; // her latest /rename in Claude Code
  firstPrompt: string;
  lastAt: number;
  messages: number;
  messagesExact: boolean; // big logs are only sampled, so the count is a lower bound
  prompts?: number; // her own prompts, a lower bound on big logs; fixtures leave it out
}

export interface ListedSession extends SessionRecord {
  shortCwd: string;
  live: boolean;
}

const cache = new Map<string, { mtimeMs: number; size: number; record: SessionRecord }>();

// Top-level session logs only; subagent logs live in <session>/subagents/.
function sessionFiles(home: string | null = allowedClaudeHome()): string[] {
  if (!home) return [];
  const projectsDir = path.join(home, 'projects');
  let projects: string[];
  try {
    projects = fs.readdirSync(projectsDir);
  } catch {
    return [];
  }
  return projects.flatMap((project) => {
    const dir = path.join(projectsDir, project);
    try {
      return fs.readdirSync(dir)
        .filter((name) => name.endsWith('.jsonl') && SESSION_ID.test(name.slice(0, -6)))
        .map((name) => path.join(dir, name));
    } catch {
      return [];
    }
  });
}

const isMessage = (e: TranscriptEntry) => (e.type === 'user' || e.type === 'assistant') && !e.isSidechain;
const lastAiTitle = (entries: TranscriptEntry[]) => entries.filter((e) => e.type === 'ai-title' && e.aiTitle).at(-1)?.aiTitle;
const firstAiTitle = (entries: TranscriptEntry[]) => entries.find((e) => e.type === 'ai-title' && e.aiTitle)?.aiTitle;
const lastCustomTitle = (entries: TranscriptEntry[]) => entries.filter((e) => e.type === 'custom-title' && e.customTitle).at(-1)?.customTitle;

// A window cut inside one huge line parses to nothing, which once dropped the whole session; read more until a message shows.
function readUntilMessage(read: typeof readHead, file: string, bytes: number): JsonlSlice {
  let slice = read(file, bytes);
  while (!slice.covered && !slice.entries.some(isMessage) && bytes < GROWN_BYTES_MAX) {
    bytes = Math.min(bytes * 4, GROWN_BYTES_MAX);
    slice = read(file, bytes);
  }
  return slice;
}

// Her typed prompts only (no tool results, wrappers, reminders or slash commands); a line both windows read counts once.
const promptCount = (entries: TranscriptEntry[]): number =>
  new Set(entries.filter((e) => promptText(e) || queuedPromptText(e)).map((e) => e.uuid ?? JSON.stringify(e))).size;

const trimOrNull = (text: string | undefined): string | null => (text ? trimTo(text, 80) : null);

function buildRecord(file: string, stat: fs.Stats): SessionRecord {
  const head = readUntilMessage(readHead, file, HEAD_BYTES);
  const tail = head.covered ? head : readUntilMessage(readTail, file, TAIL_BYTES);
  const firstPrompt = head.entries.map((e) => promptText(e) || commandText(e)).find(Boolean) ?? '';
  const messages = head.covered
    ? head.entries.filter(isMessage).length
    : head.entries.filter(isMessage).length + tail.entries.filter(isMessage).length;
  const cwd = head.entries.find((e) => typeof e.cwd === 'string')?.cwd;
  return {
    sessionId: path.basename(file, '.jsonl'),
    file,
    cwd: typeof cwd === 'string' ? cwd : null,
    title: trimTo(lastAiTitle(tail.entries) ?? lastAiTitle(head.entries) ?? firstPrompt ?? '', 80),
    firstAiTitle: trimOrNull(firstAiTitle(head.entries) ?? firstAiTitle(tail.entries)),
    customTitle: trimOrNull(lastCustomTitle(tail.entries) ?? lastCustomTitle(head.entries)),
    firstPrompt: trimTo(firstPrompt, FIRST_PROMPT_CHARS),
    lastAt: stat.mtimeMs,
    messages,
    messagesExact: head.covered,
    prompts: promptCount(head.covered ? head.entries : [...head.entries, ...tail.entries]),
  };
}

function recordFor(file: string): SessionRecord | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.record;
  const record = buildRecord(file, stat);
  cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, record });
  return record;
}

const fixtures = (): SessionRecord[] => (isSnapshotRun() ? historyFixture.records : []);

const shortCwd = (cwd: string | null) => (cwd?.startsWith(os.homedir()) ? `~${cwd.slice(os.homedir().length)}` : cwd ?? '');

// The past week, plus any older session she starred (kept) that is still on disk.
// Empty until she allows reading her Claude folder, fixtures included, so History matches the reader.
// `home` is the Claude folder to list; a caller with its own resolved folder (Testing in snapshot runs) passes it.
export function listSessions(kept: ReadonlySet<string> = new Set(), home: string | null = allowedClaudeHome()): ListedSession[] {
  if (!claudeFolderAllowed() || !home) return [];
  return listed(wantedFiles(kept, home).map(recordFor), { addFixtures: true });
}

function wantedFiles(kept: ReadonlySet<string>, home: string): string[] {
  const since = Date.now() - WINDOW_DAYS * DAY_MS;
  const wanted = (file: string, mtime: number) => mtime >= since || kept.has(path.basename(file, '.jsonl'));
  return sessionFiles(home)
    .map((file) => { try { return { file, mtime: fs.statSync(file).mtimeMs }; } catch { return null; } }) // deleted mid-scan
    .filter((entry): entry is { file: string; mtime: number } => Boolean(entry && wanted(entry.file, entry.mtime)))
    .map(({ file }) => file);
}

// Records as History shows them: empty logs dropped, live ones marked, newest first.
function listed(found: (SessionRecord | null)[], { addFixtures }: { addFixtures: boolean }): ListedSession[] {
  const live = new Set(liveSessions().map((s) => s.sessionId));
  if (isSnapshotRun()) historyFixture.live.forEach((id) => live.add(id));
  const records = found.filter((record): record is SessionRecord => Boolean(record && (record.title || record.messages)));
  return [...(addFixtures ? fixtures() : []), ...records]
    .map((record) => ({ ...record, shortCwd: shortCwd(record.cwd), live: live.has(record.sessionId) }))
    .sort((a, b) => b.lastAt - a.lastAt);
}

export interface PastSessionsSummary {
  sessions: number;
  projects: number;
  newest: { title: string; project: string }[];
}

const yieldToEvents = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
const folderOf = (session: ListedSession): string => path.dirname(session.file);

// The setup guide's "you've used Claude Code before" count: the same files and filter History lists, read off the
// main thread's critical path one log at a time (it warms History's cache too). Fixtures are left out.
export async function pastSessionsSummary(home: string | null = allowedClaudeHome()): Promise<PastSessionsSummary> {
  if (!claudeFolderAllowed() || !home) return { sessions: 0, projects: 0, newest: [] };
  const found: (SessionRecord | null)[] = [];
  for (const file of wantedFiles(new Set(), home)) {
    found.push(recordFor(file));
    await yieldToEvents();
  }
  const sessions = listed(found, { addFixtures: false });
  // A project is one projects/<folder>; a log with no cwd borrows its name from a sibling that has one.
  const names = new Map<string, string>();
  for (const s of sessions) if (s.shortCwd && !names.has(folderOf(s))) names.set(folderOf(s), s.shortCwd);
  const projectOf = (s: ListedSession) => s.shortCwd || names.get(folderOf(s)) || path.basename(folderOf(s));
  return {
    sessions: sessions.length,
    projects: new Set(sessions.map(folderOf)).size,
    newest: sessions.slice(0, NEWEST_SHOWN).map((s) => ({ title: s.title, project: projectOf(s) })),
  };
}

// A session's log stays in one folder, so a found path skips the scan of every project next time.
const fileById = new Map<string, string>();

export const findRecord = (sessionId: string | null | undefined): SessionRecord | null => {
  if (!sessionId || !SESSION_ID.test(sessionId) || !claudeFolderAllowed()) return null;
  const fixture = fixtures().find((r) => r.sessionId === sessionId);
  if (fixture) return fixture;
  const known = fileById.get(sessionId);
  const knownRecord = known ? recordFor(known) : null;
  if (knownRecord) return knownRecord;
  const file = sessionFiles().find((f) => path.basename(f, '.jsonl') === sessionId);
  if (file) fileById.set(sessionId, file); else fileById.delete(sessionId);
  return file ? recordFor(file) : null;
};

export const isLive = (sessionId: string): boolean =>
  (isSnapshotRun() && historyFixture.live.includes(sessionId)) || liveSessions().some((s) => s.sessionId === sessionId);

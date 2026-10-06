// Read-only index of recent Claude Code sessions, from bounded head/tail reads cached by mtime.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readHead, readTail } from './jsonl-window';
import { promptText, commandText, trimTo } from './prompts';
import { liveSessions } from './sessions-monitor';
import { SESSION_ID } from './session-id';
import type { TranscriptEntry } from './transcript-entry';

const WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const HEAD_BYTES = 32 * 1024;
const TAIL_BYTES = 64 * 1024;
const FIRST_PROMPT_CHARS = 160;
const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

export interface SessionRecord {
  sessionId: string;
  file: string;
  cwd: string | null;
  title: string;
  firstPrompt: string;
  lastAt: number;
  messages: number;
  messagesExact: boolean; // big logs are only sampled, so the count is a lower bound
}

export interface ListedSession extends SessionRecord {
  shortCwd: string;
  live: boolean;
}

const cache = new Map<string, { mtimeMs: number; size: number; record: SessionRecord }>();

// Top-level session logs only; subagent logs live in <session>/subagents/.
function sessionFiles(): string[] {
  let projects: string[];
  try {
    projects = fs.readdirSync(PROJECTS_DIR);
  } catch {
    return [];
  }
  return projects.flatMap((project) => {
    const dir = path.join(PROJECTS_DIR, project);
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

function buildRecord(file: string, stat: fs.Stats): SessionRecord {
  const head = readHead(file, HEAD_BYTES);
  const tail = head.covered ? head : readTail(file, TAIL_BYTES);
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
    firstPrompt: trimTo(firstPrompt, FIRST_PROMPT_CHARS),
    lastAt: stat.mtimeMs,
    messages,
    messagesExact: head.covered,
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

const shortCwd = (cwd: string | null) => (cwd?.startsWith(os.homedir()) ? `~${cwd.slice(os.homedir().length)}` : cwd ?? '');

export function listSessions(): ListedSession[] {
  const since = Date.now() - WINDOW_DAYS * DAY_MS;
  const live = new Set(liveSessions().map((s) => s.sessionId));
  return sessionFiles()
    .map((file) => { try { return { file, mtime: fs.statSync(file).mtimeMs }; } catch { return null; } }) // deleted mid-scan
    .filter((entry): entry is { file: string; mtime: number } => Boolean(entry && entry.mtime >= since))
    .map(({ file }) => recordFor(file))
    .filter((record): record is SessionRecord => Boolean(record && (record.title || record.messages)))
    .map((record) => ({ ...record, shortCwd: shortCwd(record.cwd), live: live.has(record.sessionId) }))
    .sort((a, b) => b.lastAt - a.lastAt);
}

export const findRecord = (sessionId: string | null | undefined): SessionRecord | null => {
  if (!sessionId || !SESSION_ID.test(sessionId)) return null;
  const file = sessionFiles().find((f) => path.basename(f, '.jsonl') === sessionId);
  return file ? recordFor(file) : null;
};

export const isLive = (sessionId: string): boolean => liveSessions().some((s) => s.sessionId === sessionId);

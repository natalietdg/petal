// The shared context store on disk: <userData>/context-store.json, one SessionContext per session the reader has followed.
// A live session rewrites its own record on every update; the Related view reads everyone else's. Nothing here touches ~/.claude.
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { writeJsonAtomic } from './atomic-file';
import { claudeFolderAllowed } from './claude-folder';
import { entriesOf, limitFiles, relatedWork, topicsOf, type RelatedWork, type SessionContext } from '../shared/context-store';
import { replyHeadline } from '../shared/sessions-board';
import type { Reply } from '../shared/types';

const VERSION = 1;
const SAVE_DELAY_MS = 2000; // a live session grows line by line; batch the writes
const MAX_SESSIONS = 500; // the oldest records drop out past this

interface StoreFile {
  version: number;
  sessions: Record<string, SessionContext>;
}

const storeFile = (): string => path.join(app.getPath('userData'), 'context-store.json');

let sessions: Record<string, SessionContext> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function loaded(): Record<string, SessionContext> {
  if (sessions) return sessions;
  try {
    const data = JSON.parse(fs.readFileSync(storeFile(), 'utf8')) as StoreFile;
    sessions = data.version === VERSION && data.sessions ? data.sessions : {};
  } catch {
    sessions = {};
  }
  return sessions;
}

function save(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const all = loaded();
    const kept = Object.values(all).sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0)).slice(0, MAX_SESSIONS);
    sessions = Object.fromEntries(kept.map((s) => [s.sessionId, s]));
    try {
      writeJsonAtomic(storeFile(), { version: VERSION, sessions } satisfies StoreFile);
    } catch {
      // A failed save costs nothing but the next read; the store is rebuilt from live sessions as they run.
    }
  }, SAVE_DELAY_MS);
}

const timeOf = (stamp: string | undefined): number | null => {
  const ms = stamp ? Date.parse(stamp) : NaN;
  return Number.isNaN(ms) ? null : ms;
};

export interface RecordInput {
  sessionId: string;
  cwd: string | null;
  repo: string | null;
  replies: readonly Reply[]; // newest first
  files: readonly string[];
}

// Rewrites one session's record from what the reader currently shows.
export function record({ sessionId, cwd, repo, replies, files }: RecordInput): void {
  if (!claudeFolderAllowed() || !replies.length) return;
  const newest = replies[0];
  const oldest = replies[replies.length - 1];
  const previous = loaded()[sessionId];
  const markdowns = replies.map((r) => r.markdown);
  loaded()[sessionId] = {
    sessionId,
    cwd,
    repo,
    title: (newest && replyHeadline(newest.markdown)) || oldest?.prompt.slice(0, 120) || '',
    topics: topicsOf(markdowns, repo),
    entries: entriesOf(replies),
    files: limitFiles([...(previous?.files ?? []), ...files]),
    firstAt: previous?.firstAt ?? timeOf(oldest?.timestamp),
    lastAt: timeOf(newest?.timestamp) ?? previous?.lastAt ?? null,
  };
  save();
}

// When a session's record was last written from, so a backfill skips logs it has already read.
export const recordedAt = (sessionId: string): number | null => loaded()[sessionId]?.lastAt ?? null;

// What the Related view draws for one session; null when the session has no record yet.
export function related(sessionId: string): RelatedWork | null {
  const all = loaded();
  const self = all[sessionId];
  if (!self) return null;
  return relatedWork(self, Object.values(all));
}

export const forgetAll = (): void => { sessions = {}; save(); };

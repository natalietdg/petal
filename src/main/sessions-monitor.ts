// Read-only overview of every live Claude Code session on this Mac.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSessionFile, transcriptPath, sessionsDir, type SessionFile } from './claude-session';
import { claudeFolderAllowed } from './claude-folder';
import { recentActivity } from './activity';
import { readHead } from './jsonl-window';
import { promptText, trimTo } from './prompts';
import { sessionTitle } from '../shared/session-label';

const SHOWN_KINDS = new Set(['interactive', 'bg']);
export const SUBAGENT_WINDOW_MS = 2 * 60 * 1000; // an agent with no write for longer counts as idle and is hidden
const RECENT_COUNT = 5;
const TASK_MAX = 70;
const TASK_HEAD_BYTES = 64 * 1024;
export const FALLBACK_TASK = 'Background agent';

export interface SessionCounts {
  total: number;
  busy: number;
  agents: number; // subagents active in the last 2 min, across all live sessions
}

export interface SubagentRow {
  id: string;
  task: string;
  updatedAt: number;
  activity: string | undefined;
}

// Where a session's subagent transcripts live; the snapshot harness swaps in a scratch folder.
export type SubagentsDirOf = (session: SessionFile) => string;

export interface SessionRow {
  sessionId: string;
  name: string;
  cwd: string;
  kind: string | undefined;
  status: 'busy' | 'idle';
  updatedAt: number | null;
  isOwn: boolean;
  activity: string | undefined;
  recent: (string | undefined)[];
  subagents: SubagentRow[];
}

export interface SessionsSnapshot {
  counts: SessionCounts;
  rows?: SessionRow[];
}

export interface SnapshotOptions {
  detailed?: boolean;
  expandedIds?: string[];
  ownSessionId?: string | null;
  nameOf?: (session: SessionFile) => string; // the shared session name; never Claude Code's "<folder>-<id>" session name
}

// Session files outlive their process; signal 0 only checks it exists.
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function liveSessions(): SessionFile[] {
  const dir = sessionsDir();
  if (!dir) return [];
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((name) => /^\d+\.json$/.test(name));
  } catch {
    return [];
  }
  return names
    .map((name) => readSessionFile(Number(name.slice(0, -5))))
    .filter((s): s is SessionFile => Boolean(s && s.kind && SHOWN_KINDS.has(s.kind) && isAlive(s.pid)))
    .sort((a, b) => Number(b.status === 'busy') - Number(a.status === 'busy') || (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

export const shortCwd = (cwd: string): string => (cwd.startsWith(os.homedir()) ? `~${cwd.slice(os.homedir().length)}` : cwd);

export const subagentsDir: SubagentsDirOf = (session) => path.join(path.dirname(transcriptPath(session)), session.sessionId, 'subagents');

interface SubagentFile {
  id: string;
  file: string;
  mtime: number;
  size: number;
}

// readdir + stat only, so the collapsed pill can count every session cheaply.
export function activeSubagentFiles(dir: string, now = Date.now()): SubagentFile[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((name) => name.endsWith('.jsonl'));
  } catch {
    return [];
  }
  return names.flatMap((name): SubagentFile[] => {
    try {
      const { mtimeMs, size } = fs.statSync(path.join(dir, name));
      return now - mtimeMs < SUBAGENT_WINDOW_MS ? [{ id: name.replace(/^agent-|\.jsonl$/g, ''), file: path.join(dir, name), mtime: mtimeMs, size }] : [];
    } catch {
      return []; // deleted between readdir and stat
    }
  }).sort((a, b) => b.mtime - a.mtime);
}

// The Agent tool's description from agent-<id>.meta.json, when Claude Code wrote one.
function metaDescription(file: string): string {
  try {
    const meta = JSON.parse(fs.readFileSync(file.replace(/\.jsonl$/, '.meta.json'), 'utf8')) as { description?: unknown };
    return typeof meta.description === 'string' ? meta.description.trim() : '';
  } catch {
    return '';
  }
}

// The delegated prompt's first real line. Subagent turns are all sidechain, which promptText skips, so it is cleared here.
function firstPromptLine(file: string): string {
  const first = readHead(file, TASK_HEAD_BYTES).entries.find((entry) => entry.type === 'user');
  const text = first ? promptText({ ...first, isSidechain: false }) : '';
  return text.split('\n').find((line) => line.trim()) ?? '';
}

export function subagentTask(file: string): string {
  const task = metaDescription(file) || firstPromptLine(file);
  return task ? trimTo(task, TASK_MAX) : FALLBACK_TASK;
}

// Task and activity per file, reread only when the file's mtime or size moves.
const detailCache = new Map<string, { mtime: number; size: number; task: string; activity: string | undefined }>();

function describeSubagent({ id, file, mtime, size }: SubagentFile): SubagentRow {
  let cached = detailCache.get(file);
  if (!cached || cached.mtime !== mtime || cached.size !== size) {
    const task = cached && cached.task !== FALLBACK_TASK ? cached.task : subagentTask(file); // a meta file can land after the first write
    cached = { mtime, size, task, activity: recentActivity(file, 1)[0]?.text ?? 'Working' };
    detailCache.set(file, cached);
  }
  return { id, task: cached.task, updatedAt: mtime, activity: cached.activity };
}

// Drops cache entries for agents that went idle, so the cache stays as small as the active set.
function pruneCache(active: ReadonlySet<string>): void {
  for (const file of detailCache.keys()) if (!active.has(file)) detailCache.delete(file);
}

export function activeSubagents(dir: string, now = Date.now()): SubagentRow[] {
  return activeSubagentFiles(dir, now).map(describeSubagent);
}

// The idle session updated longest ago, offered by "Close oldest idle"; busy or unknown status never is.
export function oldestIdle(sessions: readonly SessionFile[]): SessionFile | null {
  let oldest: SessionFile | null = null;
  for (const s of sessions) {
    if (s.status === 'idle' && (!oldest || (s.updatedAt ?? 0) < (oldest.updatedAt ?? 0))) oldest = s;
  }
  return oldest;
}

// Collapsed pill needs counts only (agents by stat); the open panel reads jsonl tails.
export function snapshot(
  { detailed, expandedIds = [], ownSessionId = null, nameOf = (s) => sessionTitle({ cwd: s.cwd }) }: SnapshotOptions,
  sessions: SessionFile[] = liveSessions(),
  subagentsDirOf: SubagentsDirOf = subagentsDir,
): SessionsSnapshot {
  if (!claudeFolderAllowed()) sessions = []; // fixture sessions too: their logs are read below
  const busy = sessions.filter((s) => s.status === 'busy').length;
  if (!detailed) {
    const agents = sessions.reduce((sum, s) => sum + activeSubagentFiles(subagentsDirOf(s)).length, 0);
    return { counts: { total: sessions.length, busy, agents } };
  }

  const expanded = new Set(expandedIds);
  const seen = new Set<string>();
  const rows = sessions.map((s): SessionRow => {
    const recent = recentActivity(transcriptPath(s), RECENT_COUNT);
    const files = activeSubagentFiles(subagentsDirOf(s));
    for (const f of files) seen.add(f.file);
    return {
      sessionId: s.sessionId,
      name: nameOf(s),
      cwd: shortCwd(s.cwd),
      kind: s.kind,
      status: s.status === 'busy' ? 'busy' : 'idle',
      updatedAt: s.updatedAt ?? null,
      isOwn: s.sessionId === ownSessionId,
      activity: recent.at(-1)?.text ?? '',
      recent: expanded.has(s.sessionId) ? recent.map((a) => a.text).reverse() : [],
      subagents: files.map(describeSubagent),
    };
  });
  pruneCache(seen);
  const agents = rows.reduce((sum, row) => sum + row.subagents.length, 0);
  return { counts: { total: sessions.length, busy, agents }, rows };
}

// Read-only overview of every live Claude Code session on this Mac.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSessionFile, transcriptPath, SESSIONS_DIR, type SessionFile } from './claude-session';
import { recentActivity } from './activity';

const SHOWN_KINDS = new Set(['interactive', 'bg']);
const SUBAGENT_WINDOW_MS = 2 * 60 * 1000;
const RECENT_COUNT = 5;

export interface SessionCounts {
  total: number;
  busy: number;
}

export interface SubagentRow {
  id: string;
  updatedAt: number;
  activity: string | undefined;
}

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
  let names: string[];
  try {
    names = fs.readdirSync(SESSIONS_DIR).filter((name) => /^\d+\.json$/.test(name));
  } catch {
    return [];
  }
  return names
    .map((name) => readSessionFile(Number(name.slice(0, -5))))
    .filter((s): s is SessionFile => Boolean(s && s.kind && SHOWN_KINDS.has(s.kind) && isAlive(s.pid)))
    .sort((a, b) => Number(b.status === 'busy') - Number(a.status === 'busy') || (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

export const shortCwd = (cwd: string): string => (cwd.startsWith(os.homedir()) ? `~${cwd.slice(os.homedir().length)}` : cwd);

function activeSubagents(session: SessionFile): SubagentRow[] {
  const dir = path.join(path.dirname(transcriptPath(session)), session.sessionId, 'subagents');
  try {
    return fs.readdirSync(dir)
      .filter((name) => name.endsWith('.jsonl'))
      .map((name) => ({ name, file: path.join(dir, name), mtime: fs.statSync(path.join(dir, name)).mtimeMs }))
      .filter(({ mtime }) => Date.now() - mtime < SUBAGENT_WINDOW_MS)
      .map(({ name, file, mtime }) => ({
        id: name.replace(/^agent-|\.jsonl$/g, ''),
        updatedAt: mtime,
        activity: recentActivity(file, 1)[0]?.text ?? 'Working',
      }));
  } catch {
    return [];
  }
}

// The idle session updated longest ago, offered by "Close oldest idle"; busy or unknown status never is.
export function oldestIdle(sessions: readonly SessionFile[]): SessionFile | null {
  let oldest: SessionFile | null = null;
  for (const s of sessions) {
    if (s.status === 'idle' && (!oldest || (s.updatedAt ?? 0) < (oldest.updatedAt ?? 0))) oldest = s;
  }
  return oldest;
}

// Collapsed pill needs counts only; the open panel reads jsonl tails.
export function snapshot({ detailed, expandedIds = [], ownSessionId = null }: SnapshotOptions, sessions: SessionFile[] = liveSessions()): SessionsSnapshot {
  const counts = { total: sessions.length, busy: sessions.filter((s) => s.status === 'busy').length };
  if (!detailed) return { counts };

  const expanded = new Set(expandedIds);
  const rows = sessions.map((s): SessionRow => {
    const recent = recentActivity(transcriptPath(s), RECENT_COUNT);
    return {
      sessionId: s.sessionId,
      name: s.name || shortCwd(s.cwd),
      cwd: shortCwd(s.cwd),
      kind: s.kind,
      status: s.status === 'busy' ? 'busy' : 'idle',
      updatedAt: s.updatedAt ?? null,
      isOwn: s.sessionId === ownSessionId,
      activity: recent.at(-1)?.text ?? '',
      recent: expanded.has(s.sessionId) ? recent.map((a) => a.text).reverse() : [],
      subagents: expanded.has(s.sessionId) ? activeSubagents(s) : [],
    };
  });
  return { counts, rows };
}

// Finds the Claude Code process running inside our shell and its session log.
// ~/.claude/sessions/<pid>.json is undocumented, so every read is defensive.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
export const SESSIONS_DIR = path.join(CLAUDE_DIR, 'sessions');

export interface ProcessRow {
  pid: number;
  ppid: number;
  comm: string;
}

// ~/.claude/sessions/<pid>.json; only sessionId and cwd are checked, the rest is read if present.
export interface SessionFile {
  pid: number;
  sessionId: string;
  cwd: string;
  kind?: string;
  status?: string;
  name?: string;
  updatedAt?: number;
}

export interface ClaudeSession extends SessionFile {
  transcript: string;
}

// Claude Code names project folders after the cwd with every non-alphanumeric as '-'.
const projectSlug = (cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, '-');

export function listProcesses(): Promise<ProcessRow[]> {
  return new Promise((resolve) => {
    execFile('/bin/ps', ['-Ao', 'pid=,ppid=,comm='], (error, stdout) => {
      if (error) return resolve([]);
      resolve(stdout.split('\n').flatMap((line) => {
        const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
        return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), comm: match[3].trim() }] : [];
      }));
    });
  });
}

// "claude" or ".../bin/claude"; helpers show up as "claude bg-spare" / "claude bg-pty-host".
export const isClaudeCli = (comm: string): boolean => path.basename(comm) === 'claude';

// The command name of one pid (`ps -o comm=`), or null when it has no process.
export function processCommand(pid: number): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('/bin/ps', ['-o', 'comm=', '-p', String(pid)], (error, stdout) => resolve(error ? null : stdout.trim() || null));
  });
}

function descendants(rootPid: number, processes: readonly ProcessRow[]): ProcessRow[] {
  const found: ProcessRow[] = [];
  const queue = [rootPid];
  while (queue.length) {
    const parent = queue.shift();
    for (const proc of processes) {
      if (proc.ppid === parent) {
        found.push(proc);
        queue.push(proc.pid);
      }
    }
  }
  return found;
}

// True when a claude CLI runs anywhere under rootPid; the updater asks this about Petal itself.
export const claudeRunsUnder = (rootPid: number, processes: readonly ProcessRow[]): boolean =>
  descendants(rootPid, processes).some((proc) => isClaudeCli(proc.comm));

// Parsed ~/.claude/sessions/<pid>.json, or null when missing or malformed.
export function readSessionFile(pid: number): SessionFile | null {
  try {
    const session = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, `${pid}.json`), 'utf8')) as Partial<SessionFile>;
    if (typeof session.sessionId !== 'string' || typeof session.cwd !== 'string') return null;
    return { ...session, sessionId: session.sessionId, cwd: session.cwd, pid };
  } catch {
    return null;
  }
}

export const transcriptPath = ({ cwd, sessionId }: { cwd: string; sessionId: string }): string =>
  path.join(CLAUDE_DIR, 'projects', projectSlug(cwd), `${sessionId}.jsonl`);

// { pid, session } for the claude under shellPid, from one `ps` listing. session is null until its file is readable.
export function findClaudeSession(shellPid: number, processes: readonly ProcessRow[]): { pid: number | null; session: ClaudeSession | null } {
  const candidates = descendants(shellPid, processes).filter((proc) => isClaudeCli(proc.comm));
  for (const proc of candidates) {
    const session = readSessionFile(proc.pid);
    if (session) return { pid: proc.pid, session: { ...session, transcript: transcriptPath(session) } };
  }
  return candidates.length ? { pid: candidates[0].pid, session: null } : { pid: null, session: null };
}

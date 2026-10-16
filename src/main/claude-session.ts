// Finds the Claude Code process running inside our shell and its session log.
// ~/.claude/sessions/<pid>.json is undocumented, so every read is defensive.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { allowedClaudeHome, claudeHome } from './claude-folder';

// ~/.claude/sessions, or null until she allows reading her Claude folder.
export const sessionsDir = (): string | null => {
  const home = allowedClaudeHome();
  return home && path.join(home, 'sessions');
};

export interface ProcessRow {
  pid: number;
  ppid: number;
  comm: string;
  args?: string; // full command line, read only for node processes (see isClaudeCli)
}

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
export const projectSlug = (cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, '-');

const run = (args: string[]): Promise<string | null> =>
  new Promise((resolve) => execFile('/bin/ps', args, (error, stdout) => resolve(error ? null : stdout)));

const isNode = (comm: string): boolean => path.basename(comm) === 'node';

// "pid args" lines for these pids; a node process's command line says which script it runs.
async function commandLines(pids: number[]): Promise<Map<number, string>> {
  const lines = new Map<number, string>();
  if (!pids.length) return lines;
  for (const line of (await run(['-o', 'pid=,args=', '-p', pids.join(',')]))?.split('\n') ?? []) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (match) lines.set(Number(match[1]), match[2].trim());
  }
  return lines;
}

// One `ps` for every process, plus one for the command lines of node processes only.
export async function listProcesses(): Promise<ProcessRow[]> {
  const rows = parseProcessRows((await run(['-Ao', 'pid=,ppid=,comm='])) ?? '');
  const args = await commandLines(rows.filter((row) => isNode(row.comm)).map((row) => row.pid));
  return rows.map((row) => (args.has(row.pid) ? { ...row, args: args.get(row.pid) } : row));
}

export const parseProcessRows = (stdout: string): ProcessRow[] => stdout.split('\n').flatMap((line) => {
  const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
  return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), comm: match[3].trim() }] : [];
});

// The claude CLI under every documented install (code.claude.com/docs/en/setup):
// - native installer and Homebrew cask: a binary named claude ("claude", or ".../bin/claude" when run by path);
// - npm today: bin/claude links to the native bin/claude.exe (comm is the link, or claude.exe when run by its own path);
// - npm before the native package: node running .../bin/claude or .../@anthropic-ai/claude-code/cli.js,
//   which renames itself "claude" once it starts.
// Helpers ("claude bg-spare", "claude bg-pty-host") are not the CLI.
const NODE_CLAUDE = /^\S*node\s+(?:\S*\/)?(?:claude|@anthropic-ai\/claude-code\/cli\.js)(?:\s|$)/;
export function isClaudeCli(comm: string, args = ''): boolean {
  const name = path.basename(comm);
  if (name === 'claude' || name === 'claude.exe') return true;
  return isNode(comm) && NODE_CLAUDE.test(args);
}

// The command name and line of one pid, or null when it has no process.
export async function processCommand(pid: number): Promise<{ comm: string; args: string } | null> {
  const comm = (await run(['-o', 'comm=', '-p', String(pid)]))?.trim();
  if (!comm) return null;
  return { comm, args: (await run(['-o', 'args=', '-p', String(pid)]))?.trim() ?? '' };
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
  descendants(rootPid, processes).some((proc) => isClaudeCli(proc.comm, proc.args));

function parseSessionFile(text: string, pid: number): SessionFile | null {
  const session = JSON.parse(text) as Partial<SessionFile>;
  if (typeof session.sessionId !== 'string' || typeof session.cwd !== 'string') return null;
  return { ...session, sessionId: session.sessionId, cwd: session.cwd, pid };
}

// Parsed ~/.claude/sessions/<pid>.json, or null when missing or malformed.
export function readSessionFile(pid: number): SessionFile | null {
  const dir = sessionsDir();
  if (!dir) return null;
  try {
    return parseSessionFile(fs.readFileSync(path.join(dir, `${pid}.json`), 'utf8'), pid);
  } catch {
    return null;
  }
}

export async function readSessionFileAsync(pid: number): Promise<SessionFile | null> {
  const dir = sessionsDir();
  if (!dir) return null;
  try {
    return parseSessionFile(await fs.promises.readFile(path.join(dir, `${pid}.json`), 'utf8'), pid);
  } catch {
    return null;
  }
}

// Where a session's log lives; a path only: each session handed out came through the gate.
export const transcriptPath = ({ cwd, sessionId }: { cwd: string; sessionId: string }): string =>
  path.join(claudeHome(), 'projects', projectSlug(cwd), `${sessionId}.jsonl`);

// { pid, session } for the claude under shellPid, from one `ps` listing. session is null until its file is readable (or reading is off).

export function findClaudeSession(shellPid: number, processes: readonly ProcessRow[]): { pid: number | null; session: ClaudeSession | null } {
  const candidates = descendants(shellPid, processes).filter((proc) => isClaudeCli(proc.comm, proc.args));
  for (const proc of candidates) {
    const session = readSessionFile(proc.pid);
    if (session) return { pid: proc.pid, session: { ...session, transcript: transcriptPath(session) } };
  }
  return candidates.length ? { pid: candidates[0].pid, session: null } : { pid: null, session: null };
}

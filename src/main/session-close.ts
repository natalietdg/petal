// Closes one live Claude session for the Sessions panel. The pid only ever comes from its session file,
// it must be the claude CLI, and it gets SIGTERM; Petal never sends SIGKILL.
import { isClaudeCli, processCommand, readSessionFile, type SessionFile } from './claude-session';
import { isAlive, liveSessions } from './sessions-monitor';

export const CLOSE_WAIT_MS = 4000;
const POLL_MS = 100;

export type CloseOutcome = { closed: true; session: SessionFile } | { closed: false; note: string };

// Seams for tests; the defaults read the real session files and processes.
export interface CloseDeps {
  live: () => SessionFile[];
  command: (pid: number) => Promise<string | null>;
  reread: (pid: number) => SessionFile | null;
  terminate: (pid: number) => void;
  alive: (pid: number) => boolean;
  waitMs: number;
}

const DEFAULT_DEPS: CloseDeps = {
  live: liveSessions,
  command: processCommand,
  reread: readSessionFile,
  terminate: (pid) => process.kill(pid, 'SIGTERM'),
  alive: isAlive,
  waitMs: CLOSE_WAIT_MS,
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function exited(pid: number, alive: CloseDeps['alive'], waitMs: number): Promise<boolean> {
  for (const start = Date.now(); Date.now() - start < waitMs; await sleep(POLL_MS)) {
    if (!alive(pid)) return true;
  }
  return !alive(pid);
}

export async function closeSession(sessionId: string, overrides: Partial<CloseDeps> = {}): Promise<CloseOutcome> {
  const deps = { ...DEFAULT_DEPS, ...overrides };
  const session = deps.live().find((s) => s.sessionId === sessionId);
  if (!session) throw new Error('That Claude session is not running.');
  const { pid } = session;

  const command = await deps.command(pid);
  if (!command || !isClaudeCli(command)) throw new Error(`Refused: pid ${pid} is not the claude CLI (${command ?? 'no process'}).`);
  // The pid could have been reused since the list was read; its file must still name this session.
  if (deps.reread(pid)?.sessionId !== sessionId) throw new Error(`Refused: pid ${pid} no longer belongs to that session.`);

  deps.terminate(pid);
  return (await exited(pid, deps.alive, deps.waitMs)) ? { closed: true, session } : { closed: false, note: 'Still running' };
}

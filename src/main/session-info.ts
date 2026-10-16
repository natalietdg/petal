// A concluded session's "This session" facts: its Library notes, the test runs during it, and its test loop's last Loop line.
// Petal fills these in because Claude can't know them. Reads only that session's log, behind the folder gate.
import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow } from 'electron';
import { claudeFolderAllowed } from './claude-folder';
import * as configStore from './config-store';
import * as history from './history';
import * as librarySessions from './library-sessions';
import * as testingStore from './testing-store';
import { isReadingSession, onSessionChange } from './library-extract';
import { mergeLogRuns, readCriteria, repoRoot } from './testing-ipc';
import { assistantText } from './replies';
import { parseEntry } from './transcript-entry';
import { handle, send } from './ipc';
import { isSnapshotRun, testingFixture } from './snapshot-mode';
import { parseLoop, type LoopProgress } from '../shared/loop-line';
import { libraryLine, runsInSpan, testsLine, type SessionInfo, type Span } from '../shared/session-info';
import type { TabSessions } from './tab-session';

const CHUNK = 1 << 20;
const MAY_LOOP = /loop/i; // lines without the word can't hold a Loop line, so they skip JSON.parse
const TIMESTAMP = /"timestamp"\s*:\s*"([^"]+)"/;

// What a log has shown so far; a grown log is read from its offset only.
interface LogFacts { offset: number; rest: string; first: number | null; last: number | null; loop: LoopProgress | null }
const facts = new Map<string, LogFacts>();

function readLine(state: LogFacts, line: string): void {
  const stamp = Date.parse(TIMESTAMP.exec(line)?.[1] ?? '');
  if (Number.isFinite(stamp)) {
    state.first ??= stamp;
    state.last = Math.max(state.last ?? stamp, stamp);
  }
  if (!MAY_LOOP.test(line)) return;
  try {
    const progress = parseLoop(assistantText(parseEntry(line)));
    if (progress) state.loop = progress;
  } catch { /* a half-written or foreign line */ }
}

const reads = new Map<string, Promise<unknown>>(); // one read per log at a time, so offsets never race

function logFacts(file: string): Promise<LogFacts> {
  const run = (reads.get(file) ?? Promise.resolve()).then(() => readAppended(file));
  const settled = run.catch(() => undefined);
  reads.set(file, settled);
  void settled.then(() => { if (reads.get(file) === settled) reads.delete(file); });
  return run;
}

async function readAppended(file: string): Promise<LogFacts> {
  let state = facts.get(file);
  const { size } = await fs.promises.stat(file);
  if (!state || size < state.offset) {
    state = { offset: 0, rest: '', first: null, last: null, loop: null };
    facts.set(file, state);
  }
  if (size === state.offset) return state;
  const handle = await fs.promises.open(file, 'r');
  try {
    const buffer = Buffer.alloc(Math.min(CHUNK, size - state.offset));
    while (state.offset < size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, size - state.offset), state.offset);
      if (bytesRead <= 0) break;
      state.offset += bytesRead;
      const lines = (state.rest + buffer.toString('utf8', 0, bytesRead)).split('\n');
      state.rest = lines.pop() ?? '';
      for (const line of lines) readLine(state, line);
    }
  } finally {
    await handle.close();
  }
  return state;
}

interface Located { transcript: string; cwd: string | null; live: boolean }

// An open tab's session first (its log may be newer than History's list), else History's record.
function locate(sessionId: string, sessions: TabSessions): Located | null {
  for (const { feed } of sessions.values()) {
    const s = feed.session;
    if (s?.sessionId === sessionId && s.transcript) return { transcript: s.transcript, cwd: s.cwd ?? null, live: true };
  }
  const record = history.findRecord(sessionId);
  return record ? { transcript: record.file, cwd: record.cwd, live: false } : null;
}

const projectRoot = (cwd: string | null): string | null => {
  const dir = (isSnapshotRun() && testingFixture.project) || cwd;
  return dir && path.isAbsolute(dir) ? repoRoot(dir) : null;
};

export async function sessionInfo(sessionId: string, sessions: TabSessions, now = Date.now()): Promise<SessionInfo | null> {
  if (!claudeFolderAllowed()) return null;
  const found = locate(sessionId, sessions);
  if (!found || !fs.existsSync(found.transcript)) return null;
  const log = await logFacts(found.transcript);
  const library = libraryLine({ reading: isReadingSession(sessionId), stored: librarySessions.stored(sessionId), autoBuild: configStore.load().library.autoBuild });
  const root = projectRoot(found.cwd);
  let tests = null;
  let loop = null;
  if (root) {
    await mergeLogRuns(root, [{ transcript: found.transcript, sessionId }]);
    const span: Span = { start: log.first ?? now, end: found.live ? now : log.last ?? now };
    tests = testsLine(runsInSpan(testingStore.load(root).runs, span, sessionId));
    if (log.loop) {
      const criteria = readCriteria(root);
      loop = { progress: log.loop, fixed: criteria ? criteria.bugs.filter((b) => b.status === 'fixed').length : null };
    }
  } else if (log.loop) {
    loop = { progress: log.loop, fixed: null };
  }
  return { sessionId, library, tests, loop };
}

const VALID_ID = /^[\w-]{1,128}$/;

export function registerSessionInfoIpc({ sessions }: { sessions: TabSessions }): void {
  handle('conclusion:info', (_event, { sessionId }) => (typeof sessionId === 'string' && VALID_ID.test(sessionId) ? sessionInfo(sessionId, sessions) : null));
  // The Library started or finished reading a session: windows showing its conclusion ask again.
  onSessionChange((sessionId) => { for (const win of BrowserWindow.getAllWindows()) send(win.webContents, 'conclusion:info-changed', { sessionId }); });
}

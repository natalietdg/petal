// Coordination across live sessions, every few seconds: tails each session's log (async, its last 2MB first) for
// edit-tool files and Task lines, moves tasks, finds file clashes, and records the activity feed. Read only, but for
// Petal's own task files. Nothing is read while she hasn't allowed the Claude folder.
import path from 'node:path';
import { BrowserWindow } from 'electron';
import { send } from './ipc';
import { claudeFolderAllowed } from './claude-folder';
import { transcriptPath } from './claude-session';
import { panelSessions } from './agents-ipc';
import { repoBranch, repoRoot } from './repo-label';
import { sessionTitleFor } from './session-title';
import { JsonlTail } from './transcript';
import { parseEntry } from './transcript-entry';
import { SessionLog, editsByTurn } from './session-log';
import { loadTasks, updateTasks } from './tasks-store';
import { recordActivity } from './activity-feed';
import * as conclusionsStore from './conclusions-store';
import { CLASH_WINDOW_MS, findClashes, insideRoot } from '../shared/file-clash';
import { applyTaskLine, type Task } from '../shared/tasks';
import { sessionTask, type CoordSession, type CoordView } from '../shared/coord';
import { conclusionGist } from '../shared/conclusion';
import type { TabSessions } from './tab-session';

const TICK_MS = 2500;
const TAIL_BYTES = 2 * 1024 * 1024; // recent edits and Task lines sit at the end of a long log

interface Watched {
  file: string;
  log: SessionLog;
  tail: JsonlTail;
}

// One live session, from a tab here or a session file elsewhere.
interface Live {
  sessionId: string;
  transcript: string;
  cwd: string | null;
}

const watched = new Map<string, Watched>(); // by session id
const recordedEdits = new Map<string, string>(); // activity id -> files it listed
const recordedClashes = new Set<string>();
const recordedConclusions = new Map<string, string | null>(); // session id -> conclusion time recorded
let view: CoordView = { sessions: [] };
let viewKey = '';
let ticking: Promise<void> | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
let tabSessions: TabSessions | null = null;
let labelOf: (sessionId: string) => string | null = () => null;

// A tab's own label when a tab here follows the session (it knows the first prompt), else the shared title.
export const sessionName = (sessionId: string, cwd: string | null): string => labelOf(sessionId) ?? sessionTitleFor(sessionId, { cwd });

function watch(sessionId: string, file: string): Watched {
  const known = watched.get(sessionId);
  if (known?.file === file) return known;
  known?.tail.stop();
  const log = new SessionLog();
  const lines = (batch: string[]) => {
    for (const line of batch) {
      try { log.add(parseEntry(line)); } catch { /* a cut first line or a malformed one */ }
    }
  };
  const next = { file, log, tail: new JsonlTail(file, { lines, restart: () => log.reset() }, { lastBytes: TAIL_BYTES }) };
  watched.set(sessionId, next);
  return next;
}

// Tabs here first (a snapshot fixture's log lives outside ~/.claude), then every live session file.
function liveSessions(): Live[] {
  const out = new Map<string, Live>();
  for (const { feed } of tabSessions?.values() ?? []) {
    const s = feed.session;
    if (s && !out.has(s.sessionId)) out.set(s.sessionId, { sessionId: s.sessionId, transcript: s.transcript, cwd: s.cwd ?? null });
  }
  for (const s of panelSessions()) {
    if (!out.has(s.sessionId)) out.set(s.sessionId, { sessionId: s.sessionId, transcript: transcriptPath(s), cwd: s.cwd });
  }
  return [...out.values()];
}

const lineWords = { working: 'started', blocked: 'is blocked on', done: 'finished' } as const;

function applyLines(session: CoordSession, log: SessionLog): void {
  const lines = log.takeTaskLines();
  if (!session.root || !lines.length) return;
  const root = session.root;
  for (const seen of lines) {
    try {
      const applied = updateTasks(root, (tasks) => applyTaskLine(tasks, session.sessionId, seen.line, seen.at));
      if (!applied) continue;
      recordActivity({
        id: `task:${applied.task.id}:${applied.task.status}:${seen.at}`, kind: 'task', at: seen.at,
        sessionId: session.sessionId, sessionName: session.name, branch: session.branch, repo: session.repo,
        text: `${session.name} ${lineWords[seen.line.state]} “${applied.task.title}”`,
        target: seen.replyId ? { replyId: seen.replyId } : undefined,
      });
    } catch (error) {
      console.error('[petal] task line not applied:', (error as Error).message);
    }
  }
}

const relative = (file: string, root: string | null): string => (root && insideRoot(file, root)) || path.basename(file);

function recordEdits(session: CoordSession, log: SessionLog, now: number): void {
  for (const turn of editsByTurn(log.edits())) {
    if (turn.at < now - CLASH_WINDOW_MS) continue; // older work was before Petal looked; the feed starts from now
    const id = `edits:${session.sessionId}:${turn.turnId}`;
    const files = turn.files.map((f) => relative(f, session.root));
    const key = files.join('\n');
    if (recordedEdits.get(id) === key) continue;
    recordedEdits.set(id, key);
    recordActivity({
      id, kind: 'edits', at: turn.at, sessionId: session.sessionId, sessionName: session.name, branch: session.branch, repo: session.repo,
      text: `${session.name} edited ${files.length === 1 ? files[0] : `${files.length} files`}`, detail: files,
      target: turn.replyId ? { replyId: turn.replyId } : undefined,
    });
  }
}

function recordClashes(sessions: readonly CoordSession[]): void {
  for (const session of sessions) {
    for (const clash of session.clashes) {
      const pair = [session.sessionId, clash.otherSessionId].sort().join('+');
      const id = `clash:${pair}:${clash.file}`;
      if (recordedClashes.has(id)) continue;
      recordedClashes.add(id);
      recordActivity({
        id, kind: 'clash', at: clash.at, sessionId: session.sessionId, sessionName: session.name, branch: session.branch, repo: session.repo,
        text: `${session.name} and ${clash.otherName} both edited ${clash.file}`, detail: [clash.file],
        toSessionId: clash.otherSessionId, toSessionName: clash.otherName,
      });
    }
  }
}

function recordConclusion(session: CoordSession): void {
  const conclusion = conclusionsStore.stored(session.sessionId);
  if (!conclusion || recordedConclusions.get(session.sessionId) === conclusion.at) return;
  recordedConclusions.set(session.sessionId, conclusion.at);
  const parsed = Date.parse(conclusion.at ?? '');
  recordActivity({
    id: `conclusion:${session.sessionId}:${conclusion.at ?? 'unknown'}`, kind: 'conclusion', at: Number.isNaN(parsed) ? Date.now() : parsed,
    sessionId: session.sessionId, sessionName: session.name, branch: session.branch, repo: session.repo,
    text: `${session.name} concluded: ${conclusionGist(conclusion)}`,
  });
}

function broadcast(): void {
  for (const win of BrowserWindow.getAllWindows()) send(win.webContents, 'coord:update', view);
}

async function tickOnce(): Promise<void> {
  if (!claudeFolderAllowed()) {
    for (const w of watched.values()) w.tail.stop();
    watched.clear();
    view = { sessions: [] };
  } else {
    const live = liveSessions();
    const ids = new Set(live.map((s) => s.sessionId));
    for (const [id, w] of watched) {
      if (ids.has(id)) continue;
      w.tail.stop();
      watched.delete(id);
      for (const key of recordedEdits.keys()) if (key.startsWith(`edits:${id}:`)) recordedEdits.delete(key); // a closed session's turns are done
    }
    const logs = live.map((s) => watch(s.sessionId, s.transcript));
    await Promise.all(logs.map((w) => w.tail.poll()));
    const now = Date.now();
    const tasksByRoot = new Map<string, Task[]>();
    const sessions: CoordSession[] = live.map((s) => {
      const root = repoRoot(s.cwd);
      return { sessionId: s.sessionId, name: sessionName(s.sessionId, s.cwd), root, repo: root ? path.basename(root) : null, branch: repoBranch(s.cwd), task: null, clashes: [] };
    });
    sessions.forEach((session, i) => {
      const log = logs[i];
      if (!log) return;
      applyLines(session, log.log);
      recordEdits(session, log.log, now);
      recordConclusion(session);
    });
    for (const session of sessions) {
      if (!session.root) continue;
      if (!tasksByRoot.has(session.root)) tasksByRoot.set(session.root, loadTasks(session.root).tasks);
      session.task = sessionTask(tasksByRoot.get(session.root) ?? [], session.sessionId);
    }
    const clashes = findClashes(sessions.map((s, i) => ({ sessionId: s.sessionId, name: s.name, root: s.root, edits: logs[i]?.log.edits() ?? [] })), now);
    for (const session of sessions) session.clashes = clashes.get(session.sessionId) ?? [];
    recordClashes(sessions);
    view = { sessions };
  }
  const key = JSON.stringify(view);
  if (key !== viewKey) {
    viewKey = key;
    broadcast();
  }
}

// One tick at a time; a call during one waits for it and runs once more after.
export function refresh(): Promise<void> {
  const run: Promise<void> = (ticking ?? Promise.resolve()).then(tickOnce).catch((error: unknown) => console.error('[petal] coordination tick failed:', error));
  ticking = run;
  void run.finally(() => { if (ticking === run) ticking = null; });
  return run;
}

export const current = (): CoordView => view;

export function start(sessions: TabSessions, { tabLabel }: { tabLabel: (sessionId: string) => string | null }): void {
  tabSessions = sessions;
  labelOf = tabLabel;
  clearInterval(timer);
  timer = setInterval(() => void refresh(), TICK_MS);
  void refresh();
}

export function stop(): void {
  clearInterval(timer);
  for (const w of watched.values()) w.tail.stop();
  watched.clear();
}

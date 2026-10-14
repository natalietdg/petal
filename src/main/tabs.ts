// Terminal tabs: one shell and one reader feed per tab, keyed by window and tab id, plus their IPC.
import { BrowserWindow, webContents, type WebContents } from 'electron';
import { spawnShell } from './pty';
import { ReaderFeed, type ReplyFinished } from './reader-feed';
import { closeConcluded } from './sessions-ipc';
import * as responseHook from './response-hook';
import * as organizer from './session-organizer';
import { sessionTitleFor } from './session-title';
import { claudeFixture, claudeStarts, isSnapshotRun, tabFixture, pasteWrites, promptWrites, ptyWrites } from './snapshot-mode';
import { claudePath } from './claude-cli';
import { keysFor } from './prompt-keys';
import { buildStartCommand, shellQuote } from './resume-command';
import { handle, on, send } from './ipc';
import type { OpenTab, TabSession, TabSessions } from './tab-session';
import type { PromptAnswer } from '../shared/prompt-answer';
import { NO_SESSION_LABEL } from '../shared/session-label';
import type { ReaderUpdate, TabId, TermSize } from '../shared/types';

// A tab opened from History waits this long after its shell's first output before typing the resume command.
const PENDING_COMMAND_DELAY_MS = 150;
const START_CLAUDE = 'claude\r';
// Snapshot runs type a shell no-op in its place, so no real claude ever starts there.
const START_CLAUDE_STAND_IN = ': petal-start-claude\r';
// The picker reads one keypress per chunk; 30ms measured fine, 120ms leaves room for a busy machine.
const PROMPT_KEY_GAP_MS = 120;

export const sessions: TabSessions = new Map();
const activeTabs = new Map<number, TabId>(); // webContents.id -> tabId shown in that window
const pendingCommands = new Map<string, string>(); // tabKey -> command typed once that tab's shell starts
let openedTabs = 0; // main-picked tab ids are m1, m2, ...; the renderer's own are t1, t2, ...

const tabKey = (contentsId: number, tabId: TabId | undefined) => `${contentsId}:${tabId}`;
const tabsOf = (contentsId: number) => [...sessions.values()].filter((s) => s.contentsId === contentsId);
export const activeSession = (contentsId: number) => sessions.get(tabKey(contentsId, activeTabs.get(contentsId)));
export const openSessionIds = (): string[] => [...sessions.values()].flatMap((s) => (s.feed.session?.sessionId ? [s.feed.session.sessionId] : []));

// The renderer creates the tab and starts its shell; a pending command is typed into it.
// A background tab starts without being shown.
export const openTab: OpenTab = (contents, { command, background = false } = {}) => {
  if (!contents || contents.isDestroyed()) return;
  const tabId: TabId = `m${++openedTabs}`;
  if (command) pendingCommands.set(tabKey(contents.id, tabId), command);
  send(contents, 'tabs:new', { background, tabId });
};

// What each tab was last called, so a title that lands later (organizer, Claude Code's ai-title) is pushed once.
const RELABEL_MS = 2000;
const shownLabels = new Map<string, { label: string; update: ReaderUpdate }>(); // tabKey -> last label sent

// The shared session name; a tab with no Claude in it is just a shell.
function labelFor({ sessionId, cwd, replies = [] }: Pick<ReaderUpdate, 'sessionId' | 'cwd'> & { replies?: ReaderUpdate['replies'] }): string {
  if (!sessionId) return NO_SESSION_LABEL;
  return sessionTitleFor(sessionId, { cwd, firstPrompt: replies.at(-1)?.prompt });
}

// Every tab, every window: a label that changed since it was sent goes to the tab, and History re-lists.
let organizerSeen: Readonly<organizer.OrganizerStore> | null = null; // loadCached hands back a new object once the file changes
function relabelTabs(): void {
  const store = organizer.loadCached();
  let changed = organizerSeen !== null && store !== organizerSeen; // a pass named sessions, open in a tab or not
  organizerSeen = store;
  for (const [key, shown] of shownLabels) {
    const session = sessions.get(key);
    if (!session) { shownLabels.delete(key); continue; }
    const label = labelFor(shown.update);
    if (label === shown.label) continue;
    shown.label = label;
    changed = true;
    const contents = webContents.fromId(session.contentsId);
    if (contents && !contents.isDestroyed()) send(contents, 'tab:label', { tabId: session.tabId, label });
  }
  if (changed) for (const win of BrowserWindow.getAllWindows()) send(win.webContents, 'session:titles');
}

const claudeInstalled = async (): Promise<boolean> =>
  (isSnapshotRun() && claudeFixture.installed !== null ? claudeFixture.installed : Boolean(await claudePath()));

// Add Session's `claude`, typed only when Claude Code is installed, so a missing one never prints an error.
async function typeStartClaude(session: TabSession): Promise<void> {
  if (!(await claudeInstalled()) || !sessions.has(tabKey(session.contentsId, session.tabId))) return;
  if (isSnapshotRun()) claudeStarts.push({ tabId: session.tabId, command: START_CLAUDE });
  session.pty.write(isSnapshotRun() ? START_CLAUDE_STAND_IN : START_CLAUDE);
}

function startSession(sender: WebContents, { tabId, cols, rows, startClaude = false }: { tabId: TabId; startClaude?: boolean } & TermSize): void {
  const win = BrowserWindow.fromWebContents(sender);
  const contentsId = sender.id;

  // Snapshot runs replay the fixture in the window's first tab only, so later tabs stay distinct (unless a check queued its own).
  const fixture = tabFixture(!tabsOf(contentsId).length);
  const pty = spawnShell({ cols, rows });
  // Fire and forget: the hook never holds up the reader.
  const onReplyFinished = ({ reply, sessionId, cwd }: ReplyFinished) => responseHook.onReplyFinished({ reply, sessionId, cwd, title: labelFor({ sessionId, cwd }) });
  const feed = new ReaderFeed(pty.pid, (channel, update) => {
    const label = labelFor(update);
    shownLabels.set(tabKey(contentsId, tabId), { label, update });
    if (!sender.isDestroyed()) send(sender, channel, { ...update, tabId, label });
  }, { fixture, onReplyFinished, onConcluded: (sessionId) => void closeConcluded(sessionId) });
  const session: TabSession = { pty, feed, contentsId, tabId };
  sessions.set(tabKey(contentsId, tabId), session);
  if (!activeTabs.has(contentsId)) activeTabs.set(contentsId, tabId);

  // A tab opened from History types its resume command once the shell prints its prompt; Add Session's types `claude`.
  const pending = pendingCommands.get(tabKey(contentsId, tabId));
  pendingCommands.delete(tabKey(contentsId, tabId));
  const typeFirst = pending ? () => pty.write(pending) : startClaude ? () => void typeStartClaude(session) : null;
  let typed = !typeFirst;
  pty.onData((data) => {
    if (!sender.isDestroyed()) send(sender, 'pty:data', { tabId, data });
    if (!typed && typeFirst) { typed = true; setTimeout(typeFirst, PENDING_COMMAND_DELAY_MS); }
  });
  // Closing the last tab closes the window, as the shell exiting always has.
  pty.onExit(() => {
    feed.stop();
    sessions.delete(tabKey(contentsId, tabId));
    if (!sender.isDestroyed()) send(sender, 'tab:closed', { tabId });
    if (!tabsOf(contentsId).length && win && !win.isDestroyed()) win.close();
  });
}

// A double click must not type a second answer into whatever comes after the prompt.
const ANSWER_SETTLE_MS = 1000;
const PICKER_SETTLE_MS = 250; // picker steps come one per screen change, e.g. ticking several boxes
const answeringUntil = new WeakMap<TabSession, number>();

// Types an answer into the tab's claude: the renderer only offers one while the prompt is on its screen.
function answerPrompt(session: TabSession, answer: PromptAnswer): void {
  if (Date.now() < (answeringUntil.get(session) ?? 0)) return;
  const keys = keysFor(answer);
  if (!keys) return;
  const settle = answer.kind === 'picker' ? PICKER_SETTLE_MS : ANSWER_SETTLE_MS;
  answeringUntil.set(session, Date.now() + keys.length * PROMPT_KEY_GAP_MS + settle);
  if (isSnapshotRun()) { promptWrites.push(keys); return; }
  keys.forEach((key, i) => setTimeout(() => {
    if (sessions.has(tabKey(session.contentsId, session.tabId))) session.pty.write(key);
  }, i * PROMPT_KEY_GAP_MS));
}

function closeSession({ pty, feed }: TabSession): void {
  feed.stop();
  try { pty.kill(); } catch { /* already exited */ }
}

// A window closed: stop every tab it had.
export function closeWindowTabs(contentsId: number): void {
  for (const session of tabsOf(contentsId)) {
    closeSession(session);
    sessions.delete(tabKey(contentsId, session.tabId));
  }
  activeTabs.delete(contentsId);
  for (const key of pendingCommands.keys()) if (key.startsWith(`${contentsId}:`)) pendingCommands.delete(key);
}

export function registerTabIpc(): void {
  setInterval(relabelTabs, RELABEL_MS);
  const tabFor = (event: { sender: { id: number } }, tabId: TabId) => sessions.get(tabKey(event.sender.id, tabId));

  on('pty:start', (event, { tabId, cols, rows, startClaude }) => {
    if (!tabFor(event, tabId)) startSession(event.sender, { tabId, cols, rows, startClaude: startClaude === true });
  });

  on('pty:write', (event, { tabId, data }) => {
    if (isSnapshotRun()) ptyWrites.push({ tabId, data });
    tabFor(event, tabId)?.pty.write(data);
  });

  handle('pty:paste', (event, { tabId, data }) => {
    const session = tabFor(event, tabId);
    if (isSnapshotRun()) pasteWrites.push({ tabId, data });
    session?.pty.write(data);
    return { sent: Boolean(session) };
  });

  on('pty:resize', (event, { tabId, cols, rows }) => {
    if (cols > 0 && rows > 0) tabFor(event, tabId)?.pty.resize(cols, rows);
  });

  // The pty's exit sends tab:closed, which removes the tab in the renderer.
  on('pty:close', (event, { tabId }) => {
    const session = tabFor(event, tabId);
    if (session) closeSession(session);
  });

  on('tab:activate', (event, { tabId }) => activeTabs.set(event.sender.id, tabId));

  on('prompt:answer', (event, { tabId, answer }) => {
    const session = tabFor(event, tabId);
    if (session && (answer?.kind === 'picker' || answer?.kind === 'permission')) answerPrompt(session, answer);
  });

  // The reply box in a tab without Claude starts one with her message; snapshot runs only echo, never launch claude.
  on('tab:start-claude', (event, { tabId, prompt }) => {
    const session = tabFor(event, tabId);
    if (!session || typeof prompt !== 'string' || !prompt.trim()) return;
    session.pty.write(isSnapshotRun() ? `echo claude-start ${shellQuote(prompt)}\r` : buildStartCommand(prompt));
  });
}

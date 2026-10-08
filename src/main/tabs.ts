// Terminal tabs: one shell and one reader feed per tab, keyed by window and tab id, plus their IPC.
import path from 'node:path';
import { BrowserWindow, type WebContents } from 'electron';
import { spawnShell } from './pty';
import { ReaderFeed, type ReplyFinished } from './reader-feed';
import * as organizer from './session-organizer';
import * as responseHook from './response-hook';
import * as history from './history';
import { fixtureSession, isSnapshotRun, pasteWrites, promptWrites, ptyWrites } from './snapshot-mode';
import { keysFor } from './prompt-keys';
import { buildStartCommand, shellQuote } from './resume-command';
import { handle, on, send } from './ipc';
import type { OpenTab, TabSession, TabSessions } from './tab-session';
import type { PromptAnswer } from '../shared/prompt-answer';
import type { TabId, TermSize } from '../shared/types';

// A tab opened from History waits this long after its shell's first output before typing the resume command.
const PENDING_COMMAND_DELAY_MS = 150;
// The picker reads one keypress per chunk; 30ms measured fine, 120ms leaves room for a busy machine.
const PROMPT_KEY_GAP_MS = 120;

export const sessions: TabSessions = new Map();
const activeTabs = new Map<number, TabId>(); // webContents.id -> tabId shown in that window
const pendingCommands = new Map<number, string>(); // webContents.id -> command for the next tab that starts there

const tabKey = (contentsId: number, tabId: TabId | undefined) => `${contentsId}:${tabId}`;
const tabsOf = (contentsId: number) => [...sessions.values()].filter((s) => s.contentsId === contentsId);
export const activeSession = (contentsId: number) => sessions.get(tabKey(contentsId, activeTabs.get(contentsId)));
export const openSessionIds = (): string[] => [...sessions.values()].flatMap((s) => (s.feed.session?.sessionId ? [s.feed.session.sessionId] : []));

// The renderer creates the tab and starts its shell; a pending command is typed into it.
// A background tab starts without being shown.
export const openTab: OpenTab = (contents, { command, background = false } = {}) => {
  if (!contents || contents.isDestroyed()) return;
  if (command) pendingCommands.set(contents.id, command);
  send(contents, 'tabs:new', { background });
};

// Session label: organizer title, else its first-prompt title, else its folder, else "Shell".
const recordTitles = new Map<string, string | null>(); // sessionId -> title from the transcript head (scanning is slow)
function labelFor({ sessionId, cwd }: { sessionId: string | null; cwd: string | null }): string {
  if (!sessionId) return 'Shell';
  const organized = organizer.loadCached()[sessionId]?.title;
  if (organized) return organized;
  if (!recordTitles.has(sessionId)) recordTitles.set(sessionId, history.findRecord(sessionId)?.title || null);
  return recordTitles.get(sessionId) || (cwd ? path.basename(cwd) : 'Shell');
}

function startSession(sender: WebContents, { tabId, cols, rows }: { tabId: TabId } & TermSize): void {
  const win = BrowserWindow.fromWebContents(sender);
  const contentsId = sender.id;

  // Snapshot runs replay the fixture in the window's first tab only, so later tabs stay distinct.
  const fixture = tabsOf(contentsId).length ? null : fixtureSession();
  const pty = spawnShell({ cols, rows });
  // Fire and forget: the hook never holds up the reader.
  const onReplyFinished = ({ reply, sessionId, cwd }: ReplyFinished) => responseHook.onReplyFinished({ reply, sessionId, cwd, title: labelFor({ sessionId, cwd }) });
  const feed = new ReaderFeed(pty.pid, (channel, update) => {
    if (!sender.isDestroyed()) send(sender, channel, { ...update, tabId, label: labelFor(update) });
  }, { fixture, onReplyFinished });
  const session: TabSession = { pty, feed, contentsId, tabId };
  sessions.set(tabKey(contentsId, tabId), session);
  if (!activeTabs.has(contentsId)) activeTabs.set(contentsId, tabId);

  // A tab opened from History types its resume command once the shell prints its prompt.
  const pending = pendingCommands.get(contentsId);
  pendingCommands.delete(contentsId);
  let typed = !pending;
  pty.onData((data) => {
    if (!sender.isDestroyed()) send(sender, 'pty:data', { tabId, data });
    if (!typed) { typed = true; setTimeout(() => pty.write(pending ?? ''), PENDING_COMMAND_DELAY_MS); }
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
const answering = new WeakMap<TabSession, { until: number; toolUseId: string | null }>();

// Types an answer into the tab's claude; a question must still be the one pending in its transcript.
function answerPrompt(session: TabSession, answer: PromptAnswer): void {
  const pending = session.feed.question;
  const toolUseId = answer.kind === 'question' ? answer.toolUseId : null;
  if (toolUseId !== null && toolUseId !== pending?.toolUseId) return;
  const last = answering.get(session);
  if (last && (Date.now() < last.until || (toolUseId !== null && last.toolUseId === toolUseId))) return;
  const keys = keysFor(answer, pending?.questions ?? null);
  if (!keys) return;
  answering.set(session, { until: Date.now() + keys.length * PROMPT_KEY_GAP_MS + ANSWER_SETTLE_MS, toolUseId });
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
  pendingCommands.delete(contentsId);
}

export function registerTabIpc(): void {
  const tabFor = (event: { sender: { id: number } }, tabId: TabId) => sessions.get(tabKey(event.sender.id, tabId));

  on('pty:start', (event, { tabId, cols, rows }) => {
    if (!tabFor(event, tabId)) startSession(event.sender, { tabId, cols, rows });
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
    if (session && (answer?.kind === 'question' || answer?.kind === 'permission')) answerPrompt(session, answer);
  });

  // The reply box in a tab without Claude starts one with her message; snapshot runs only echo, never launch claude.
  on('tab:start-claude', (event, { tabId, prompt }) => {
    const session = tabFor(event, tabId);
    if (!session || typeof prompt !== 'string' || !prompt.trim()) return;
    session.pty.write(isSnapshotRun() ? `echo claude-start ${shellQuote(prompt)}\r` : buildStartCommand(prompt));
  });
}

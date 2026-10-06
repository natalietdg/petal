import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, screen, shell, type WebContents } from 'electron';
import themesJson from '../themes.json';
import { spawnShell } from './pty';
import { buildMenu, CAT_CHOICES, SCENE_CHOICES, READING_CHOICES } from './menu';
import { loadSettings, saveSettings } from './settings';
import { ReaderFeed, type ReplyFinished } from './reader-feed';
import * as sessionsMonitor from './sessions-monitor';
import { registerHistoryIpc } from './history-ipc';
import * as snapshot from './snapshot';
import * as organizer from './session-organizer';
import { registerWorkflowIpc } from './workflow-ipc';
import * as configStore from './config-store';
import * as responseHook from './response-hook';
import * as history from './history';
import { claudePath } from './claude-cli';
import { toMarkdown } from './handoff';
import { handle, on, send } from './ipc';
import type { OpenTab, TabSession, TabSessions } from './tab-session';
import type { CustomizeState, EventArgs, EventChannel } from '../shared/ipc';
import type { Choice, TabId, TermSize, Themes } from '../shared/types';

const themes: Themes = themesJson;
const DEFAULT_THEME = 'paleSky';

// Snapshot runs keep their settings and stored flows in a scratch userData, never hers.
if (snapshot.isSnapshotRun()) app.setPath('userData', snapshot.userDataDir());

const settings = loadSettings();
// A retired or renamed cat (orange, tabby) in an old settings file becomes Mika, so the menu shows a tick.
if (!CAT_CHOICES.some(([id]) => id === settings.cat)) settings.cat = 'mika';
if (!themes[settings.theme]) settings.theme = DEFAULT_THEME;

const sessions: TabSessions = new Map();
const activeTabs = new Map<number, TabId>(); // webContents.id -> tabId shown in that window
const pendingCommands = new Map<number, string>(); // webContents.id -> command for the next tab that starts there

const tabKey = (contentsId: number, tabId: TabId | undefined) => `${contentsId}:${tabId}`;
const tabsOf = (contentsId: number) => [...sessions.values()].filter((s) => s.contentsId === contentsId);
const activeSession = (contentsId: number) => sessions.get(tabKey(contentsId, activeTabs.get(contentsId)));
const focusedContents = () => BrowserWindow.getFocusedWindow()?.webContents;

function createWindow(): BrowserWindow {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const win = new BrowserWindow({
    width: Math.min(1280, width),
    height: Math.min(900, height),
    show: false,
    backgroundColor: themes[settings.theme].reader.background,
    title: 'Petal',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.once('ready-to-show', () => (snapshot.isSnapshotRun() ? win.showInactive() : win.show()));
  // The renderer is still plain global scripts, served as static files from the app root.
  win.loadFile(path.join(app.getAppPath(), 'src', 'renderer', 'index.html'));

  const contentsId = win.webContents.id;
  win.on('closed', () => {
    for (const session of tabsOf(contentsId)) {
      closeSession(session);
      sessions.delete(tabKey(contentsId, session.tabId));
    }
    activeTabs.delete(contentsId);
    pendingCommands.delete(contentsId);
  });
  return win;
}

const broadcast = <C extends EventChannel>(channel: C, ...payload: EventArgs<C>) => {
  for (const win of BrowserWindow.getAllWindows()) send(win.webContents, channel, ...payload);
};

function applyTheme(themeId: string, { persist = true }: { persist?: boolean } = {}): void {
  settings.theme = themeId;
  if (persist) saveSettings(settings);
  refreshMenu();
  for (const win of BrowserWindow.getAllWindows()) {
    win.setBackgroundColor(themes[themeId].reader.background);
    send(win.webContents, 'theme:changed', themes[themeId]);
  }
}

function applyCat(catId: string): void {
  settings.cat = catId;
  saveSettings(settings);
  refreshMenu();
  broadcast('cat:changed', catId);
}

function applyReading(readingId: string): void {
  settings.reading = readingId;
  saveSettings(settings);
  refreshMenu();
  broadcast('reading:changed', readingId);
}

function applyScene(sceneId: string): void {
  settings.scene = sceneId;
  saveSettings(settings);
  refreshMenu();
  broadcast('scene:changed', sceneId);
}

function toggleReaderOnly(): void {
  const contents = BrowserWindow.getFocusedWindow()?.webContents;
  if (contents) send(contents, 'layout:toggle');
}

function toggleHistory(): void {
  const contents = BrowserWindow.getFocusedWindow()?.webContents;
  if (contents) send(contents, 'history:toggle');
}

function openSettings(): void {
  const contents = focusedContents() ?? BrowserWindow.getAllWindows()[0]?.webContents;
  if (contents) send(contents, 'customize:open');
}

// The renderer creates the tab and starts its shell; a pending command is typed into it.
const openTab: OpenTab = (contents, { command } = {}) => {
  if (!contents || contents.isDestroyed()) return;
  if (command) pendingCommands.set(contents.id, command);
  send(contents, 'tabs:new');
};

const sendToFocused = <C extends EventChannel>(channel: C, ...payload: EventArgs<C>) => {
  const contents = focusedContents();
  if (contents) send(contents, channel, ...payload);
};

function refreshMenu(): void {
  buildMenu({
    currentTheme: settings.theme,
    onThemeSelected: (id) => applyTheme(id),
    currentCat: settings.cat,
    onCatSelected: applyCat,
    currentScene: settings.scene,
    onSceneSelected: applyScene,
    currentReading: settings.reading,
    onReadingSelected: applyReading,
    onNewWindow: () => createWindow(),
    onNewTab: () => openTab(focusedContents()),
    onCloseTab: () => sendToFocused('tabs:close-active'),
    onCycleTab: (delta) => sendToFocused('tabs:cycle', delta),
    onToggleReader: toggleReaderOnly,
    onToggleHistory: toggleHistory,
    onOpenSettings: openSettings,
  });
}

// Session label: organizer title, else its first-prompt title, else its folder, else "Shell".
const recordTitles = new Map<string, string | null>(); // sessionId -> title from the transcript head (scanning is slow)
function labelFor({ sessionId, cwd }: { sessionId: string | null; cwd: string | null }): string {
  if (!sessionId) return 'Shell';
  const organized = organizer.load()[sessionId]?.title;
  if (organized) return organized;
  if (!recordTitles.has(sessionId)) recordTitles.set(sessionId, history.findRecord(sessionId)?.title || null);
  return recordTitles.get(sessionId) || (cwd ? path.basename(cwd) : 'Shell');
}

function startSession(sender: WebContents, { tabId, cols, rows }: { tabId: TabId } & TermSize): void {
  const win = BrowserWindow.fromWebContents(sender);
  const contentsId = sender.id;

  // Snapshot runs replay the fixture in the window's first tab only, so later tabs stay distinct.
  const fakeTranscript = tabsOf(contentsId).length ? null : snapshot.fakeTranscript();
  const pty = spawnShell({ cols, rows });
  // Fire and forget: the hook never holds up the reader.
  const onReplyFinished = ({ reply, sessionId, cwd }: ReplyFinished) => responseHook.onReplyFinished({ reply, sessionId, cwd, title: labelFor({ sessionId, cwd }) });
  const feed = new ReaderFeed(pty.pid, (channel, update) => {
    if (!sender.isDestroyed()) send(sender, channel, { ...update, tabId, label: labelFor(update) });
  }, { fakeTranscript, onReplyFinished });
  const session: TabSession = { pty, feed, contentsId, tabId };
  sessions.set(tabKey(contentsId, tabId), session);
  if (!activeTabs.has(contentsId)) activeTabs.set(contentsId, tabId);

  // A tab opened from History types its resume command once the shell prints its prompt.
  const pending = pendingCommands.get(contentsId);
  pendingCommands.delete(contentsId);
  let typed = !pending;
  pty.onData((data) => {
    if (!sender.isDestroyed()) send(sender, 'pty:data', { tabId, data });
    if (!typed) { typed = true; setTimeout(() => pty.write(pending ?? ''), 150); }
  });
  // Closing the last tab closes the window, as the shell exiting always has.
  pty.onExit(() => {
    feed.stop();
    sessions.delete(tabKey(contentsId, tabId));
    if (!sender.isDestroyed()) send(sender, 'tab:closed', { tabId });
    if (!tabsOf(contentsId).length && win && !win.isDestroyed()) win.close();
  });
}

function closeSession({ pty, feed }: TabSession): void {
  feed.stop();
  try { pty.kill(); } catch { /* already exited */ }
}

function registerIpc(): void {
  registerHistoryIpc({ sessions, activeSession, openTab, currentTheme: () => themes[settings.theme] });
  registerWorkflowIpc({ sessions, history, organizer });

  handle('theme:get', () => themes[settings.theme]);
  handle('cat:get', () => settings.cat);
  handle('scene:get', () => settings.scene);
  handle('reading:get', () => settings.reading);
  handle('claude:installed', () => Boolean(claudePath()));

  handle('sessions:snapshot', (event, { detailed, expandedIds }) => sessionsMonitor.snapshot({
    detailed,
    expandedIds,
    ownSessionId: activeSession(event.sender.id)?.feed.session?.sessionId,
  }));

  const tabFor = (event: Electron.IpcMainEvent, tabId: TabId) => sessions.get(tabKey(event.sender.id, tabId));

  on('pty:start', (event, { tabId, cols, rows }) => {
    if (!tabFor(event, tabId)) startSession(event.sender, { tabId, cols, rows });
  });

  on('pty:write', (event, { tabId, data }) => tabFor(event, tabId)?.pty.write(data));

  on('pty:resize', (event, { tabId, cols, rows }) => {
    if (cols > 0 && rows > 0) tabFor(event, tabId)?.pty.resize(cols, rows);
  });

  // The pty's exit sends tab:closed, which removes the tab in the renderer.
  on('pty:close', (event, { tabId }) => {
    const session = tabFor(event, tabId);
    if (session) closeSession(session);
  });

  on('tab:activate', (event, { tabId }) => activeTabs.set(event.sender.id, tabId));

  on('link:open', (_event, url) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });

  registerCustomizeIpc();
}

// Her active Claude Code output style, read-only; null when unset or unreadable.
function outputStyle(): string | null {
  try {
    return (JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8')) as { outputStyle?: string }).outputStyle ?? null;
  } catch {
    return null;
  }
}

const HANDOFF_SAMPLE = {
  record: { title: 'Fix the reader session', cwd: '~/CascadeProjects/pastel-term', sessionId: '<session id>', file: '~/.claude/projects/<folder>/<session id>.jsonl' },
  turns: [{ prompt: 'why did the reader switch sessions?', reply: ['**The reader now follows only the claude inside this window.**'] }],
};

// Everything the Customize page shows, in one read.
function customizeState(): CustomizeState {
  const magazinePath = path.join(os.homedir(), '.claude', 'output-styles', 'magazine.md');
  return {
    config: configStore.load(),
    defaults: configStore.defaults(),
    models: configStore.MODELS,
    look: { theme: settings.theme, reading: settings.reading, cat: settings.cat, scene: settings.scene },
    choices: {
      themes: Object.entries(themes).map(([id, theme]): Choice => [id, theme.label]),
      reading: READING_CHOICES,
      cats: CAT_CHOICES,
      scenes: SCENE_CHOICES,
    },
    outputStyle: outputStyle(),
    magazinePath: fs.existsSync(magazinePath) ? magazinePath : null,
    organizer: organizer.status(),
    hookRuns: responseHook.recentRuns(),
    hookDir: responseHook.hookDir(),
    configFile: path.join(app.getPath('userData'), 'config.json'),
    handoffSample: toMarkdown(HANDOFF_SAMPLE.record, HANDOFF_SAMPLE.turns),
  };
}

// Look setters reuse the menu's apply* paths, so checkmarks and every window stay in sync.
function registerCustomizeIpc(): void {
  const valid = (choices: readonly Choice[], id: string) => choices.some(([choice]) => choice === id);
  handle('config:get', () => customizeState());
  handle('config:save', (_event, patch) => configStore.save(patch));
  handle('config:reset', (_event, keyPath) => configStore.reset(keyPath));
  handle('config:test-hook', () => responseHook.test());
  handle('config:hook-runs', () => responseHook.recentRuns());
  handle('config:organizer', () => organizer.status());
  on('look:theme', (_event, id) => { if (themes[id]) applyTheme(id); });
  on('look:reading', (_event, id) => { if (valid(READING_CHOICES, id)) applyReading(id); });
  on('look:cat', (_event, id) => { if (valid(CAT_CHOICES, id)) applyCat(id); });
  on('look:scene', (_event, id) => { if (valid(SCENE_CHOICES, id)) applyScene(id); });
}

app.whenReady().then(() => {
  registerIpc();
  refreshMenu();
  const win = createWindow();
  if (snapshot.isSnapshotRun()) snapshot.run({ win, sessions, activeSession, openTab, themes, applyTheme });
  // Snapshot runs never call Claude in the background.
  else organizer.start({ openSessionIds: () => [...sessions.values()].flatMap((s) => (s.feed.session?.sessionId ? [s.feed.session.sessionId] : [])) });
});

app.on('will-quit', () => organizer.stop());

app.on('window-all-closed', () => app.quit());

const path = require('node:path');
const { app, BrowserWindow, ipcMain, screen, shell } = require('electron');
const themes = require('../themes.json');
const { spawnShell } = require('./pty');
const { buildMenu, CAT_CHOICES } = require('./menu');
const { loadSettings, saveSettings } = require('./settings');
const { ReaderFeed } = require('./reader-feed');
const sessionsMonitor = require('./sessions-monitor');
const { registerHistoryIpc } = require('./history-ipc');
const snapshot = require('./snapshot');
const organizer = require('./session-organizer');
const { registerWorkflowIpc } = require('./workflow-ipc');

const DEFAULT_THEME = 'paleSky';

// Snapshot runs keep their settings and stored flows in a scratch userData, never hers.
if (snapshot.isSnapshotRun()) app.setPath('userData', snapshot.userDataDir());

const settings = loadSettings();
// A retired or renamed cat (orange, tabby) in an old settings file becomes Mika, so the menu shows a tick.
if (!CAT_CHOICES.some(([id]) => id === settings.cat)) settings.cat = 'mika';
if (!themes[settings.theme]) settings.theme = DEFAULT_THEME;

const history = require('./history');

const sessions = new Map(); // `${webContents.id}:${tabId}` -> { pty, feed, contentsId, tabId }
const activeTabs = new Map(); // webContents.id -> tabId shown in that window
const pendingCommands = new Map(); // webContents.id -> command for the next tab that starts there

const tabKey = (contentsId, tabId) => `${contentsId}:${tabId}`;
const tabsOf = (contentsId) => [...sessions.values()].filter((s) => s.contentsId === contentsId);
const activeSession = (contentsId) => sessions.get(tabKey(contentsId, activeTabs.get(contentsId)));
const focusedContents = () => BrowserWindow.getFocusedWindow()?.webContents;

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const win = new BrowserWindow({
    width: Math.min(1280, width),
    height: Math.min(900, height),
    show: false,
    backgroundColor: themes[settings.theme].reader.background,
    title: 'Petal',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.once('ready-to-show', () => (snapshot.isSnapshotRun() ? win.showInactive() : win.show()));
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

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

function applyTheme(themeId, { persist = true } = {}) {
  settings.theme = themeId;
  if (persist) saveSettings(settings);
  refreshMenu();
  for (const win of BrowserWindow.getAllWindows()) {
    win.setBackgroundColor(themes[themeId].reader.background);
    win.webContents.send('theme:changed', themes[themeId]);
  }
}

function applyCat(catId) {
  settings.cat = catId;
  saveSettings(settings);
  refreshMenu();
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('cat:changed', catId);
}

function applyReading(readingId) {
  settings.reading = readingId;
  saveSettings(settings);
  refreshMenu();
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('reading:changed', readingId);
}

function applyScene(sceneId) {
  settings.scene = sceneId;
  saveSettings(settings);
  refreshMenu();
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('scene:changed', sceneId);
}

function toggleReaderOnly() {
  BrowserWindow.getFocusedWindow()?.webContents.send('layout:toggle');
}

function toggleHistory() {
  BrowserWindow.getFocusedWindow()?.webContents.send('history:toggle');
}

// The renderer creates the tab and starts its shell; a pending command is typed into it.
function openTab(contents, { command } = {}) {
  if (!contents || contents.isDestroyed()) return;
  if (command) pendingCommands.set(contents.id, command);
  contents.send('tabs:new');
}

const sendToFocused = (channel, payload) => focusedContents()?.send(channel, payload);

function refreshMenu() {
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
  });
}

// Session label: organizer title, else its first-prompt title, else its folder, else "Shell".
const recordTitles = new Map(); // sessionId -> title from the transcript head (scanning is slow)
function labelFor({ sessionId, cwd }) {
  if (!sessionId) return 'Shell';
  const organized = organizer.load()[sessionId]?.title;
  if (organized) return organized;
  if (!recordTitles.has(sessionId)) recordTitles.set(sessionId, history.findRecord(sessionId)?.title || null);
  return recordTitles.get(sessionId) || (cwd ? path.basename(cwd) : 'Shell');
}

function startSession(sender, { tabId, cols, rows }) {
  const win = BrowserWindow.fromWebContents(sender);
  const contentsId = sender.id;
  const send = (channel, payload) => { if (!sender.isDestroyed()) sender.send(channel, payload); };

  // Snapshot runs replay the fixture in the window's first tab only, so later tabs stay distinct.
  const fakeTranscript = tabsOf(contentsId).length ? null : snapshot.fakeTranscript();
  const pty = spawnShell({ cols, rows });
  const feed = new ReaderFeed(pty.pid, (channel, update) => send(channel, { ...update, tabId, label: labelFor(update) }), { fakeTranscript });
  const session = { pty, feed, contentsId, tabId };
  sessions.set(tabKey(contentsId, tabId), session);
  if (!activeTabs.has(contentsId)) activeTabs.set(contentsId, tabId);

  // A tab opened from History types its resume command once the shell prints its prompt.
  const pending = pendingCommands.get(contentsId);
  pendingCommands.delete(contentsId);
  let typed = !pending;
  pty.onData((data) => {
    send('pty:data', { tabId, data });
    if (!typed) { typed = true; setTimeout(() => pty.write(pending), 150); }
  });
  // Closing the last tab closes the window, as the shell exiting always has.
  pty.onExit(() => {
    feed.stop();
    sessions.delete(tabKey(contentsId, tabId));
    send('tab:closed', { tabId });
    if (!tabsOf(contentsId).length && !win.isDestroyed()) win.close();
  });
}

function closeSession({ pty, feed }) {
  feed.stop();
  try { pty.kill(); } catch { /* already exited */ }
}

function registerIpc() {
  registerHistoryIpc({ sessions, activeSession, openTab, currentTheme: () => themes[settings.theme] });
  registerWorkflowIpc({ sessions, history, organizer });

  ipcMain.handle('theme:get', () => themes[settings.theme]);
  ipcMain.handle('cat:get', () => settings.cat);
  ipcMain.handle('scene:get', () => settings.scene);
  ipcMain.handle('reading:get', () => settings.reading);
  ipcMain.handle('claude:installed', () => Boolean(require('./claude-cli').claudePath()));

  ipcMain.handle('sessions:snapshot', (event, { detailed, expandedIds }) => sessionsMonitor.snapshot({
    detailed,
    expandedIds,
    ownSessionId: activeSession(event.sender.id)?.feed.session?.sessionId,
  }));

  const tabFor = (event, tabId) => sessions.get(tabKey(event.sender.id, tabId));

  ipcMain.on('pty:start', (event, { tabId, cols, rows }) => {
    if (!tabFor(event, tabId)) startSession(event.sender, { tabId, cols, rows });
  });

  ipcMain.on('pty:write', (event, { tabId, data }) => tabFor(event, tabId)?.pty.write(data));

  ipcMain.on('pty:resize', (event, { tabId, cols, rows }) => {
    if (cols > 0 && rows > 0) tabFor(event, tabId)?.pty.resize(cols, rows);
  });

  // The pty's exit sends tab:closed, which removes the tab in the renderer.
  ipcMain.on('pty:close', (event, { tabId }) => {
    const session = tabFor(event, tabId);
    if (session) closeSession(session);
  });

  ipcMain.on('tab:activate', (event, { tabId }) => activeTabs.set(event.sender.id, tabId));

  ipcMain.on('link:open', (_event, url) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });
}

app.whenReady().then(() => {
  registerIpc();
  refreshMenu();
  const win = createWindow();
  if (snapshot.isSnapshotRun()) snapshot.run({ win, sessions, activeSession, openTab, themes, applyTheme });
  // Snapshot runs never call Claude in the background.
  else organizer.start({ openSessionIds: () => [...sessions.values()].map((s) => s.feed.session?.sessionId).filter(Boolean) });
});

app.on('will-quit', () => organizer.stop());

app.on('window-all-closed', () => app.quit());

// Petal's main process: windows, the menu, and wiring every IPC module. Tabs, look and Customize live in their own files.
import path from 'node:path';
import { app, BrowserWindow, screen, shell } from 'electron';
import { buildMenu } from './menu';
import { registerHistoryIpc } from './history-ipc';
import { registerSessionsIpc } from './sessions-ipc';
import { registerAgentsIpc } from './agents-ipc';
import { claudeFixture, folderFixture, freshInstallRun, isSnapshotRun, userDataDir } from './snapshot-mode';
import * as configStore from './config-store';
import { offscreenWindowOptions, showOffscreen } from './snapshot-window';
import * as organizer from './session-organizer';
import * as responseHook from './response-hook';
import { registerWorkflowIpc } from './workflow-ipc';
import { registerSlashIpc } from './slash-ipc';
import { registerLibraryIpc } from './library-ipc';
import { registerTestingIpc } from './testing-ipc';
import { registerSessionInfoIpc } from './session-info';
import { registerFactoryIpc } from './factory-ipc';
import { registerCustomizeIpc } from './customize-ipc';
import { registerReposIpc } from './repos-ipc';
import { registerPasteIpc } from './paste-ipc';
import { registerMentionsIpc } from './mentions-ipc';
import { registerTasksIpc } from './tasks-ipc';
import * as coord from './coord';
import { flush as flushActivity } from './activity-feed';
import { registerReplyImages, registerReplyImageScheme } from './reply-image-ipc';
import { assignSlot, registerLayoutIpc, releaseSlot } from './layout-ipc';
import * as repoIndex from './repo-index';
import * as history from './history';
import { claudePath } from './claude-cli';
import { handle, on, send } from './ipc';
import { checkForUpdatesNow, liveEnv, restartToUpdate, startUpdater, updateReadyVersion } from './updater';
import { recordLaunch, showWhatsNew, takeWhatsNew } from './whats-new';
import { activeSession, closeWindowTabs, openSessionIds, openTab, registerTabIpc, sessions, tabLabelOf } from './tabs';
import { applyCat, applyReading, applyScene, applyTheme, currentTheme, onLookChanged, registerLookIpc, settings, themes } from './look';
import type { EventArgs, EventChannel } from '../shared/ipc';

const WINDOW_WIDTH = 1280;
const WINDOW_HEIGHT = 900;

// Snapshot runs keep their settings and stored flows in a scratch userData, never hers.
if (isSnapshotRun()) app.setPath('userData', userDataDir());
// Snapshot runs start with reading ~/.claude set by the fixture (on), so only the consent check sees the screen,
// and as an install from before the pet guide, so only the pet-onboarding run sees it.
if (isSnapshotRun() && !freshInstallRun()) configStore.save({ claudeFolder: { choice: folderFixture.choice }, onboarding: { step: 'existing' } });

// Every window's reader and Customize follow her folder choice.
let folderAllowed = configStore.load().claudeFolder.choice === 'allowed';
configStore.onChange((config) => {
  const now = config.claudeFolder.choice === 'allowed';
  if (now === folderAllowed) return;
  folderAllowed = now;
  for (const win of BrowserWindow.getAllWindows()) send(win.webContents, 'claude-folder:changed', now);
});

// Text sizes saved in one window (keys, menu or Customize) apply in every window.
let textSizes = JSON.stringify(configStore.load().text);
configStore.onChange((config) => {
  const now = JSON.stringify(config.text);
  if (now === textSizes) return;
  textSizes = now;
  for (const win of BrowserWindow.getAllWindows()) send(win.webContents, 'text-size:changed', config.text);
});

registerReplyImageScheme(); // schemes must be registered before app ready

const focusedContents = () => BrowserWindow.getFocusedWindow()?.webContents;

function createWindow(): BrowserWindow {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const win = new BrowserWindow({
    width: Math.min(WINDOW_WIDTH, width),
    height: Math.min(WINDOW_HEIGHT, height),
    show: false,
    backgroundColor: currentTheme().reader.background,
    title: 'Petal',
    ...(isSnapshotRun() && offscreenWindowOptions()),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: !isSnapshotRun(), // an off-screen window must keep painting
    },
  });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.once('ready-to-show', () => (isSnapshotRun() ? showOffscreen(win) : win.show()));
  // electron-vite builds the renderer next to main: out/renderer/index.html.
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  const contentsId = win.webContents.id;
  assignSlot(contentsId);
  win.on('closed', () => {
    closeWindowTabs(contentsId);
    releaseSlot(contentsId);
  });
  return win;
}

const sendToFocused = <C extends EventChannel>(channel: C, ...payload: EventArgs<C>) => {
  const contents = focusedContents();
  if (contents) send(contents, channel, ...payload);
};

// ⌘T: the renderer checks her session limit before opening the tab.
function newSessionTab(): void {
  const contents = focusedContents() ?? BrowserWindow.getAllWindows()[0]?.webContents;
  if (contents) send(contents, 'tabs:new-session');
}

function openSettings(): void {
  const contents = focusedContents() ?? BrowserWindow.getAllWindows()[0]?.webContents;
  if (contents) send(contents, 'customize:open');
}

function openWelcome(): void {
  const contents = focusedContents() ?? BrowserWindow.getAllWindows()[0]?.webContents;
  if (contents) send(contents, 'welcome:open');
}

function openGetStarted(): void {
  const contents = focusedContents() ?? BrowserWindow.getAllWindows()[0]?.webContents;
  if (contents) send(contents, 'get-started:open');
}

function openPetGuide(): void {
  const contents = focusedContents() ?? BrowserWindow.getAllWindows()[0]?.webContents;
  if (contents) send(contents, 'pet-guide:open');
}

function openColourKey(): void {
  const contents = focusedContents() ?? BrowserWindow.getAllWindows()[0]?.webContents;
  if (contents) send(contents, 'colour-key:open');
}

function toggleShortcuts(): void {
  const contents = focusedContents() ?? BrowserWindow.getAllWindows()[0]?.webContents;
  if (contents) send(contents, 'shortcuts:toggle');
}

function refreshMenu(): void {
  const { theme, cat, scene, reading } = settings();
  buildMenu({
    currentTheme: theme,
    onThemeSelected: (id) => applyTheme(id),
    currentCat: cat,
    onCatSelected: applyCat,
    currentScene: scene,
    onSceneSelected: applyScene,
    currentReading: reading,
    onReadingSelected: applyReading,
    onNewWindow: () => createWindow(),
    onNewTab: newSessionTab,
    onCloseTab: () => sendToFocused('tabs:close-active'),
    onCycleTab: (delta) => sendToFocused('tabs:cycle', delta),
    onToggleReader: () => sendToFocused('layout:toggle'),
    onToggleHistory: () => sendToFocused('history:toggle'),
    onToggleBoard: () => sendToFocused('board:toggle'),
    onToggleFocus: () => sendToFocused('focus:toggle'),
    onToggleHeaders: () => sendToFocused('headers:toggle'),
    onTextSize: (step) => sendToFocused('text-size:step', step),
    onStopClaude: () => sendToFocused('claude:stop'),
    onOpenSettings: openSettings,
    onOpenWelcome: openWelcome,
    onOpenGetStarted: openGetStarted,
    onOpenPetGuide: openPetGuide,
    onOpenColourKey: openColourKey,
    onToggleShortcuts: toggleShortcuts,
    onOpenRepo: () => sendToFocused('repos:palette'),
    onCheckForUpdates: () => checkForUpdatesNow(liveEnv()),
  });
}
onLookChanged(refreshMenu);

function registerIpc(): void {
  registerHistoryIpc({ sessions, activeSession, openTab, currentTheme });
  registerWorkflowIpc({ sessions, history, organizer });
  registerSlashIpc();
  registerLibraryIpc({ sessions });
  registerTestingIpc({ sessions, openTab });
  registerSessionInfoIpc({ sessions });
  registerFactoryIpc({ activeSession });
  registerLookIpc();
  registerTabIpc();

  handle('claude:installed', async (_event, request) => (isSnapshotRun() && claudeFixture.installed !== null ? claudeFixture.installed : Boolean(await claudePath({ recheck: request?.recheck === true }))));

  registerSessionsIpc({ activeSession });
  registerAgentsIpc({ activeSession });

  on('link:open', (_event, url) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });

  registerCustomizeIpc();
  registerReposIpc({ sessions, openTab });
  registerPasteIpc();
  registerMentionsIpc();
  registerTasksIpc({ sessions });
  registerReplyImages({ sessions });
  registerLayoutIpc();
  handle('update:status', () => ({ readyVersion: updateReadyVersion(), whatsNew: takeWhatsNew() }));
  handle('update:restart', () => restartToUpdate(liveEnv()));
  handle('update:whats-new', async (event) => {
    await showWhatsNew(BrowserWindow.fromWebContents(event.sender));
    return { ok: true as const };
  });
}

app.whenReady().then(() => {
  if (isSnapshotRun()) app.dock?.hide(); // no Dock icon, never the active app
  if (!isSnapshotRun()) recordLaunch(); // before the first window asks for the "Updated to" note
  registerIpc();
  refreshMenu();
  const win = createWindow();
  repoIndex.refreshIfStale(); // in the background, so ⌘O opens on a fresh list
  // The organizer starts the same way in snapshot runs, so they prove the default; its passes never call Claude there.
  organizer.start({ openSessionIds });
  coord.start(sessions, { tabLabel: tabLabelOf }); // tasks, file clashes and the activity feed across live sessions
  // The dev harness is a separate chunk, loaded only in snapshot runs; release builds compile it out.
  if (__PASTEL_DEV_HARNESS__ && isSnapshotRun()) import('../dev/snapshot').then((snapshot) => snapshot.run({ win, sessions, activeSession, openTab, themes, applyTheme }));
  void startUpdater(liveEnv()); // off in snapshot, dev and non-Developer ID builds
});

app.on('before-quit', () => responseHook.stopAllHooks()); // hooks run detached, so they would outlive Petal
app.on('will-quit', () => { organizer.stop(); coord.stop(); flushActivity(); });

app.on('window-all-closed', () => app.quit());

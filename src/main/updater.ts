// Auto-update: stock electron-updater, checking at launch and every few hours, downloading in the background.
// Off in snapshot runs and in any build that isn't Developer ID signed (Mac updates need a signed app).
import path from 'node:path';
import { execFile } from 'node:child_process';
import { app, BrowserWindow, Notification } from 'electron';
import { claudeRunsUnder, listProcesses } from './claude-session';
import { isSnapshotRun } from './snapshot-mode';
import { send } from './ipc';
import * as configStore from './config-store';
import type { RestartResult, UpdateNote } from '../shared/ipc';

export const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;
export const CLAUDE_RUNNING_NOTE = 'Claude is still running in Petal. Restart once it finishes.';
export const COMMAND_RUNNING_NOTE = 'A command is still running in a Petal tab. Restart once it finishes.';
export const NOT_READY_NOTE = 'No update is ready yet.';
export const NOTIFY_TITLE = 'Petal update ready';
export const notifyBody = (version: string): string => `Version ${version} downloaded. Restart Petal to get it.`;

// electron-updater's UpdateInfo, trimmed to what Petal reads.
export interface UpdateInfo { version: string }

// The slice of electron-updater's AppUpdater this file uses, so tests can hand in a fake.
export interface Updater {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(): void;
  on(event: 'update-available' | 'update-not-available' | 'update-downloaded', listener: (info: UpdateInfo) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

export interface UpdaterEnv {
  isPackaged: boolean;
  isSnapshot: boolean;
  isDeveloperIdSigned: () => Promise<boolean>;
  loadUpdater: () => Promise<Updater>;
  claudeRunning: () => Promise<boolean>;
  commandRunning: () => Promise<boolean>; // a foreground job in any Petal tab, which quitting would SIGHUP
  currentVersion: string;
  onReady: (version: string) => void;
  onNote: (note: UpdateNote) => void;
  // The OS notification, shown once per downloaded version.
  notify: (version: string) => void;
  lastNotifiedVersion: () => string;
  saveNotifiedVersion: (version: string) => void;
  every: (ms: number, run: () => void) => void;
}

let updater: Updater | null = null;
let readyVersion: string | null = null;
let offReason: string | null = null;
let manualCheck = false; // a menu check is waiting for its outcome
let check = (): void => undefined; // set once the updater has started

export const isUpdateReady = (): boolean => readyVersion !== null;
export const updateReadyVersion = (): string | null => readyVersion;

function onDownloaded(env: UpdaterEnv, version: string): void {
  readyVersion = version;
  manualCheck = false;
  env.onReady(version);
  if (env.lastNotifiedVersion() === version) return;
  env.saveNotifiedVersion(version);
  env.notify(version);
}

// Only a menu check reports "up to date", "downloading" or a failure; background checks stay quiet.
function reportManual(env: UpdaterEnv, note: UpdateNote): void {
  if (!manualCheck) return;
  if (note.kind !== 'downloading') manualCheck = false;
  env.onNote(note);
}

// Returns why updates are off, or null once checking has started.
export async function startUpdater(env: UpdaterEnv): Promise<string | null> {
  offReason = await whyOff(env);
  if (offReason) {
    reportManual(env, { kind: 'off' }); // a menu check made while this was being worked out
    return offReason;
  }

  updater = await env.loadUpdater();
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.on('update-available', (info) => reportManual(env, { kind: 'downloading', version: info.version }));
  updater.on('update-not-available', () => reportManual(env, { kind: 'up-to-date', version: env.currentVersion }));
  updater.on('update-downloaded', (info) => onDownloaded(env, info.version));
  updater.on('error', (error) => failed(env, error));
  check = () => { updater?.checkForUpdates().catch((error: Error) => failed(env, error)); };
  check();
  env.every(CHECK_EVERY_MS, check);
  return null;
}

async function whyOff(env: UpdaterEnv): Promise<string | null> {
  if (env.isSnapshot) return 'snapshot run';
  if (!env.isPackaged) return 'not packaged';
  if (!(await env.isDeveloperIdSigned())) return 'not Developer ID signed';
  return null;
}

function failed(env: UpdaterEnv, error: Error): void {
  console.warn('[petal] update check failed:', error.message);
  reportManual(env, { kind: 'failed' });
}

// Petal › Check for Updates…: the outcome lands in the pill.
export function checkForUpdatesNow(env: Pick<UpdaterEnv, 'onReady' | 'onNote'>): void {
  if (readyVersion) return env.onReady(readyVersion);
  if (offReason) return env.onNote({ kind: 'off' });
  env.onNote({ kind: 'checking' });
  manualCheck = true;
  check(); // before startUpdater has loaded the updater, the launch check reports instead
}

// The pill's Restart: never while a Claude or any other foreground command runs in Petal, since quitting would cut it off.
// beforeInstall runs while the windows are still open (quitAndInstall closes them before before-quit).
export async function restartToUpdate(env: Pick<UpdaterEnv, 'claudeRunning' | 'commandRunning'> & { beforeInstall?: () => Promise<void> }): Promise<RestartResult> {
  if (!readyVersion || !updater) return { note: NOT_READY_NOTE };
  if (await env.claudeRunning()) return { note: CLAUDE_RUNNING_NOTE };
  if (await env.commandRunning()) return { note: COMMAND_RUNNING_NOTE };
  await env.beforeInstall?.();
  updater.quitAndInstall();
  return { restarting: true };
}

// Test seam: forget the started updater between cases.
export function resetForTests(): void {
  updater = null;
  readyVersion = null;
  offReason = null;
  manualCheck = false;
  check = () => undefined;
}

// codesign prints its details on stderr; ad-hoc and Apple Development builds have no Developer ID authority.
function isDeveloperIdSigned(): Promise<boolean> {
  const bundle = path.resolve(app.getPath('exe'), '..', '..', '..');
  return new Promise((resolve) => {
    execFile('/usr/bin/codesign', ['-dv', '--verbose=2', bundle], (error, _stdout, stderr) =>
      resolve(!error && /^Authority=Developer ID Application:/m.test(stderr)));
  });
}

// Clicking it brings Petal forward, where the pill offers the restart.
function showNotification(version: string): void {
  if (!Notification.isSupported()) return;
  const notification = new Notification({ title: NOTIFY_TITLE, body: notifyBody(version) });
  notification.on('click', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  notification.show();
}

const claudeInPetal = async (): Promise<boolean> => claudeRunsUnder(process.pid, await listProcesses());

export interface TerminalRow { pid: number; pgid: number; tpgid: number }

// A shell at its prompt owns its terminal's foreground group; anything else in front is a running command.
export const foregroundJobRunning = (shellPids: readonly number[], rows: readonly TerminalRow[]): boolean =>
  rows.some((row) => shellPids.includes(row.pid) && row.tpgid > 0 && row.tpgid !== row.pgid);

export const parseTerminalRows = (stdout: string): TerminalRow[] => stdout.split('\n').flatMap((line) => {
  const match = /^\s*(\d+)\s+(\d+)\s+(-?\d+)\s*$/.exec(line);
  return match ? [{ pid: Number(match[1]), pgid: Number(match[2]), tpgid: Number(match[3]) }] : [];
});

// The shared ps listing has no terminal groups, so this asks ps for just the given tab shells.
export async function foregroundJobIn(shellPids: readonly number[]): Promise<boolean> {
  if (!shellPids.length) return false;
  const stdout = await new Promise<string>((resolve) =>
    execFile('/bin/ps', ['-o', 'pid=,pgid=,tpgid=', '-p', shellPids.join(',')], (error, out) => resolve(error && !out ? '' : out)));
  return foregroundJobRunning(shellPids, parseTerminalRows(stdout));
}

const commandInPetal = async (): Promise<boolean> => foregroundJobIn([...(await import('./tabs')).sessions.values()].map((s) => s.pty.pid));

export const liveEnv = (): UpdaterEnv => ({
  isPackaged: app.isPackaged,
  isSnapshot: isSnapshotRun(),
  isDeveloperIdSigned,
  loadUpdater: async () => (await import('electron-updater')).autoUpdater,
  claudeRunning: claudeInPetal,
  commandRunning: commandInPetal,
  currentVersion: app.getVersion(),
  onReady: (version) => BrowserWindow.getAllWindows().forEach((win) => send(win.webContents, 'update:ready', { version })),
  onNote: (note) => BrowserWindow.getAllWindows().forEach((win) => send(win.webContents, 'update:note', note)),
  notify: showNotification,
  lastNotifiedVersion: () => configStore.load().updates.lastNotifiedVersion,
  saveNotifiedVersion: (version) => { configStore.save({ updates: { lastNotifiedVersion: version } }); },
  every: (ms, run) => { setInterval(run, ms).unref(); },
});

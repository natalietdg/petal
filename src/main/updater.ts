// Auto-update: stock electron-updater, checking at launch and every few hours, downloading in the background.
// Off in snapshot runs and in any build that isn't Developer ID signed (Mac updates need a signed app).
import path from 'node:path';
import { execFile } from 'node:child_process';
import { app, BrowserWindow } from 'electron';
import { claudeRunsUnder, listProcesses } from './claude-session';
import { isSnapshotRun } from './snapshot-mode';
import { send } from './ipc';
import type { RestartResult } from '../shared/ipc';

export const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;
export const CLAUDE_RUNNING_NOTE = 'Claude is still running in Petal. Restart once it finishes.';
export const NOT_READY_NOTE = 'No update is ready yet.';

// The slice of electron-updater's AppUpdater this file uses, so tests can hand in a fake.
export interface Updater {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(): void;
  on(event: 'update-downloaded', listener: () => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

export interface UpdaterEnv {
  isPackaged: boolean;
  isSnapshot: boolean;
  isDeveloperIdSigned: () => Promise<boolean>;
  loadUpdater: () => Promise<Updater>;
  claudeRunning: () => Promise<boolean>;
  onReady: () => void;
  every: (ms: number, run: () => void) => void;
}

let updater: Updater | null = null;
let ready = false;

export const isUpdateReady = (): boolean => ready;

// Returns why updates are off, or null once checking has started.
export async function startUpdater(env: UpdaterEnv): Promise<string | null> {
  if (env.isSnapshot) return 'snapshot run';
  if (!env.isPackaged) return 'not packaged';
  if (!(await env.isDeveloperIdSigned())) return 'not Developer ID signed';

  updater = await env.loadUpdater();
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.on('update-downloaded', () => {
    ready = true;
    env.onReady();
  });
  updater.on('error', (error) => console.warn('[petal] update check failed:', error.message));
  const check = () => { updater?.checkForUpdates().catch((error: Error) => console.warn('[petal] update check failed:', error.message)); };
  check();
  env.every(CHECK_EVERY_MS, check);
  return null;
}

// The pill's Restart: never while a Claude runs inside Petal, since quitting would cut it off.
export async function restartToUpdate(env: Pick<UpdaterEnv, 'claudeRunning'>): Promise<RestartResult> {
  if (!ready || !updater) return { note: NOT_READY_NOTE };
  if (await env.claudeRunning()) return { note: CLAUDE_RUNNING_NOTE };
  updater.quitAndInstall();
  return { restarting: true };
}

// Test seam: forget the started updater between cases.
export function resetForTests(): void {
  updater = null;
  ready = false;
}

// codesign prints its details on stderr; ad-hoc and Apple Development builds have no Developer ID authority.
function isDeveloperIdSigned(): Promise<boolean> {
  const bundle = path.resolve(app.getPath('exe'), '..', '..', '..');
  return new Promise((resolve) => {
    execFile('/usr/bin/codesign', ['-dv', '--verbose=2', bundle], (error, _stdout, stderr) =>
      resolve(!error && /^Authority=Developer ID Application:/m.test(stderr)));
  });
}

const claudeInPetal = async (): Promise<boolean> => claudeRunsUnder(process.pid, await listProcesses());

export const liveEnv = (): UpdaterEnv => ({
  isPackaged: app.isPackaged,
  isSnapshot: isSnapshotRun(),
  isDeveloperIdSigned,
  loadUpdater: async () => (await import('electron-updater')).autoUpdater,
  claudeRunning: claudeInPetal,
  onReady: () => BrowserWindow.getAllWindows().forEach((win) => send(win.webContents, 'update:ready')),
  every: (ms, run) => { setInterval(run, ms).unref(); },
});

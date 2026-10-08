import { beforeEach, describe, expect, it, vi } from 'vitest';
import { claudeRunsUnder } from '../src/main/claude-session';
import {
  CHECK_EVERY_MS, CLAUDE_RUNNING_NOTE, NOT_READY_NOTE, isUpdateReady, resetForTests, restartToUpdate, startUpdater, type Updater, type UpdaterEnv,
} from '../src/main/updater';

// electron-updater's autoUpdater, faked: records checks and installs, and lets a test fire its events.
const fake = vi.hoisted(() => {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  return {
    listeners,
    autoUpdater: {
      autoDownload: false,
      autoInstallOnAppQuit: false,
      checkForUpdates: vi.fn(() => Promise.resolve(null)),
      quitAndInstall: vi.fn(),
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => listeners.set(event, listener)),
    },
  };
});
vi.mock('electron-updater', () => ({ autoUpdater: fake.autoUpdater }));

// Loaded the way liveEnv loads it.
const loadUpdater = vi.fn(async () => (await import('electron-updater')).autoUpdater as unknown as Updater);

function env(overrides: Partial<UpdaterEnv> = {}): UpdaterEnv & { scheduled: { ms: number; run: () => void }[] } {
  const scheduled: { ms: number; run: () => void }[] = [];
  return {
    isPackaged: true,
    isSnapshot: false,
    isDeveloperIdSigned: async () => true,
    loadUpdater,
    claudeRunning: async () => false,
    onReady: vi.fn(),
    every: (ms, run) => { scheduled.push({ ms, run }); },
    scheduled,
    ...overrides,
  };
}

beforeEach(() => {
  resetForTests();
  fake.listeners.clear();
  vi.clearAllMocks();
});

describe('startUpdater', () => {
  it('stays off in snapshot runs', async () => {
    expect(await startUpdater(env({ isSnapshot: true }))).toBe('snapshot run');
    expect(loadUpdater).not.toHaveBeenCalled();
  });

  it('stays off when not packaged (dev)', async () => {
    expect(await startUpdater(env({ isPackaged: false }))).toBe('not packaged');
    expect(loadUpdater).not.toHaveBeenCalled();
  });

  it('stays off in unsigned or Apple Development builds', async () => {
    expect(await startUpdater(env({ isDeveloperIdSigned: async () => false }))).toBe('not Developer ID signed');
    expect(loadUpdater).not.toHaveBeenCalled();
    expect(fake.autoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  it('checks at launch, then every few hours, downloading in the background', async () => {
    const live = env();
    expect(await startUpdater(live)).toBeNull();
    expect(fake.autoUpdater.autoDownload).toBe(true);
    expect(fake.autoUpdater.autoInstallOnAppQuit).toBe(true);
    expect(fake.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(live.scheduled).toHaveLength(1);
    expect(live.scheduled[0].ms).toBe(CHECK_EVERY_MS);
    live.scheduled[0].run();
    expect(fake.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it('a failed check is logged, never thrown', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fake.autoUpdater.checkForUpdates.mockReturnValueOnce(Promise.reject(new Error('offline')));
    await startUpdater(env());
    await new Promise((resolve) => setImmediate(resolve));
    expect(warn).toHaveBeenCalledWith('[petal] update check failed:', 'offline');
    warn.mockRestore();
  });
});

describe('restartToUpdate', () => {
  it('does nothing before an update has downloaded', async () => {
    await startUpdater(env());
    expect(await restartToUpdate(env())).toEqual({ note: NOT_READY_NOTE });
    expect(fake.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('never restarts while a Claude is running in Petal', async () => {
    const live = env({ claudeRunning: async () => true });
    await startUpdater(live);
    fake.listeners.get('update-downloaded')?.();
    expect(isUpdateReady()).toBe(true);
    expect(live.onReady).toHaveBeenCalledTimes(1);
    expect(await restartToUpdate(live)).toEqual({ note: CLAUDE_RUNNING_NOTE });
    expect(fake.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('restarts into the update once no Claude is running', async () => {
    const live = env();
    await startUpdater(live);
    fake.listeners.get('update-downloaded')?.();
    expect(await restartToUpdate(live)).toEqual({ restarting: true });
    expect(fake.autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it('an unsigned build has no updater to restart', async () => {
    await startUpdater(env({ isDeveloperIdSigned: async () => false }));
    expect(await restartToUpdate(env())).toEqual({ note: NOT_READY_NOTE });
  });
});

describe('claudeRunsUnder', () => {
  const petal = 100;
  const rows = (comm: string, parent = 201) => [
    { pid: 200, ppid: petal, comm: 'Petal Helper' },
    { pid: 201, ppid: 200, comm: '-zsh' },
    { pid: 300, ppid: parent, comm },
  ];

  it('finds a claude anywhere under Petal', () => {
    expect(claudeRunsUnder(petal, rows('/Users/x/.local/bin/claude'))).toBe(true);
  });

  it('ignores a claude outside Petal and claude helpers', () => {
    expect(claudeRunsUnder(petal, rows('claude', 1))).toBe(false);
    expect(claudeRunsUnder(petal, rows('claude bg-spare'))).toBe(false);
  });
});

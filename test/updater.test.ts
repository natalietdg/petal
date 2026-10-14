import { beforeEach, describe, expect, it, vi } from 'vitest';
import { claudeRunsUnder } from '../src/main/claude-session';
import {
  CHECK_EVERY_MS, CLAUDE_RUNNING_NOTE, COMMAND_RUNNING_NOTE, foregroundJobRunning, NOT_READY_NOTE, parseTerminalRows, checkForUpdatesNow, isUpdateReady, notifyBody, NOTIFY_TITLE, resetForTests, restartToUpdate, startUpdater,
  updateReadyVersion, type Updater, type UpdaterEnv,
} from '../src/main/updater';
import { updateNoteText, updatePillText, whatsNewText } from '../src/shared/ipc';
import { changelogSection, versionToAnnounce } from '../src/main/whats-new';

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
  let notified = '';
  return {
    currentVersion: '1.0.6',
    onNote: vi.fn(),
    notify: vi.fn(),
    lastNotifiedVersion: () => notified,
    saveNotifiedVersion: (version) => { notified = version; },
    isPackaged: true,
    isSnapshot: false,
    isDeveloperIdSigned: async () => true,
    loadUpdater,
    claudeRunning: async () => false,
    commandRunning: async () => false,
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
    fake.listeners.get('update-downloaded')?.({ version: '1.0.7' });
    expect(isUpdateReady()).toBe(true);
    expect(live.onReady).toHaveBeenCalledTimes(1);
    expect(await restartToUpdate(live)).toEqual({ note: CLAUDE_RUNNING_NOTE });
    expect(fake.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('never restarts while any other command runs in front of a Petal shell', async () => {
    const live = env({ commandRunning: async () => true });
    await startUpdater(live);
    fake.listeners.get('update-downloaded')?.({ version: '1.0.7' });
    expect(await restartToUpdate(live)).toEqual({ note: COMMAND_RUNNING_NOTE });
    expect(COMMAND_RUNNING_NOTE).toBe('A command is still running in a Petal tab. Restart once it finishes.');
    expect(fake.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('the Claude note wins when both are running', async () => {
    const live = env({ claudeRunning: async () => true, commandRunning: async () => true });
    await startUpdater(live);
    fake.listeners.get('update-downloaded')?.({ version: '1.0.7' });
    expect(await restartToUpdate(live)).toEqual({ note: CLAUDE_RUNNING_NOTE });
  });

  it('restarts into the update once no Claude is running', async () => {
    const live = env();
    await startUpdater(live);
    fake.listeners.get('update-downloaded')?.({ version: '1.0.7' });
    expect(await restartToUpdate(live)).toEqual({ restarting: true });
    expect(fake.autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it('an unsigned build has no updater to restart', async () => {
    await startUpdater(env({ isDeveloperIdSigned: async () => false }));
    expect(await restartToUpdate(env())).toEqual({ note: NOT_READY_NOTE });
  });
});

describe('update visibility', () => {
  const fire = (event: string, payload?: unknown) => fake.listeners.get(event)?.(payload);

  it('passes the downloaded version to the pill', async () => {
    const live = env();
    await startUpdater(live);
    fire('update-downloaded', { version: '1.0.7' });
    expect(live.onReady).toHaveBeenCalledWith('1.0.7');
    expect(updateReadyVersion()).toBe('1.0.7');
    expect(updatePillText('1.0.7')).toBe('Petal 1.0.7 ready · Restart');
  });

  it('notifies once per downloaded version', async () => {
    const live = env();
    await startUpdater(live);
    fire('update-downloaded', { version: '1.0.7' });
    fire('update-downloaded', { version: '1.0.7' });
    expect(live.notify).toHaveBeenCalledTimes(1);
    expect(live.notify).toHaveBeenCalledWith('1.0.7');
    fire('update-downloaded', { version: '1.0.8' });
    expect(live.notify).toHaveBeenCalledTimes(2);
    expect(NOTIFY_TITLE).toBe('Petal update ready');
    expect(notifyBody('1.0.7')).toBe('Version 1.0.7 downloaded. Restart Petal to get it.');
  });

  it('does not notify again for a version already notified before a relaunch', async () => {
    const live = env({ lastNotifiedVersion: () => '1.0.7' });
    await startUpdater(live);
    fire('update-downloaded', { version: '1.0.7' });
    expect(live.notify).not.toHaveBeenCalled();
    expect(live.onReady).toHaveBeenCalledWith('1.0.7');
  });

  it('a menu check reports checking, then up to date with the current version', async () => {
    const live = env();
    await startUpdater(live);
    checkForUpdatesNow(live);
    expect(live.onNote).toHaveBeenNthCalledWith(1, { kind: 'checking' });
    expect(fake.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2);
    fire('update-not-available', { version: '1.0.6' });
    expect(live.onNote).toHaveBeenNthCalledWith(2, { kind: 'up-to-date', version: '1.0.6' });
  });

  it('a menu check reports downloading, then the ready pill', async () => {
    const live = env();
    await startUpdater(live);
    checkForUpdatesNow(live);
    fire('update-available', { version: '1.0.7' });
    expect(live.onNote).toHaveBeenLastCalledWith({ kind: 'downloading', version: '1.0.7' });
    fire('update-downloaded', { version: '1.0.7' });
    expect(live.onReady).toHaveBeenCalledWith('1.0.7');
    checkForUpdatesNow(live); // once ready, the menu just shows the Restart pill again
    expect(live.onReady).toHaveBeenCalledTimes(2);
  });

  it('a menu check reports a failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const live = env();
    await startUpdater(live);
    checkForUpdatesNow(live);
    fire('error', new Error('offline'));
    expect(live.onNote).toHaveBeenLastCalledWith({ kind: 'failed' });
    warn.mockRestore();
  });

  it('background checks stay quiet', async () => {
    const live = env();
    await startUpdater(live);
    fire('update-not-available', { version: '1.0.6' });
    fire('update-available', { version: '1.0.7' });
    expect(live.onNote).not.toHaveBeenCalled();
  });

  it('a menu check in a build without updates says so', async () => {
    const live = env({ isPackaged: false });
    await startUpdater(live);
    checkForUpdatesNow(live);
    expect(live.onNote).toHaveBeenCalledWith({ kind: 'off' });
    expect(fake.autoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  it('check messages read plainly, with no em dashes', () => {
    const texts = [
      updateNoteText({ kind: 'checking' }),
      updateNoteText({ kind: 'up-to-date', version: '1.0.6' }),
      updateNoteText({ kind: 'downloading', version: '1.0.7' }),
      updateNoteText({ kind: 'off' }),
      updateNoteText({ kind: 'failed' }),
    ];
    expect(texts).toEqual([
      'Checking…', 'Petal is up to date (1.0.6)', 'Downloading Petal 1.0.7…', 'Updates are off in this build', 'Couldn’t check for updates. Try again later.',
    ]);
    expect(texts.join(' ')).not.toMatch(/[—–]/);
  });
});

describe("what's new", () => {
  const CHANGELOG = '# Changelog\n\n## [1.0.7] · 2026-10-15\n- Updates name their version.\n\n## [1.0.6] · 2026-10-14\n- Icons.\n';

  it('reads the current version section from CHANGELOG.md', () => {
    expect(changelogSection(CHANGELOG, '1.0.7')).toBe('- Updates name their version.');
    expect(changelogSection(CHANGELOG, '1.0.6')).toBe('- Icons.');
    expect(changelogSection(CHANGELOG, '2.0.0')).toBeNull();
  });

  it('announces a new version once, then never again', () => {
    let seen = '1.0.6';
    const launch = () => versionToAnnounce({ current: '1.0.7', lastSeen: seen, usedBefore: true, saveSeen: (v) => { seen = v; } });
    expect(launch()).toBe('1.0.7');
    expect(seen).toBe('1.0.7');
    expect(launch()).toBeNull();
  });

  it('a fresh install has nothing to announce, but records its version', () => {
    let seen = '';
    expect(versionToAnnounce({ current: '1.0.7', lastSeen: seen, usedBefore: false, saveSeen: (v) => { seen = v; } })).toBeNull();
    expect(seen).toBe('1.0.7');
  });

  it('an existing setup from before this was recorded gets the note', () => {
    expect(versionToAnnounce({ current: '1.0.7', lastSeen: '', usedBefore: true, saveSeen: () => undefined })).toBe('1.0.7');
  });

  it('the note links to notes only when CHANGELOG.md has them', () => {
    expect(whatsNewText({ version: '1.0.7', hasNotes: true })).toBe("Updated to 1.0.7 · What's new");
    expect(whatsNewText({ version: '1.0.7', hasNotes: false })).toBe('Updated to 1.0.7');
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

describe('foreground job detection', () => {
  it('parses ps pid/pgid/tpgid rows, including -1 for no terminal', () => {
    expect(parseTerminalRows('  101   101   101\n  202   202   305\n 303 303 -1\nbad\n')).toEqual([
      { pid: 101, pgid: 101, tpgid: 101 }, { pid: 202, pgid: 202, tpgid: 305 }, { pid: 303, pgid: 303, tpgid: -1 },
    ]);
  });

  it('a shell at its prompt owns the foreground; a job in front of it does not', () => {
    expect(foregroundJobRunning([101], [{ pid: 101, pgid: 101, tpgid: 101 }])).toBe(false);
    expect(foregroundJobRunning([101, 202], [{ pid: 101, pgid: 101, tpgid: 101 }, { pid: 202, pgid: 202, tpgid: 305 }])).toBe(true);
    expect(foregroundJobRunning([101], [{ pid: 202, pgid: 202, tpgid: 305 }])).toBe(false); // not a Petal shell
    expect(foregroundJobRunning([303], [{ pid: 303, pgid: 303, tpgid: -1 }])).toBe(false);
    expect(foregroundJobRunning([], [])).toBe(false);
  });
});

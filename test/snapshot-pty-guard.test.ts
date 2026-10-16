// Snapshot runs never type a step's text into a shell: the IPC records it, and the stand-in shell refuses unsigned lines.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const stub = vi.hoisted(() => ({
  listeners: new Map<string, (event: unknown, payload: unknown) => unknown>(),
  sent: [] as { channel: string; payload: unknown }[],
  ptys: [] as { written: string[]; emit: (data: string) => void }[],
}));

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: () => null, getAllWindows: () => [] },
  webContents: { fromId: () => null },
}));
vi.mock('../src/main/ipc', () => ({
  on: (channel: string, listener: (event: unknown, payload: unknown) => void) => stub.listeners.set(channel, listener),
  handle: (channel: string, listener: (event: unknown, payload: unknown) => unknown) => stub.listeners.set(channel, listener),
  send: (_contents: unknown, channel: string, payload: unknown) => stub.sent.push({ channel, payload }),
}));
vi.mock('../src/main/pty', () => ({
  spawnShell: () => {
    let onData: (data: string) => void = () => {};
    const pty = { pid: 1, written: [] as string[], write: (d: string) => pty.written.push(d), onData: (cb: (d: string) => void) => { onData = cb; }, onExit: () => {}, kill: () => {}, resize: () => {}, emit: (d: string) => onData(d) };
    stub.ptys.push(pty);
    return pty;
  },
}));
vi.mock('../src/main/reader-feed', () => ({ ReaderFeed: class { session = null; stop(): void {} } }));
vi.mock('../src/main/sessions-ipc', () => ({ closeConcluded: () => {} }));
vi.mock('../src/main/session-organizer', () => ({ loadCached: () => ({}) }));
vi.mock('../src/main/response-hook', () => ({ onReplyFinished: () => null }));
vi.mock('../src/main/session-title', () => ({ sessionTitleFor: () => 'x' }));
vi.mock('../src/main/claude-cli', () => ({ claudePath: async () => '/usr/local/bin/claude', dropFromChildEnv: () => false }));

// The texts a leak once typed into her real zsh, plus shell syntax that would do harm if it ran.
const STEP_TEXTS = [
  'Does the History preview send to the right session? Check: open History and click a card.',
  '/qa-kit:triage today',
  'fork it please',
  'echo pwned > ~/petal-leak; rm -rf "$HOME/x"',
];

let scratch: string;
beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'petal-ptyguard-'));
  vi.stubEnv('PASTEL_SNAPSHOT', '1');
  vi.stubEnv('PASTEL_SNAPSHOT_DIR', scratch);
  vi.stubEnv('PASTEL_SNAPSHOT_FAKE_JSONL', path.join(scratch, 'fixture.jsonl'));
  vi.stubEnv('PASTEL_SNAPSHOT_MODE', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe('snapshot tab IPC never writes step text to a pty', () => {
  type Tabs = typeof import('../src/main/tabs');
  type Mode = typeof import('../src/main/snapshot-mode');
  let tabs: Tabs;
  let mode: Mode;
  const sender = { id: 7, isDestroyed: () => false, send: () => {} };
  const call = (channel: string, payload: unknown) => stub.listeners.get(channel)?.({ sender }, payload);

  beforeEach(async () => {
    vi.useFakeTimers();
    stub.listeners.clear();
    stub.sent.length = 0;
    stub.ptys.length = 0;
    vi.resetModules();
    tabs = await import('../src/main/tabs');
    mode = await import('../src/main/snapshot-mode');
    tabs.registerTabIpc();
    call('pty:start', { tabId: 't1', cols: 80, rows: 24 });
  });

  it('pty:write, pty:paste and tab:start-claude record the text and write nothing', async () => {
    for (const text of STEP_TEXTS) {
      call('pty:write', { tabId: 't1', data: `${text}\r` });
      expect(await call('pty:paste', { tabId: 't1', data: `\x1b[200~${text}\x1b[201~\r` })).toEqual({ sent: true });
      call('tab:start-claude', { tabId: 't1', prompt: text });
    }
    vi.advanceTimersByTime(1000);
    expect(stub.ptys[0].written).toEqual([]);
    expect(mode.ptyWrites.map((w) => w.data)).toEqual(STEP_TEXTS.map((t) => `${t}\r`));
    expect(mode.pasteWrites).toHaveLength(STEP_TEXTS.length);
    expect(mode.claudeStarts.map((s) => s.prompt)).toEqual(STEP_TEXTS);
  });

  it('a paste to a tab that does not exist still says so', async () => {
    expect(await call('pty:paste', { tabId: 'nope', data: 'x' })).toEqual({ sent: false });
  });

  it("Add Session's auto-start types only the signed no-op, never claude or her text", async () => {
    const { harnessLine } = await import('../src/main/snapshot-shell');
    call('pty:start', { tabId: 't2', cols: 80, rows: 24, startClaude: true });
    stub.ptys[1].emit('% ');
    await vi.advanceTimersByTimeAsync(1000);
    expect(stub.ptys[1].written).toEqual([harnessLine(': petal-start-claude')]);
    expect(stub.ptys[1].written[0]).toMatch(/^petal-[0-9a-f]{12} : petal-start-claude\r$/);
  });

  it('every byte a guarded shell prints is kept for the end-of-run leak scan', async () => {
    const { shellOutput } = await import('../src/main/snapshot-shell');
    stub.ptys[0].emit('one ');
    stub.ptys[0].emit('two');
    expect(shellOutput.get('7:t1')).toBe('one two');
  });
});

describe('snapshot shell guard', () => {
  it('the live-Claude runs keep her own shell; every other snapshot run is guarded', async () => {
    vi.resetModules();
    const shell = await import('../src/main/snapshot-shell');
    expect(shell.guardsShell()).toBe(true);
    vi.stubEnv('PASTEL_SNAPSHOT_MODE', 'open-threads');
    expect(shell.guardsShell()).toBe(true);
    vi.stubEnv('PASTEL_SNAPSHOT_MODE', 'resume');
    expect(shell.guardsShell()).toBe(false);
    vi.stubEnv('PASTEL_SNAPSHOT', '');
    expect(shell.guardsShell()).toBe(false);
    expect(shell.harnessLine('clear')).toBe('clear\r');
  });

  it('finds zsh errors, the refusal marker and recorded text in a transcript', async () => {
    const { leaksIn, typedRuns } = await import('../src/main/snapshot-shell');
    const runs = typedRuns(`\x1b[200~${STEP_TEXTS[0]}\x1b[201~\r`);
    expect(runs).toEqual([STEP_TEXTS[0].slice(0, 40)]);
    expect(typedRuns('\x1b[A\r')).toEqual([]); // keys and terminal replies are not text
    const leaked = `% \x1b[7m${STEP_TEXTS[0]}\x1b[27m\r\nzsh: no matches found: session?\r\n`;
    expect(leaksIn('t1', leaked, runs).map((l) => l.what)).toEqual(['zsh: no matches found', runs[0]]);
    expect(leaksIn('t1', 'zsh: command not found: fork', []).map((l) => l.what)).toEqual(['command not found']);
    expect(leaksIn('t1', 'petal-snapshot refused a typed line', [])).toHaveLength(1);
    expect(leaksIn('t1', 'petal-snapshot % echo tab2\r\ntab2\r\n', runs)).toEqual([]);
  });
});

// The real stand-in zsh, driven through a real pty: signed lines run, anything else is refused and never run.
describe('the stand-in shell', () => {
  it('runs only signed lines, with HOME and ZDOTDIR in the scratch folder', async () => {
    vi.resetModules();
    const pty = await import('node-pty');
    const shell = await import('../src/main/snapshot-shell');
    const spawn = shell.guardedShell();
    const term = pty.spawn(spawn.file, spawn.args, { cols: 200, rows: 40, cwd: spawn.cwd, env: { PATH: '/usr/bin:/bin', TERM: 'xterm-256color', ...spawn.env } });
    let output = '';
    term.onData((data) => { output += data; });
    const until = async (test: () => boolean, ms = 8000) => {
      for (const start = Date.now(); !test(); await new Promise((r) => setTimeout(r, 50))) if (Date.now() - start > ms) throw new Error(`timed out; output: ${JSON.stringify(output.slice(-600))}`);
    };
    try {
      await until(() => output.includes('petal-snapshot'));
      for (const text of STEP_TEXTS) term.write(`${text}\r`);
      term.write(`\x1b[200~echo pasted-$((6*7))\x1b[201~\r`);
      term.write(shell.harnessLine('echo "signed-$((6*7)) home=$HOME zdot=$ZDOTDIR"'));
      await until(() => output.includes('signed-42 home='));
      const plain = shell.plainText(output);
      expect(plain).toContain(`signed-42 home=${spawn.cwd} zdot=${spawn.cwd}`);
      expect(plain.split(shell.REFUSED_MARKER).length - 1).toBeGreaterThanOrEqual(STEP_TEXTS.length + 1);
      expect(plain).not.toMatch(/command not found|no matches found|pasted-42/);
      expect(fs.existsSync(path.join(os.homedir(), 'petal-leak'))).toBe(false);
      expect(fs.existsSync(path.join(spawn.cwd, 'petal-leak'))).toBe(false);
    } finally {
      term.kill();
    }
  });
});

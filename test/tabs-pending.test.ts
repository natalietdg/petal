import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const stub = vi.hoisted(() => ({
  listeners: new Map<string, (event: unknown, payload: unknown) => void>(),
  sent: [] as { channel: string; payload: unknown }[],
  ptys: [] as { written: string[]; emit: (data: string) => void }[],
}));

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: () => null, getAllWindows: () => [] },
  webContents: { fromId: () => null },
}));
vi.mock('../src/main/ipc', () => ({
  on: (channel: string, listener: (event: unknown, payload: unknown) => void) => stub.listeners.set(channel, listener),
  handle: () => {},
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
vi.mock('../src/main/claude-cli', () => ({ claudePath: async () => null }));

type Tabs = typeof import('../src/main/tabs');
let tabs: Tabs;

beforeEach(async () => {
  vi.useFakeTimers();
  stub.listeners.clear();
  stub.sent.length = 0;
  stub.ptys.length = 0;
  vi.resetModules();
  tabs = await import('../src/main/tabs');
  tabs.registerTabIpc();
});
afterEach(() => vi.useRealTimers());

const contents = { id: 7, isDestroyed: () => false } as unknown as import('electron').WebContents;
const sender = { id: 7, isDestroyed: () => false, send: () => {} };
const startShell = (tabId: string) => stub.listeners.get('pty:start')?.({ sender }, { tabId, cols: 80, rows: 24 });
const newTabIds = () => stub.sent.filter((s) => s.channel === 'tabs:new').map((s) => (s.payload as { tabId: string }).tabId);

describe('tabs pending commands', () => {
  it('two quick openTab calls each type their own command, even when the shells start in reverse order', () => {
    tabs.openTab(contents, { command: 'resume A\r', background: true });
    tabs.openTab(contents, { command: 'resume B\r', background: true });
    const [a, b] = newTabIds();
    expect(a).not.toBe(b);
    startShell(b);
    startShell(a);
    const [ptyB, ptyA] = stub.ptys;
    ptyB.emit('$ ');
    ptyA.emit('$ ');
    vi.runOnlyPendingTimers();
    expect(ptyA.written).toEqual(['resume A\r']);
    expect(ptyB.written).toEqual(['resume B\r']);
  });

  it('a tab the renderer made itself gets no pending command', () => {
    tabs.openTab(contents, { command: 'resume A\r' });
    startShell('t1');
    stub.ptys[0].emit('$ ');
    vi.runOnlyPendingTimers();
    expect(stub.ptys[0].written).toEqual([]);
  });
});

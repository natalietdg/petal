import { beforeEach, describe, expect, it, vi } from 'vitest';

const stub = vi.hoisted(() => ({
  listeners: new Map<string, (event: unknown, payload: unknown) => void>(),
  sent: [] as { channel: string; payload: unknown }[],
  ptys: [] as { killed: boolean; exit: () => void }[],
  closed: { count: 0 },
}));

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: () => ({ isDestroyed: () => false, close: () => { stub.closed.count += 1; } }), getAllWindows: () => [] },
  webContents: { fromId: () => null },
}));
vi.mock('../src/main/ipc', () => ({
  on: (channel: string, listener: (event: unknown, payload: unknown) => void) => stub.listeners.set(channel, listener),
  handle: () => {},
  send: (_contents: unknown, channel: string, payload: unknown) => stub.sent.push({ channel, payload }),
}));
vi.mock('../src/main/pty', () => ({
  spawnShell: () => {
    let onExit = () => {};
    const pty = { pid: 1, killed: false, write: () => {}, onData: () => {}, onExit: (cb: () => void) => { onExit = cb; }, kill: () => { pty.killed = true; }, resize: () => {}, exit: () => onExit() };
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
const reloads: (() => void)[] = [];
const contents = { id: 7, isDestroyed: () => false } as unknown as import('electron').WebContents;
const sender = { id: 7, isDestroyed: () => false, send: () => {}, on: (event: string, cb: () => void) => { if (event === 'did-start-loading') reloads.push(cb); } };
const call = (channel: string, payload: unknown) => stub.listeners.get(channel)?.({ sender }, payload);

beforeEach(async () => {
  stub.listeners.clear();
  stub.sent.length = 0;
  stub.ptys.length = 0;
  stub.closed.count = 0;
  reloads.length = 0;
  vi.resetModules();
  tabs = await import('../src/main/tabs');
  tabs.registerTabIpc();
});

// One tab-bar tab plus one agent terminal, both started.
function openBoth(): { stripPty: (typeof stub.ptys)[number]; agentPty: (typeof stub.ptys)[number]; agentId: string } {
  call('pty:start', { tabId: 't1', cols: 80, rows: 24 });
  const agentId = tabs.openTab(contents, { agent: true }) ?? '';
  call('pty:start', { tabId: agentId, cols: 80, rows: 24 });
  const [stripPty, agentPty] = stub.ptys.slice(-2);
  return { stripPty, agentPty, agentId };
}

describe('agent terminal pop-out', () => {
  it('an agent terminal stays an agent until the renderer activates it', () => {
    const { agentId } = openBoth();
    expect(tabs.tabSession(7, agentId)?.agent).toBe(true);
    call('tab:activate', { tabId: agentId });
    expect(tabs.tabSession(7, agentId)?.agent).toBe(false);
  });

  it('before pop-out a reload kills the agent terminal; after it, a reload leaves it alone', () => {
    const { agentPty, agentId } = openBoth();
    call('tab:activate', { tabId: agentId });
    reloads.forEach((reload) => reload());
    expect(agentPty.killed).toBe(false);

    const fresh = tabs.openTab(contents, { agent: true }) ?? '';
    call('pty:start', { tabId: fresh, cols: 80, rows: 24 });
    reloads.forEach((reload) => reload());
    expect(stub.ptys.at(-1)?.killed).toBe(true);
    expect(agentPty.killed).toBe(false);
  });

  it('a popped-out agent closes the window when it is the last tab-bar tab', () => {
    const { stripPty, agentPty, agentId } = openBoth();
    call('tab:activate', { tabId: agentId });
    stripPty.exit();
    expect(stub.closed.count).toBe(0);
    agentPty.exit();
    expect(stub.closed.count).toBe(1);
  });

  it('an agent terminal still never closes the window, nor keeps it open', () => {
    const { stripPty, agentPty } = openBoth();
    agentPty.exit();
    expect(stub.closed.count).toBe(0);
    stripPty.exit();
    expect(stub.closed.count).toBe(1);
  });
});

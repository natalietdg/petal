// Closing a session: the pid comes only from the (injected) session list, the command must be claude,
// and SIGTERM goes only to child processes this test spawned itself.
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeSession } from '../src/main/session-close';
import { processCommand, type SessionFile } from '../src/main/claude-session';
import { removeTempDirs, tempDir } from './helpers';

const ID = '11111111-2222-3333-4444-555555555555';
const OTHER_ID = '99999999-8888-7777-6666-555555555555';
const children: ChildProcess[] = [];

// A throwaway node process whose command name is .../claude (a symlink to node), or plain node.
async function spawnChild({ asClaude = true, ignoreTerm = false } = {}): Promise<ChildProcess & { pid: number }> {
  let bin = process.execPath;
  if (asClaude) {
    bin = path.join(tempDir('petal-fake-claude-'), 'claude');
    fs.symlinkSync(process.execPath, bin);
  }
  const script = `${ignoreTerm ? "process.on('SIGTERM', () => {});" : ''} console.log('ready'); setInterval(() => {}, 1000);`;
  const child = spawn(bin, ['-e', script], { stdio: ['ignore', 'pipe', 'ignore'] });
  children.push(child);
  await new Promise<void>((resolve) => child.stdout?.once('data', () => resolve()));
  if (!child.pid) throw new Error('child did not start');
  return child as ChildProcess & { pid: number };
}

const fileFor = (pid: number, sessionId = ID): SessionFile => ({ pid, sessionId, cwd: '/tmp/petal-test', kind: 'interactive', status: 'idle' });

afterEach(() => {
  for (const child of children.splice(0)) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); // test cleanup of its own children only
  removeTempDirs();
});

describe('closeSession', () => {
  it('an unknown sessionId is an error and nothing is signalled', async () => {
    const terminate = vi.fn();
    await expect(closeSession(ID, { live: () => [], terminate })).rejects.toThrow(/not running/);
    await expect(closeSession(ID, { live: () => [fileFor(424242, OTHER_ID)], terminate })).rejects.toThrow(/not running/);
    expect(terminate).not.toHaveBeenCalled();
  });

  it('sends SIGTERM to a real claude-named child and detects its exit', async () => {
    const child = await spawnChild();
    expect(path.basename((await processCommand(child.pid)) ?? '')).toBe('claude');
    const exit = new Promise((resolve) => child.once('exit', (_code, signal) => resolve(signal)));
    const outcome = await closeSession(ID, { live: () => [fileFor(child.pid)], reread: () => fileFor(child.pid) });
    expect(outcome).toEqual({ closed: true, session: fileFor(child.pid) });
    expect(await exit).toBe('SIGTERM');
  });

  it('refuses a pid whose command is not the claude CLI', async () => {
    const child = await spawnChild({ asClaude: false });
    await expect(closeSession(ID, { live: () => [fileFor(child.pid)], reread: () => fileFor(child.pid) })).rejects.toThrow(/Refused: .* not the claude CLI/);
    expect(child.exitCode).toBeNull();
    expect(child.signalCode).toBeNull();
  });

  it('refuses helper processes and a missing process', async () => {
    const terminate = vi.fn();
    const live = () => [fileFor(424242)];
    await expect(closeSession(ID, { live, command: async () => 'claude bg-spare', terminate })).rejects.toThrow(/Refused/);
    await expect(closeSession(ID, { live, command: async () => null, terminate })).rejects.toThrow(/no process/);
    expect(terminate).not.toHaveBeenCalled();
  });

  it('refuses when the pid no longer belongs to that session', async () => {
    const terminate = vi.fn();
    const live = () => [fileFor(424242)];
    const command = async () => '/usr/local/bin/claude';
    await expect(closeSession(ID, { live, command, reread: () => fileFor(424242, OTHER_ID), terminate })).rejects.toThrow(/no longer belongs/);
    await expect(closeSession(ID, { live, command, reread: () => null, terminate })).rejects.toThrow(/no longer belongs/);
    expect(terminate).not.toHaveBeenCalled();
  });

  it('reports Still running when the process outlives the wait, and never escalates', async () => {
    const child = await spawnChild({ ignoreTerm: true });
    const signals: string[] = [];
    const terminate = (pid: number) => { signals.push('SIGTERM'); process.kill(pid, 'SIGTERM'); };
    const outcome = await closeSession(ID, { live: () => [fileFor(child.pid)], reread: () => fileFor(child.pid), terminate, waitMs: 600 });
    expect(outcome).toEqual({ closed: false, note: 'Still running' });
    expect(signals).toEqual(['SIGTERM']);
    expect(child.exitCode).toBeNull();
  });
});

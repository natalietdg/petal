import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { removeTempDirs, tmpLeftovers, useTempUserData } from './helpers';
import type { SessionFile } from '../src/main/claude-session';

type ClosedStore = typeof import('../src/main/closed-store');

let dir: string;
let store: ClosedStore;

beforeEach(async () => {
  dir = useTempUserData();
  vi.resetModules();
  store = await import('../src/main/closed-store');
});
afterEach(removeTempDirs);

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const entry = (n: number, closedAt = n) => ({ sessionId: id(n), title: `Session ${n}`, cwd: `/work/${n}`, closedAt });

describe('closed-store', () => {
  it('keeps the newest 20, newest first', () => {
    for (let n = 1; n <= 25; n += 1) store.add(entry(n));
    const all = store.load();
    expect(all).toHaveLength(store.MAX_CLOSED);
    expect(all[0].sessionId).toBe(id(25));
    expect(all.at(-1)?.sessionId).toBe(id(6));
    expect(tmpLeftovers(dir)).toEqual([]);
  });

  it('closing the same session again moves it to the top instead of adding a second entry', () => {
    store.add(entry(1));
    store.add(entry(2));
    store.add({ ...entry(1), closedAt: 99 });
    expect(store.load().map((c) => [c.sessionId, c.closedAt])).toEqual([[id(1), 99], [id(2), 2]]);
  });

  it('reopenable leaves out sessions that are live again', () => {
    for (const n of [1, 2, 3]) store.add(entry(n));
    expect(store.reopenable([id(2)]).map((c) => c.sessionId)).toEqual([id(3), id(1)]);
    expect(store.reopenable([])).toHaveLength(3);
  });

  it('a missing, corrupt or malformed file reads as empty or skips bad entries', () => {
    expect(store.load()).toEqual([]);
    fs.writeFileSync(path.join(dir, 'closed.json'), '{nope');
    expect(store.load()).toEqual([]);
    fs.writeFileSync(path.join(dir, 'closed.json'), JSON.stringify([entry(1), { sessionId: 7 }, null, 'x']));
    expect(store.load()).toEqual([entry(1)]);
  });
});

describe('oldestIdle', () => {
  const session = (n: number, status: string | undefined, updatedAt: number): SessionFile => ({ pid: n, sessionId: id(n), cwd: '/w', kind: 'interactive', status, updatedAt });

  it('picks the least recently updated idle session and never a busy one', async () => {
    const { oldestIdle } = await import('../src/main/sessions-monitor');
    const sessions = [session(1, 'busy', 10), session(2, 'idle', 300), session(3, 'idle', 200), session(4, 'busy', 50), session(5, undefined, 1)];
    expect(oldestIdle(sessions)?.sessionId).toBe(id(3));
    expect(oldestIdle(sessions.filter((s) => s.status !== 'idle'))).toBeNull();
    expect(oldestIdle([])).toBeNull();
  });
});

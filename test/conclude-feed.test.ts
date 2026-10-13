// Close-on-conclude through a real ReaderFeed on a fixture: fires once after the turn, and never gets in the way of following.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Conclusion } from '../src/shared/conclusion';
import type { ReaderUpdate } from '../src/shared/types';
import { removeTempDirs, tempDir } from './helpers';

const stub = vi.hoisted(() => ({ allowed: true, conclusion: null as Conclusion | null }));
vi.mock('../src/main/conclusions-store', () => ({ refresh: async () => stub.conclusion }));
vi.mock('../src/main/claude-folder', () => ({ claudeFolderAllowed: () => stub.allowed }));
vi.mock('../src/main/process-poll', () => ({ subscribe: () => {}, unsubscribe: () => {} }));

const { ReaderFeed } = await import('../src/main/reader-feed');

const said = (conclusion: string, at: string): Conclusion => ({ title: '', conclusion, result: '', impact: '', at });
const settle = () => new Promise((resolve) => setTimeout(resolve, 20)); // the async conclusion read lands

function fixtureFeed() {
  const transcript = path.join(tempDir('petal-conclude-feed-'), 'log.jsonl');
  fs.writeFileSync(transcript, '');
  const fixture = { sessionId: 'feed-fixture', transcript, status: 'idle' };
  const updates: ReaderUpdate[] = [];
  const closed: string[] = [];
  const feed = new ReaderFeed(0, (_channel, update) => updates.push(update), { fixture, onConcluded: (id) => closed.push(id) });
  return { feed, fixture, updates, closed };
}

afterEach(() => {
  stub.allowed = true;
  stub.conclusion = null;
  removeTempDirs();
});

describe('ReaderFeed close on conclude', () => {
  it('a conclusion already in the log never closes', async () => {
    stub.conclusion = said('Old.', '2026-10-01T00:00:00.000Z');
    const { feed, closed } = fixtureFeed();
    for (let i = 0; i < 5; i++) { await feed.tick([]); await settle(); }
    feed.stop();
    expect(closed).toEqual([]);
  });

  it('a new conclusion closes once, after Claude stops being busy', async () => {
    const { feed, fixture, closed } = fixtureFeed();
    await feed.tick([]);
    await settle(); // baseline: no conclusion
    fixture.status = 'busy';
    stub.conclusion = said('Shipped.', '2026-10-13T10:00:00.000Z');
    fs.appendFileSync(fixture.transcript, '{"type":"user","message":{"role":"user","content":"conclude"}}\n');
    for (let i = 0; i < 4; i++) { await feed.tick([]); await settle(); }
    expect(closed).toEqual([]);
    fixture.status = 'idle';
    for (let i = 0; i < 5; i++) { await feed.tick([]); await settle(); }
    feed.stop();
    expect(closed).toEqual(['feed-fixture']);
  });

  it('turning reading back on follows the session on the next tick', async () => {
    stub.allowed = false;
    const { feed, fixture, updates } = fixtureFeed();
    await feed.tick([]);
    expect(updates.at(-1)?.sessionId).toBeNull();
    stub.allowed = true;
    fixture.sessionId = 'after-allow';
    await feed.tick([]);
    feed.stop();
    expect(updates.at(-1)).toMatchObject({ state: 'live', sessionId: 'after-allow' });
  });
});

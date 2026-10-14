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
type ConcludedSession = import('../src/main/reader-feed').ConcludedSession;

const said = (conclusion: string, at: string): Conclusion => ({ title: '', conclusion, result: '', impact: '', at });
const settle = () => new Promise((resolve) => setTimeout(resolve, 20)); // the async conclusion read lands

function fixtureFeed() {
  const transcript = path.join(tempDir('petal-conclude-feed-'), 'log.jsonl');
  fs.writeFileSync(transcript, '');
  const fixture = { sessionId: 'feed-fixture', transcript, status: 'idle' };
  const updates: ReaderUpdate[] = [];
  const closed: string[] = [];
  const targets: ConcludedSession[] = [];
  const feed = new ReaderFeed(0, (_channel, update) => updates.push(update), { fixture, onConcluded: (target) => { targets.push(target); closed.push(target.sessionId); } });
  return { feed, fixture, updates, closed, targets };
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

  const userLine = (text: string) => `${JSON.stringify({ type: 'user', timestamp: new Date().toISOString(), message: { role: 'user', content: text } })}\n`;
  const replyLine = (text: string) => `${JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(), message: { role: 'assistant', content: [{ type: 'text', text }] } })}\n`;
  const ticks = async (feed: InstanceType<typeof ReaderFeed>, n: number) => { for (let i = 0; i < n; i++) { await feed.tick([]); await settle(); } };

  // Her "conclude" goes in, Claude works on it, and its answer lands; returns the feed mid-turn.
  async function concludeAnswered() {
    const made = fixtureFeed();
    await ticks(made.feed, 1); // baseline: no conclusion
    made.fixture.status = 'busy';
    fs.appendFileSync(made.fixture.transcript, userLine('conclude'));
    await ticks(made.feed, 2);
    stub.conclusion = said('Shipped.', '2026-10-13T10:00:00.000Z');
    fs.appendFileSync(made.fixture.transcript, replyLine('**Conclusion:** Shipped.'));
    await ticks(made.feed, 2);
    return made;
  }

  it('bug 1: a "waiting" status (permission prompt / question open) never closes; idle afterwards does', async () => {
    const { feed, fixture, closed } = await concludeAnswered();
    fixture.status = 'waiting';
    await ticks(feed, 5);
    expect(closed).toEqual([]);
    fixture.status = 'idle';
    await ticks(feed, 4);
    feed.stop();
    expect(closed).toEqual(['feed-fixture']);
  });

  it('bug 3: a prompt sent after "conclude" cancels the close, even once that turn ends', async () => {
    const { feed, fixture, closed } = await concludeAnswered();
    fs.appendFileSync(fixture.transcript, userLine('wait, run the tests first'));
    await ticks(feed, 2);
    fs.appendFileSync(fixture.transcript, replyLine('Tests pass.'));
    fixture.status = 'idle';
    await ticks(feed, 6);
    feed.stop();
    expect(closed).toEqual([]);
  });

  it('bug 2: "conclude, but keep the session open" pins the banner and never closes', async () => {
    const { feed, fixture, closed } = fixtureFeed();
    await ticks(feed, 1);
    fixture.status = 'busy';
    fs.appendFileSync(fixture.transcript, userLine('conclude, but keep the session open'));
    stub.conclusion = said('Shipped.', '2026-10-13T10:00:00.000Z');
    fs.appendFileSync(fixture.transcript, replyLine('**Conclusion:** Shipped.'));
    await ticks(feed, 3);
    fixture.status = 'idle';
    await ticks(feed, 6);
    feed.stop();
    expect(closed).toEqual([]);
  });

  it('bug 4: the close names this tab\'s own claude pid (null for a fixture), not just the session', async () => {
    const { feed, fixture, targets } = await concludeAnswered();
    fixture.status = 'idle';
    await ticks(feed, 4);
    feed.stop();
    expect(targets).toEqual([{ sessionId: 'feed-fixture', pid: feed.claudePid }]);
  });
});

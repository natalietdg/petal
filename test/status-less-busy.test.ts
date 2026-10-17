// Claude Code 2.1.74-2.1.118 write no session-file status: busy/idle comes from the transcript instead, so conclude still closes.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QUIET_MS, TurnTracker, derivedStatus, turnOpenAfter } from '../src/main/turn-state';
import { parseEntry } from '../src/main/transcript-entry';
import type { Conclusion } from '../src/shared/conclusion';
import type { FixtureSession } from '../src/main/snapshot-mode';
import { removeTempDirs, tempDir } from './helpers';

const stub = vi.hoisted(() => ({ conclusion: null as Conclusion | null }));
vi.mock('../src/main/conclusions-store', () => ({ refresh: async () => stub.conclusion }));
vi.mock('../src/main/claude-folder', () => ({ claudeFolderAllowed: () => true }));
vi.mock('../src/main/process-poll', () => ({ subscribe: () => {}, unsubscribe: () => {} }));

const { ReaderFeed } = await import('../src/main/reader-feed');

const FIXTURE = path.join(__dirname, 'fixtures/old-claude/turns-2.1.75.jsonl');
const fixtureLines = fs.readFileSync(FIXTURE, 'utf8').trim().split('\n');

afterEach(() => {
  stub.conclusion = null;
  vi.useRealTimers();
  removeTempDirs();
});

describe('turn state from an old-format transcript', () => {
  it('opens on her prompt and tool results, closes on end_turn, ignores meta and local commands', () => {
    const tracker = new TurnTracker();
    const openAfterEach = fixtureLines.map((line) => { tracker.add(parseEntry(line)); return tracker.open; });
    expect(openAfterEach).toEqual([
      false, // file-history-snapshot
      true, // "say hello"
      false, // end_turn
      true, // "list the files"
      false, // text with no stop_reason yet: the quiet period covers the gap before its tool call
      true, // tool_use
      true, // tool_result
      false, // end_turn
      false, // isMeta caveat
      false, // /cost
      false, // its stdout
      false, // last-prompt
    ]);
  });

  it('an interrupted turn is closed, a thinking-only block is still open', () => {
    expect(turnOpenAfter({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } })).toBe(false);
    expect(turnOpenAfter({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking' }], stop_reason: null } })).toBe(true);
    expect(turnOpenAfter({ type: 'user', isSidechain: true, message: { role: 'user', content: 'agent prompt' } })).toBeNull();
  });

  it('a session-file status always wins; without one, busy while the turn is open or the log changed recently', () => {
    expect(derivedStatus('idle', true, 0, 10_000)).toBe('idle');
    expect(derivedStatus('waiting', false, 0, 10_000)).toBe('waiting');
    expect(derivedStatus(undefined, true, 0, 10_000)).toBe('busy');
    expect(derivedStatus(undefined, false, 10_000 - QUIET_MS + 1, 10_000)).toBe('busy');
    expect(derivedStatus(undefined, false, 10_000 - QUIET_MS, 10_000)).toBe('idle');
  });
});

describe('ReaderFeed with no session-file status', () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
  const line = (entry: object) => `${JSON.stringify(entry)}\n`;

  function statusLessFeed() {
    const transcript = path.join(tempDir('petal-old-claude-'), 'log.jsonl');
    fs.writeFileSync(transcript, fixtureLines.slice(0, 3).map((l) => `${l}\n`).join('')); // one finished turn already there
    const fixture = { sessionId: 'old-claude', transcript } as FixtureSession; // no status, as 2.1.75 writes
    const closed: string[] = [];
    const finished: string[] = [];
    const busy: boolean[] = [];
    const feed = new ReaderFeed(0, (_channel, update) => busy.push(update.busy), {
      fixture,
      onConcluded: (target) => closed.push(target.sessionId),
      onReplyFinished: ({ reply }) => finished.push(reply.markdown),
    });
    return { feed, transcript, closed, finished, busy };
  }

  it('conclude closes the tab once Claude answers and goes quiet', async () => {
    const now = { t: Date.parse('2026-10-17T05:00:00Z') };
    vi.spyOn(Date, 'now').mockImplementation(() => now.t);
    const tick = async (feed: InstanceType<typeof ReaderFeed>, n = 1, stepMs = 1000) => { for (let i = 0; i < n; i++) { await feed.tick([]); await settle(); now.t += stepMs; } };
    const { feed, transcript, closed, finished, busy } = statusLessFeed();
    await tick(feed, 2);
    expect(finished).toEqual([]); // following an old log never reports its last reply as new
    expect(busy.at(-1)).toBe(false);

    fs.appendFileSync(transcript, line({ type: 'user', timestamp: new Date(now.t).toISOString(), message: { role: 'user', content: 'conclude' } }));
    await tick(feed, 2);
    expect(busy.at(-1)).toBe(true); // the writing line shows while Claude works
    stub.conclusion = { title: '', conclusion: 'Shipped.', result: '', impact: '', at: new Date(now.t).toISOString() };
    fs.appendFileSync(transcript, line({ type: 'assistant', uuid: 'a-conclude', timestamp: new Date(now.t).toISOString(), message: { role: 'assistant', content: [{ type: 'text', text: '**Conclusion:** Shipped.' }], stop_reason: 'end_turn' } }));
    await tick(feed, 1);
    expect(closed).toEqual([]); // still inside the quiet period
    await tick(feed, 6);
    feed.stop();
    expect(closed).toEqual(['old-claude']);
    expect(finished).toEqual(['**Conclusion:** Shipped.']); // reply-finished fires once for the new turn
  });

  it('a tool call in flight keeps it busy past the quiet period', async () => {
    const now = { t: Date.parse('2026-10-17T05:00:00Z') };
    vi.spyOn(Date, 'now').mockImplementation(() => now.t);
    const { feed, transcript, closed, busy } = statusLessFeed();
    await feed.tick([]); await settle();
    stub.conclusion = { title: '', conclusion: 'Done.', result: '', impact: '', at: '2026-10-17T05:00:01Z' };
    fs.appendFileSync(transcript, line({ type: 'user', message: { role: 'user', content: 'conclude' } }));
    fs.appendFileSync(transcript, line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }], stop_reason: 'tool_use' } }));
    for (let i = 0; i < 8; i++) { await feed.tick([]); await settle(); now.t += 1000; }
    feed.stop();
    expect(busy.at(-1)).toBe(true);
    expect(closed).toEqual([]);
  });
});

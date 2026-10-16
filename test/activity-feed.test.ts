// The activity feed: newest-first ordering, same-id updates, the 500 cap, filters, and surviving a restart.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { removeTempDirs, tmpLeftovers, useTempUserData } from './helpers';
import { ACTIVITY_CAP, filterEvents, toEvent, upsertEvent, type ActivityEvent } from '../src/shared/activity';

type Feed = typeof import('../src/main/activity-feed');

const event = (n: number, extra: Partial<ActivityEvent> = {}): ActivityEvent => ({
  id: `e${n}`, kind: 'edits', at: n * 1000, sessionId: 's1', sessionName: 'One', branch: 'main', repo: 'petal', text: `event ${n}`, ...extra,
});

describe('upsertEvent', () => {
  it('keeps newest first whatever order events arrive in', () => {
    let list: ActivityEvent[] = [];
    for (const n of [3, 1, 5, 2, 4]) list = upsertEvent(list, event(n));
    expect(list.map((e) => e.id)).toEqual(['e5', 'e4', 'e3', 'e2', 'e1']);
  });

  it('replaces an event recorded again under the same id, at its new time', () => {
    let list = [event(3), event(2), event(1)];
    list = upsertEvent(list, event(1, { at: 9000, detail: ['a.ts', 'b.ts'] }));
    expect(list.map((e) => e.id)).toEqual(['e1', 'e3', 'e2']);
    expect(list[0]?.detail).toEqual(['a.ts', 'b.ts']);
    expect(list).toHaveLength(3);
  });

  it('puts the newer recording first on a tie', () => {
    const list = upsertEvent([event(1, { id: 'old', at: 5000 })], event(2, { id: 'new', at: 5000 }));
    expect(list.map((e) => e.id)).toEqual(['new', 'old']);
  });

  it('caps the list, dropping the oldest', () => {
    let list: ActivityEvent[] = [];
    for (let n = 1; n <= ACTIVITY_CAP + 20; n += 1) list = upsertEvent(list, event(n));
    expect(list).toHaveLength(ACTIVITY_CAP);
    expect(list[0]?.id).toBe(`e${ACTIVITY_CAP + 20}`);
    expect(list.at(-1)?.id).toBe('e21');
  });
});

describe('filterEvents', () => {
  const list = [
    event(1, { kind: 'task', sessionId: 's1', branch: 'main' }),
    event(2, { kind: 'edits', sessionId: 's2', branch: 'feature' }),
    event(3, { kind: 'message', sessionId: 's2', toSessionId: 's1', branch: 'feature' }),
    event(4, { kind: 'test', sessionId: null, branch: null }),
  ];
  it('filters by session (a message counts for both ends), kind and branch', () => {
    expect(filterEvents(list, { sessionId: 's1' }).map((e) => e.id)).toEqual(['e1', 'e3']);
    expect(filterEvents(list, { kind: 'edits' }).map((e) => e.id)).toEqual(['e2']);
    expect(filterEvents(list, { branch: 'feature' }).map((e) => e.id)).toEqual(['e2', 'e3']);
    expect(filterEvents(list, { sessionId: 's2', kind: 'message', branch: 'feature' }).map((e) => e.id)).toEqual(['e3']);
    expect(filterEvents(list, {})).toHaveLength(4);
  });
});

describe('toEvent', () => {
  it('drops malformed stored events', () => {
    expect(toEvent({ id: 'x', kind: 'nope', at: 1, text: 't' })).toBeNull();
    expect(toEvent({ id: 'x', kind: 'task', text: 't' })).toBeNull();
    expect(toEvent('junk')).toBeNull();
    expect(toEvent({ ...event(1), detail: ['a', 3] })?.detail).toEqual(['a']);
  });
});

describe('activity-feed store', () => {
  let dir: string;
  let feed: Feed;
  beforeEach(async () => {
    dir = useTempUserData();
    vi.resetModules();
    feed = await import('../src/main/activity-feed');
  });
  afterEach(() => { feed.resetForTests(); removeTempDirs(); });

  it('fills id and time, and keeps a same-id event as one item', () => {
    const first = feed.recordActivity({ kind: 'task', sessionId: 's1', sessionName: 'One', branch: null, repo: null, text: 'Gave a task' });
    expect(first?.id).toMatch(/^task-/);
    feed.recordActivity({ id: 'edits:s1:t1', kind: 'edits', at: Date.now() + 10, sessionId: 's1', sessionName: 'One', branch: null, repo: null, text: 'Edited 1 file', detail: ['a.ts'] });
    feed.recordActivity({ id: 'edits:s1:t1', kind: 'edits', at: Date.now() + 20, sessionId: 's1', sessionName: 'One', branch: null, repo: null, text: 'Edited 2 files', detail: ['a.ts', 'b.ts'] });
    const list = feed.listActivity();
    expect(list.map((e) => e.text)).toEqual(['Edited 2 files', 'Gave a task']);
  });

  it('records a message between two sessions', () => {
    const message = feed.recordMessage({ from: { sessionId: 's1', name: 'One', branch: 'main' }, to: { sessionId: 's2', name: 'Two' }, text: 'Can you rebase?' });
    expect(message).toMatchObject({ kind: 'message', sessionId: 's1', toSessionId: 's2', toSessionName: 'Two', branch: 'main' });
  });

  it('survives a restart, capped, with no temp files left', async () => {
    for (let n = 1; n <= ACTIVITY_CAP + 5; n += 1) feed.recordActivity({ id: `e${n}`, kind: 'edits', at: n, sessionId: 's1', sessionName: 'One', branch: null, repo: null, text: `e${n}` });
    feed.flush();
    const stored = JSON.parse(fs.readFileSync(path.join(dir, 'activity.json'), 'utf8')) as { version: number; events: ActivityEvent[] };
    expect(stored.version).toBe(1);
    expect(stored.events).toHaveLength(ACTIVITY_CAP);
    expect(tmpLeftovers(dir)).toEqual([]);
    feed.resetForTests();
    vi.resetModules();
    const again: Feed = await import('../src/main/activity-feed');
    const list = again.listActivity();
    expect(list).toHaveLength(ACTIVITY_CAP);
    expect(list[0]?.id).toBe(`e${ACTIVITY_CAP + 5}`);
    expect(list.at(-1)?.id).toBe('e6');
    again.resetForTests();
  });

  it('starts empty from an unreadable file', async () => {
    fs.writeFileSync(path.join(dir, 'activity.json'), '{nope');
    feed.resetForTests();
    expect(feed.listActivity()).toEqual([]);
  });
});

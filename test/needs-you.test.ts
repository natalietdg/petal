// The one shared "waiting on you": ranking, lane order, badge count, cross-window merge and notify-once-per-wait.
import { describe, expect, it } from 'vitest';
import { badgeCount, needsYou, NotifyGate, noticeTitle, waitingLane, type SessionSignals } from '../src/shared/needs-you';
import { laneFrom, type HubState } from '../src/main/needs-you-hub';
import type { ChildRow } from '../src/shared/subsessions';

const signal = (sessionId: string, extra: Partial<SessionSignals> = {}): SessionSignals => ({
  sessionId, tabId: `tab-${sessionId}`, windowId: 1, title: `Session ${sessionId}`, ask: null, askSince: null, decide: null, children: [], ...extra,
});
const decide = (at: number) => ({ text: '**Decide:** ship it?', replyId: 'r1', at });
const child = (sessionId: string, extra: Partial<ChildRow> = {}): ChildRow => ({
  sessionId, name: `Child ${sessionId}`, status: 'running', ask: null, askSince: null, updatedAt: 0, step: 'Reading a.ts', ...extra,
});

describe('needsYou ranking', () => {
  it('ranks permission 1, question 2, stuck child 3, Decide 4; the strongest wins', () => {
    const all = { ask: 'permission' as const, askSince: 5, decide: decide(1), children: [{ sessionId: 'c', name: 'Sweep', ask: 'question' as const, since: 2 }] };
    expect(needsYou(signal('a', all))?.kind).toBe('permission');
    expect(needsYou(signal('a', { ...all, ask: 'question' }))?.rank).toBe(2);
    const fromChild = needsYou(signal('a', { ...all, ask: null }));
    expect(fromChild).toMatchObject({ kind: 'child', rank: 3, reason: 'Sweep needs you', childSessionId: 'c', since: 2 });
    expect(needsYou(signal('a', { decide: decide(1) }))).toMatchObject({ kind: 'decide', rank: 4, replyId: 'r1', since: 1 });
  });

  it('idle at the prompt never counts, and a silent child is not waiting', () => {
    expect(needsYou(signal('idle'))).toBeNull();
    expect(needsYou(signal('quiet', { children: [{ sessionId: 'c', name: 'Stalled one', ask: null, since: null }] }))).toBeNull();
  });
});

describe('waiting lane', () => {
  it('sorts by rank, then the longest wait first, one row per session', () => {
    const lane = waitingLane([
      signal('decide-old', { decide: decide(100) }),
      signal('question-new', { ask: 'question', askSince: 900 }),
      signal('question-old', { ask: 'question', askSince: 200 }),
      signal('permission', { ask: 'permission', askSince: 950 }),
      signal('question-old', { ask: 'question', askSince: 1 }), // the same session again: first report kept
      signal('nothing'),
    ]);
    expect(lane.map((n) => n.sessionId)).toEqual(['permission', 'question-old', 'question-new', 'decide-old']);
    expect(lane[1]?.since).toBe(200);
    expect(badgeCount(lane)).toBe(4);
  });
});

describe('cross-window merge (main)', () => {
  const state = (over: Partial<HubState> = {}): HubState => ({ reports: new Map(), children: new Map(), orphans: [], ...over });

  it('sessions reported by two windows all count, and keep the window that holds them', () => {
    const lane = laneFrom(state({
      reports: new Map([
        [1, [signal('here', { ask: 'question', askSince: 10 })]],
        [2, [signal('there', { windowId: 2, ask: 'permission', askSince: 20 }), signal('calm', { windowId: 2 })]],
      ]),
    }));
    expect(lane.map((n) => [n.sessionId, n.windowId])).toEqual([['there', 2], ['here', 1]]);
    expect(badgeCount(lane)).toBe(2);
  });

  it('rolls a stuck child up onto its parent, even a parent no Petal window holds; orphans stand alone', () => {
    const lane = laneFrom(state({
      reports: new Map([[1, [signal('parent')]]]),
      children: new Map([
        ['parent', { name: 'Session parent', rows: [child('c1', { ask: 'question', askSince: 30 }), child('c2', { status: 'stalled' })] }],
        ['outside', { name: 'Terminal session', rows: [child('c3', { ask: 'question', askSince: 40 })] }],
        ['quiet', { name: 'Quiet', rows: [child('c4', { status: 'stalled' })] }],
      ]),
      orphans: [child('o1', { name: 'Lost run', ask: 'question', askSince: 50 }), child('o2')],
    }));
    expect(lane.map((n) => [n.sessionId, n.kind, n.reason])).toEqual([
      ['o1', 'question', 'Asking a question'],
      ['parent', 'child', 'Child c1 needs you'],
      ['outside', 'child', 'Child c3 needs you'],
    ]);
    expect(lane.find((n) => n.sessionId === 'outside')).toMatchObject({ tabId: null, windowId: null });
  });
});

describe('notify once per wait', () => {
  const lane = (since: number) => waitingLane([signal('a', { ask: 'permission', askSince: since })]);

  it('notifies a new wait once while Petal is unfocused, not again on later ticks', () => {
    const gate = new NotifyGate();
    expect(gate.next(lane(1), false).map(noticeTitle)).toEqual(['Session a · Asking permission']);
    expect(gate.next(lane(1), false)).toEqual([]);
  });

  it('a wait that started while she was looking is never notified later', () => {
    const gate = new NotifyGate();
    expect(gate.next(lane(1), true)).toEqual([]);
    expect(gate.next(lane(1), false)).toEqual([]);
  });

  it('a wait that ends and starts again is a new wait', () => {
    const gate = new NotifyGate();
    gate.next(lane(1), false);
    gate.next([], false);
    expect(gate.next(lane(1), false)).toHaveLength(1);
    expect(gate.next(lane(2), false)).toHaveLength(1); // a new prompt on the same session
  });
});

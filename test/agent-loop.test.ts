// A task's saved loop: one queue step with its events, a failed send put back, the saved copy taken over this window's,
// lanes rebuilt from agent records, the save check, saving next to the agent records, and the last round's tokens.
import { afterEach, describe, expect, it } from 'vitest';
import { removeTempDirs, tempDir, useTempUserData } from './helpers';
import { cleanSavedLoop, loopFromAgents, noEvents, rerunOf, roundLabel, roundTokens, stepLoop, takesSaved, unsent, type LoopInputs } from '../src/shared/agent-loop';
import { loopsOf, rememberAgent, saveLoop } from '../src/main/task-suites';
import type { AgentAction } from '../src/shared/agent-actions';
import type { CriteriaItem } from '../src/shared/test-loop';
import type { SavedLoop } from '../src/shared/testing';

afterEach(removeTempDirs);

const names = { tester: 'Quinn', fixer: 'Fixie' };
const bug = (name: string): CriteriaItem => ({ name, status: 'fail', test: { path: 'src/cart.test.ts', name: 'rounds' }, round: 1, regression: true, taskId: 't1' });
const inputs = (over: Partial<LoopInputs> = {}): LoopInputs => ({ bugs: [], runs: [], testerRound: 1, fixerBusy: false, fixesDone: [], now: 1000, ...over });
const loop = (over: Partial<SavedLoop> = {}): SavedLoop => ({
  kind: 'loop', tester: { tabId: 'tab-t', sessionId: 'sess-t' }, fixer: { tabId: 'tab-f', sessionId: 'sess-f' }, startedAt: 500, stoppedAt: null, queue: [], events: noEvents(), ...over,
});
const action = (at: number, round: number | null, tokens: number): AgentAction => ({ id: `a${at}`, at, kind: 'bash', text: 'Ran npm test · exit 0', path: null, detail: '', tokens, round });

describe('stepping the queue', () => {
  it('a filed bug goes to the idle fixer once, noted in its lane', () => {
    const first = stepLoop(loop(), inputs({ bugs: [bug('cart total drops a cent')] }), names);
    expect(first.queue.map((b) => [b.name, b.state])).toEqual([['cart total drops a cent', 'fixing']]);
    expect(first.send).toHaveLength(1);
    expect(first.send[0]).toMatchObject({ to: 'fixer' });
    expect(first.send[0].text).toContain('Bug: cart total drops a cent.');
    expect(first.events.fixer.map((e) => e.text)).toEqual(['Quinn → Fixie · cart total drops a cent']);
    expect(first.events.tester.map((e) => e.text)).toEqual(['Bug filed · open · cart total drops a cent']);
    const again = stepLoop({ queue: first.queue, events: first.events }, inputs({ bugs: [bug('cart total drops a cent')], now: 2000 }), names);
    expect(again.send).toEqual([]); // sent once
  });

  it('the fixer’s Fix line moves it to verify and asks the tester, then the next bug goes out', () => {
    const bugs = [bug('cart total drops a cent'), bug('coupon shows NaN')];
    const first = stepLoop(loop(), inputs({ bugs }), names);
    const fixed = stepLoop(first, inputs({ bugs, fixesDone: [{ name: 'cart total drops a cent', at: 1500 }], now: 2000 }), names);
    expect(fixed.queue.map((b) => [b.name, b.state])).toEqual([['cart total drops a cent', 'verify'], ['coupon shows NaN', 'fixing']]);
    expect(fixed.send.map((m) => m.to)).toEqual(['tester', 'fixer']);
    expect(fixed.send[0].text).toContain('Verify "cart total drops a cent"');
    expect(fixed.events.tester.at(-1)?.text).toBe('Fixie → Quinn · verify cart total drops a cent');
  });

  it('a send that didn’t reach its tab is put back so the next step sends it again', () => {
    const first = stepLoop(loop(), inputs({ bugs: [bug('cart total drops a cent')] }), names);
    const back = unsent(first.queue, first.send[0]);
    expect(back[0]).toMatchObject({ state: 'open', asked: false });
    expect(stepLoop({ queue: back, events: first.events }, inputs({ bugs: [bug('cart total drops a cent')], now: 3000 }), names).send).toHaveLength(1);
  });

  it('hands the fixer the failure output from the task’s newest run that has it', () => {
    const runs = [{ stages: [{ tests: [{ status: 'failed', file: 'src/cart.test.ts', name: 'cart rounds', failure: 'expected 10.01' }] }] }] as unknown as LoopInputs['runs'];
    const step = stepLoop(loop(), inputs({ bugs: [bug('cart total drops a cent')], runs }), names);
    expect(step.send[0].text).toContain('Failure output:\nexpected 10.01');
  });
});

describe('rehydrating', () => {
  it('the saved copy replaces this window’s only when it has none or the saved one is from a newer start', () => {
    expect(takesSaved(null, loop())).toBe(true);
    expect(takesSaved(loop({ startedAt: 500 }), loop({ startedAt: 500 }))).toBe(false); // this window's copy is the newer state
    expect(takesSaved(loop({ startedAt: 500 }), loop({ startedAt: 900 }))).toBe(true);
  });

  it('rebuilds lanes from agent records saved before loops were: a tester then a fixer is a loop, a lone tester a draft', () => {
    const saved = loop();
    expect(loopFromAgents(saved, [])).toBe(saved);
    expect(loopFromAgents(undefined, [{ sessionId: 'a', role: 'tester' }, { sessionId: 'b', role: 'fixer' }])).toMatchObject({ kind: 'loop', tester: { sessionId: 'a' }, fixer: { sessionId: 'b' }, startedAt: 0, stoppedAt: null });
    expect(loopFromAgents(undefined, [{ sessionId: 'a', role: 'tester' }, { sessionId: 'b', role: 'fixer' }, { sessionId: 'c', role: 'tester' }])).toMatchObject({ kind: 'draft', tester: { sessionId: 'c' }, fixer: null });
    expect(loopFromAgents(undefined, [])).toBeNull();
  });

  it('saves a loop next to the agent records only for that task’s agents in their roles, and reads it back', () => {
    useTempUserData();
    const root = tempDir();
    rememberAgent(root, 't1', 'sess-t', 'tester');
    rememberAgent(root, 't1', 'sess-f', 'fixer');
    rememberAgent(root, 't2', 'draft-t', 'tester');
    const first = stepLoop(loop(), inputs({ bugs: [bug('cart total drops a cent')] }), names);
    expect(saveLoop(root, 't1', loop({ queue: first.queue, events: first.events }))).toBe(true);
    expect(saveLoop(root, 't1', loop({ tester: { tabId: null, sessionId: 'sess-f' } }))).toBe(false); // the fixer can't pose as the tester
    expect(saveLoop(root, 't2', loop())).toBe(false); // another task's sessions
    const read = loopsOf(root);
    expect(read.t1?.queue.map((b) => b.state)).toEqual(['fixing']);
    expect(read.t1?.events.fixer.map((e) => e.text)).toEqual(['Quinn → Fixie · cart total drops a cent']);
    expect(read.t2).toMatchObject({ kind: 'draft', tester: { sessionId: 'draft-t' } }); // rebuilt from its record
  });

  it('the save check keeps the shape and drops anything else', () => {
    const good = loop({ queue: stepLoop(loop(), inputs({ bugs: [bug('x')] }), names).queue, events: { tester: [{ at: 1, text: 'hi' }], fixer: [] } });
    expect(cleanSavedLoop(JSON.parse(JSON.stringify({ ...good, extra: 'dropped' })))).toEqual(good);
    expect(cleanSavedLoop({ ...good, kind: 'loop', fixer: null })).toBeNull(); // a loop has a fixer
    expect(cleanSavedLoop({ ...good, kind: 'draft' })).toBeNull(); // a draft has none
    expect(cleanSavedLoop({ ...good, queue: [{ key: 'x' }] })).toBeNull();
    expect(cleanSavedLoop({ ...good, tester: { tabId: null, sessionId: '' } })).toBeNull();
    expect(cleanSavedLoop({ ...good, events: { tester: Array.from({ length: 150 }, (_, i) => ({ at: i, text: 't' })), fixer: [{ at: 'x' }] } })?.events).toMatchObject({ fixer: [] });
    expect(cleanSavedLoop({ ...good, events: { tester: Array.from({ length: 150 }, (_, i) => ({ at: i, text: 't' })), fixer: [] } })?.events.tester).toHaveLength(100);
  });
});

describe('the last round’s tokens', () => {
  it('the last finished round for both agents, in the estimate’s unit', () => {
    const tester = [action(600, 1, 1000), action(700, 1, 500), action(1000, 2, 2000), action(1400, 3, 300)];
    const fixer = [action(1100, null, 400), action(1450, null, 50)];
    const r = roundTokens(tester, fixer, 500);
    expect(r).toEqual({ round: 2, done: true, tokens: 2400 }); // round 2: from its first tester step to round 3's
    expect(roundLabel(r)).toBe('Round 2');
  });

  it('round one counts from the start, and before any Loop line it is everything so far', () => {
    expect(roundTokens([action(600, 1, 1000)], [action(550, null, 200)], 500)).toEqual({ round: 1, done: false, tokens: 1200 });
    expect(roundTokens([action(600, 1, 1000), action(900, 2, 10)], [action(550, null, 200)], 500)).toEqual({ round: 1, done: true, tokens: 1200 });
    const none = roundTokens([action(600, null, 70)], [action(400, null, 900)], 500);
    expect(none).toEqual({ round: null, done: false, tokens: 70 }); // the fixer's step before the start is left out
    expect(roundLabel(none)).toBe('So far');
    expect(roundLabel({ round: 1, done: false, tokens: 0 })).toBe('Round 1 so far');
  });
});

describe('a bug she sent from a failed run', () => {
  const sent = { key: 'auth rejects an expired token', name: 'auth rejects an expired token', test: 'src/auth.test.js::auth rejects an expired token', state: 'verify' as const, since: 1000, asked: false, testerRound: 0, rechecked: false, sent: { stage: 'Unit', failure: 'The test "auth rejects an expired token" fails.' } };
  const run = (startedAt: number, status: 'passed' | 'failed') => ({ startedAt, stages: [{ name: 'Unit', status, tests: [{ file: 'src/auth.test.js', name: 'auth rejects an expired token', status }] }] }) as unknown as LoopInputs['runs'][number];

  it('is verified by a newer run that passes its test, reopened by one that fails it, and waits without one', () => {
    expect(rerunOf([run(500, 'passed')], sent)).toBeNull(); // older than the fix
    expect(stepLoop(loop({ queue: [sent] }), inputs({ runs: [run(2000, 'passed')], fixerBusy: true, now: 3000 }), names).queue[0]?.state).toBe('verified');
    expect(stepLoop(loop({ queue: [sent] }), inputs({ runs: [run(2000, 'failed')], fixerBusy: true, now: 3000 }), names).queue[0]?.state).toBe('open');
    const waiting = stepLoop(loop({ queue: [sent] }), inputs({ fixerBusy: true }), names);
    expect(waiting.queue[0]?.state).toBe('verify');
    expect(waiting.send).toEqual([]); // no criteria line for the testing agent to verify
  });

  it('a whole-stage bug is verified by the stage; it survives a step with no criteria line', () => {
    const stage = { ...sent, key: 'unit stage fails', name: 'Unit stage fails', test: null };
    expect(rerunOf([run(2000, 'passed')], stage)).toBe('passed');
    expect(stepLoop(loop({ queue: [{ ...stage, state: 'open' }] }), inputs({ fixerBusy: true }), names).queue).toHaveLength(1);
  });

  it('the fixer gets what she sent as the failure, and its Fix line moves it to verify', () => {
    const step = stepLoop(loop({ queue: [{ ...sent, state: 'open' }] }), inputs(), names);
    expect(step.send[0]?.text).toContain('The test "auth rejects an expired token" fails.');
    expect(step.queue[0]?.state).toBe('fixing');
    const fixed = stepLoop(step, inputs({ fixesDone: [{ name: 'auth rejects an expired token', at: 1500 }], fixerBusy: true, now: 2000 }), names);
    expect(fixed.queue[0]?.state).toBe('verify');
  });

  it('a loop whose bug fix agent started alone saves without a testing agent, and keeps what she sent', () => {
    const alone = loop({ tester: null, queue: [sent] });
    expect(cleanSavedLoop(JSON.parse(JSON.stringify(alone)))).toEqual(alone);
    expect(cleanSavedLoop({ ...alone, kind: 'draft', fixer: null })).toBeNull(); // a draft has its testing agent
    expect(cleanSavedLoop({ ...alone, queue: [{ ...sent, sent: { stage: 'Unit', failure: 'x'.repeat(5000) } }] })?.queue[0]?.sent).toBeUndefined();
  });
});

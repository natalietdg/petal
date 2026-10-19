// The loop across windows and out of sight: one owner per loop, the loops a window steps from what was saved, Needs you
// on a lane, the notification edges, one run per task, a stage log read from its tail, and a bug sent from another window.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { removeTempDirs, tempDir } from './helpers';
import { finishNotice, fixesLanded, fixNotice, hasAgentIn, laneWord, loopOwner, NEEDS_YOU, needsNotice, newlyWaiting, runningHere, takesSave, type LaneFacts, type OwnerFacts } from '../src/shared/loop-signals';
import { cleanSentBug, noEvents } from '../src/shared/agent-loop';
import { runGoing, type SavedLoop } from '../src/shared/testing';
import { readLogTail, trimmedNote } from '../src/main/testing-runner';
import type { QueuedBug } from '../src/shared/bug-queue';

afterEach(removeTempDirs);

const loop = (over: Partial<SavedLoop> = {}): SavedLoop => ({
  kind: 'loop', tester: { tabId: 't1', sessionId: 'sess-t' }, fixer: { tabId: 't2', sessionId: 'sess-f' }, startedAt: 1, stoppedAt: null, queue: [], events: noEvents(), ...over,
});
const bug = (key: string, state: QueuedBug['state']): QueuedBug => ({ key, name: key, test: null, state, since: 1, asked: false, testerRound: 1, rechecked: false });

// Windows 1 and 2 exist; agents lists the windows with an agent tab open.
const windows = (agents: number[], open: number[] = [1, 2]): OwnerFacts => ({ open: (id) => open.includes(id), hasAgents: (id) => agents.includes(id) });

describe('one owner per loop', () => {
  it('keeps the owner while it holds the agent tabs, even when another window asks', () => {
    expect(loopOwner(1, 2, windows([1]))).toBe(1);
    expect(loopOwner(1, 2, windows([1, 2]))).toBe(1); // both hold one: no flip-flop
  });

  it('keeps an owner without tabs while the asking window has none either (its tabs may still be starting)', () => {
    expect(loopOwner(1, 2, windows([]))).toBe(1);
  });

  it('moves to the asking window when the owner is gone or no longer holds the agent tabs', () => {
    expect(loopOwner(1, 2, windows([2], [2]))).toBe(2); // window 1 closed
    expect(loopOwner(1, 2, windows([2]))).toBe(2); // window 1 lost the tabs
    expect(loopOwner(null, 2, windows([2]))).toBe(2); // after a restart nobody owns it yet
  });

  it('is nobody when no open window can step it', () => {
    expect(loopOwner(1, 2, windows([], [2]))).toBeNull();
    expect(loopOwner(null, 2, windows([]))).toBeNull();
  });

  it('takes saves only from the owner, or from anyone while nobody owns it', () => {
    expect(takesSave(1, 1)).toBe(true);
    expect(takesSave(1, 2)).toBe(false);
    expect(takesSave(null, 2)).toBe(true);
  });
});

describe('the loops a window steps, from saved loops and open sessions', () => {
  const saved = {
    a: loop(),
    b: loop({ tester: null, fixer: { tabId: null, sessionId: 'sess-f2' } }),
    c: loop({ stoppedAt: 5 }),
    d: loop({ kind: 'draft', fixer: null }),
  };

  it('lists running loops with an agent session open here, whatever tabs runs opened', () => {
    expect(runningHere(saved, new Set(['sess-t'])).map(([id]) => id)).toEqual(['a']); // c stopped, d a draft
    expect(runningHere(saved, new Set(['sess-f2'])).map(([id]) => id)).toEqual(['b']);
    expect(runningHere(saved, new Set(['other']))).toEqual([]);
  });

  it('matches a loop with no testing agent by its bug fix agent', () => {
    expect(hasAgentIn(saved.b, new Set(['sess-f2']))).toBe(true);
    expect(hasAgentIn(saved.b, new Set(['sess-t']))).toBe(false);
  });
});

describe('what a lane says', () => {
  const base: LaneFacts = { role: 'fixer', kind: 'loop', started: true, stopped: false, tab: { busy: true, asking: false }, starting: false, testerLine: null, fixing: null };

  it('reads Needs you when a prompt is on the agent screen, over busy, fixing or a Loop line', () => {
    expect(laneWord({ ...base, tab: { busy: true, asking: true }, fixing: 'coupon below zero' })).toBe(NEEDS_YOU);
    expect(laneWord({ ...base, role: 'tester', tab: { busy: false, asking: true }, testerLine: 'Fixing · round 2/5' })).toBe(NEEDS_YOU);
    expect(laneWord({ ...base, kind: 'draft', role: 'tester', tab: { busy: true, asking: true } })).toBe(NEEDS_YOU);
  });

  it('keeps the old words otherwise', () => {
    expect(laneWord({ ...base, started: false })).toBe('Not started');
    expect(laneWord({ ...base, stopped: true, tab: { busy: false, asking: true } })).toBe('Stopped');
    expect(laneWord({ ...base, tab: null, starting: true })).toBe('Starting in its tab');
    expect(laneWord({ ...base, tab: null })).toBe('Its tab isn’t open here');
    expect(laneWord({ ...base, fixing: 'coupon below zero' })).toBe('Fixing coupon below zero');
    expect(laneWord({ ...base, tab: { busy: false, asking: false } })).toBe('Idle, waiting for bugs');
    expect(laneWord({ ...base, role: 'tester', testerLine: 'Testing · round 1/5' })).toBe('Testing · round 1/5');
    expect(laneWord({ ...base, kind: 'draft', role: 'tester' })).toBe('Drawing up the suite');
  });
});

describe('notification edges', () => {
  it('notices an agent once per new prompt', () => {
    expect(newlyWaiting(new Set(), new Set(['a']))).toEqual(['a']);
    expect(newlyWaiting(new Set(['a']), new Set(['a', 'b']))).toEqual(['b']);
    expect(newlyWaiting(new Set(['a']), new Set())).toEqual([]);
  });

  it('notices a fix once, when its bug reaches Awaiting verify', () => {
    const before = [bug('a', 'fixing'), bug('b', 'verify')];
    const after = [bug('a', 'verify'), bug('b', 'verify'), bug('c', 'open')];
    expect(fixesLanded(before, after).map((b) => b.key)).toEqual(['a']);
    expect(fixNotice(after[0], 'Fixie', 'tab-f')).toEqual({ title: 'Fixie fixed a bug', body: 'a · awaiting verify', tabId: 'tab-f' });
  });

  it('words the needs-you and finished notices', () => {
    expect(needsNotice('Quinn', 'tab-t')).toEqual({ title: 'Quinn needs you', body: 'It is waiting on a prompt in its tab.', tabId: 'tab-t' });
    expect(finishNotice([bug('a', 'verified'), bug('b', 'verified')], null)).toEqual({ title: 'Test loop finished', body: '2 verified · 0 still open', tabId: null });
  });
});

describe('one run per task', () => {
  const going = [{ root: '/r', taskId: 't1' }];

  it('blocks a second run of the same task only', () => {
    expect(runGoing(going, '/r', 't1')).toBe(true);
    expect(runGoing(going, '/r', 't2')).toBe(false);
    expect(runGoing(going, '/other', 't1')).toBe(false);
  });

  it('treats a run with no task as its own', () => {
    expect(runGoing([{ root: '/r', taskId: null }], '/r', null)).toBe(true);
    expect(runGoing([{ root: '/r', taskId: null }], '/r', 't1')).toBe(false);
  });
});

describe('a stage log read from its tail', () => {
  it('reads a small log whole', () => {
    const file = path.join(tempDir(), 'stage.log');
    fs.writeFileSync(file, 'line 1\nline 2\n');
    expect(readLogTail(file, 1024)).toEqual({ text: 'line 1\nline 2\n', trimmed: false });
  });

  it('keeps only the last bytes of a big one, starting at a line, and says so', () => {
    const file = path.join(tempDir(), 'stage.log');
    const lines = Array.from({ length: 2000 }, (_, i) => `output line ${i}`);
    fs.writeFileSync(file, `${lines.join('\n')}\n Tests  1 failed | 3 passed (4)\n`);
    const tail = readLogTail(file, 4096);
    expect(tail.trimmed).toBe(true);
    expect(Buffer.byteLength(tail.text)).toBeLessThanOrEqual(4096);
    expect(tail.text.startsWith('output line ')).toBe(true);
    expect(tail.text.endsWith(' Tests  1 failed | 3 passed (4)\n')).toBe(true);
    expect(trimmedNote()).toBe('Output trimmed to the last 2 MB.');
  });

  it('reads nothing for a missing log', () => {
    expect(readLogTail(path.join(tempDir(), 'none.log'))).toEqual({ text: '', trimmed: false });
  });
});

describe('a bug sent from another window', () => {
  it('takes a name, its test and what she sent', () => {
    const sent = { name: 'rejects an expired token', test: 'src/auth.test.js::rejects an expired token', sent: { stage: 'Unit', failure: 'expected 401' } };
    expect(cleanSentBug(sent)).toEqual(sent);
    expect(cleanSentBug({ ...sent, test: null })).toEqual({ ...sent, test: null });
  });

  it('refuses anything else', () => {
    expect(cleanSentBug(null)).toBeNull();
    expect(cleanSentBug({ name: '', test: null, sent: { stage: 'Unit', failure: 'x' } })).toBeNull();
    expect(cleanSentBug({ name: 'a', test: 3, sent: { stage: 'Unit', failure: 'x' } })).toBeNull();
    expect(cleanSentBug({ name: 'a', test: null, sent: { stage: 'Unit', failure: 'x'.repeat(10_000) } })).toBeNull();
  });
});

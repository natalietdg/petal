// What a lane says from its agent's state, the notification edges, one run per task, a stage log read from its tail,
// and a bug she sent from a failed run.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { removeTempDirs, tempDir } from './helpers';
import { ENDED_WORD, finishNotice, fixesLanded, fixNotice, laneWord, NEEDS_YOU, SCENARIOS_READY, needsNotice, newlyWaiting, type LaneFacts } from '../src/shared/loop-signals';
import { cleanSentBug } from '../src/shared/agent-loop';
import { runGoing } from '../src/shared/testing';
import { readLogTail, trimmedNote } from '../src/main/testing-runner';
import type { QueuedBug } from '../src/shared/bug-queue';

afterEach(removeTempDirs);

const bug = (key: string, state: QueuedBug['state']): QueuedBug => ({ key, name: key, test: null, state, since: 1, asked: false, testerRound: 1, rechecked: false });

describe('what a lane says', () => {
  const base: LaneFacts = { role: 'fixer', kind: 'loop', state: 'working', stopped: false, testerLine: null, fixing: null };

  it('reads Scenarios ready for an idle draft whose scenarios wait on her, below busy and Needs you', () => {
    const draft: LaneFacts = { ...base, role: 'tester', kind: 'draft', state: 'idle', scenariosReady: true, draftEnded: false };
    expect(laneWord(draft)).toBe(SCENARIOS_READY);
    expect(laneWord({ ...draft, state: 'working' })).toBe('Drawing up the suite');
    expect(laneWord({ ...draft, state: 'asking' })).toBe(NEEDS_YOU);
    expect(laneWord({ ...draft, scenariosReady: false, draftEnded: true })).toBe('Stopped without a suite');
    expect(laneWord({ ...draft, state: 'ended', scenariosReady: false, draftEnded: true })).toBe('Stopped without a suite');
    expect(laneWord({ ...draft, state: 'ended', scenariosReady: false })).toBe(ENDED_WORD);
  });

  it('reads Scenarios ready on a loop’s testing agent over its Loop line while they wait on her', () => {
    const tester: LaneFacts = { ...base, role: 'tester', state: 'idle', testerLine: 'Writing scenarios · round 1/5', scenariosReady: true };
    expect(laneWord(tester)).toBe(SCENARIOS_READY);
    expect(laneWord({ ...tester, scenariosReady: false })).toBe('Writing scenarios · round 1/5');
  });

  it('reads Needs you when a prompt is on the agent screen, over busy, fixing or a Loop line', () => {
    expect(laneWord({ ...base, state: 'asking', fixing: 'coupon below zero' })).toBe(NEEDS_YOU);
    expect(laneWord({ ...base, role: 'tester', state: 'asking', testerLine: 'Fixing · round 2/5' })).toBe(NEEDS_YOU);
    expect(laneWord({ ...base, kind: 'draft', role: 'tester', state: 'asking' })).toBe(NEEDS_YOU);
  });

  it('reads its state, never whether a tab is open here', () => {
    expect(laneWord({ ...base, state: null })).toBe('Not started');
    expect(laneWord({ ...base, stopped: true, state: 'asking' })).toBe('Stopped');
    expect(laneWord({ ...base, stopped: true, state: 'closed' })).toBe('Closed');
    expect(laneWord({ ...base, state: 'starting' })).toBe('Starting');
    expect(laneWord({ ...base, state: 'ended', fixing: 'coupon below zero' })).toBe(ENDED_WORD);
    expect(laneWord({ ...base, fixing: 'coupon below zero' })).toBe('Fixing coupon below zero');
    expect(laneWord({ ...base, state: 'idle' })).toBe('Idle, waiting for bugs');
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
    expect(needsNotice('Quinn', 'tab-t')).toEqual({ title: 'Quinn needs you', body: 'It is waiting on a prompt in its terminal.', tabId: 'tab-t' });
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

describe('a bug she sent from a failed run', () => {
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

// Task per session, the token split and calibration, and what Testing prunes: pure rules.
import { describe, expect, it } from 'vitest';
import { needsOwnTask } from '../src/shared/task-testing';
import { AUTO_TASK_DAYS, prunePlan, type PruneFacts } from '../src/shared/testing-prune';
import { finishedRounds, roundTokens } from '../src/shared/agent-loop';
import { actionsFrom, type AgentAction } from '../src/shared/agent-actions';
import { BASE_CONTEXT_TOKENS, CALIBRATE_ROUNDS, agentEstimateText, agentTokens, roundEstimate, usageText } from '../src/shared/token-usage';
import type { Task } from '../src/shared/tasks';

const DAY = 86_400_000;
const NOW = 100 * DAY;
const task = (id: string, over: Partial<Task> = {}): Task => ({
  id, title: id, notes: '', status: 'working', owner: { sessionId: `s-${id}`, name: id, branch: 'main' }, createdAt: NOW - 40 * DAY, claimedAt: NOW - 40 * DAY, doneAt: null, doneBy: null, prdId: null, parentId: null, ...over,
}) as Task;

describe('a task per Claude session', () => {
  const tasks = [task('t-a', { owner: { sessionId: 's-1', name: 'one', branch: 'main' } })];

  it('a second session in a repo that already has tasks gets its own', () => {
    expect(needsOwnTask({ tasks, sessionId: 's-2', isAgent: false })).toBe(true);
    expect(needsOwnTask({ tasks: [], sessionId: 's-2', isAgent: false })).toBe(true);
  });

  it('a session that owns a task, even a finished one, gets none', () => {
    expect(needsOwnTask({ tasks, sessionId: 's-1', isAgent: false })).toBe(false);
    expect(needsOwnTask({ tasks: [task('t-b', { status: 'done', owner: { sessionId: 's-3', name: 'x', branch: 'main' } })], sessionId: 's-3', isAgent: false })).toBe(false);
  });

  it('never for an agent session or a tab without Claude', () => {
    expect(needsOwnTask({ tasks, sessionId: 's-2', isAgent: true })).toBe(false);
    expect(needsOwnTask({ tasks, sessionId: null, isAgent: false })).toBe(false);
  });
});

const action = (at: number, round: number | null, tokens: number, cached = 0): AgentAction => ({ id: `a${at}`, at, kind: 'bash', text: 'Ran npm test', path: null, detail: '', tokens, cached, round });

describe('actual tokens, with cache reads named apart', () => {
  it('reads each message’s cache reads beside its total, once per message', () => {
    const usage = { id: 'm1', usage: { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 30, cache_read_input_tokens: 940 } };
    const actions = actionsFrom([
      { type: 'assistant', timestamp: '2026-01-01T00:00:00Z', message: { ...usage, content: [{ type: 'tool_use', id: 'u1', name: 'Bash', input: { command: 'npm test' } }, { type: 'tool_use', id: 'u2', name: 'Bash', input: { command: 'ls' } }] } },
      { type: 'user', timestamp: '2026-01-01T00:00:01Z', message: { content: [{ type: 'tool_result', tool_use_id: 'u1', content: 'ok' }, { type: 'tool_result', tool_use_id: 'u2', content: 'ok' }] } },
    ]);
    expect(actions.map((a) => [a.tokens, a.cached])).toEqual([[1000, 940], [0, 0]]);
  });

  it('a round’s tokens carry their cache reads', () => {
    expect(roundTokens([action(600, 1, 1000, 800), action(900, 2, 10)], [action(700, null, 200, 150)], 500)).toEqual({ round: 1, done: true, tokens: 1200, cached: 950 });
  });

  it('says how many were cached reads, or just the count when none were', () => {
    expect(usageText(12_345, 10_100)).toBe('12k tokens (10k of them cached reads)');
    expect(usageText(950, 0)).toBe('950 tokens');
  });
});

describe('the per-round estimate', () => {
  const tester = [action(600, 1, 1000), action(1000, 2, 3000), action(1400, 3, 50)];
  const fixer = [action(1100, null, 500)];

  it('each finished round, for both agents; the last counts once the loop is over', () => {
    expect(finishedRounds(tester, fixer, 500, false)).toEqual([1000, 3500]);
    expect(finishedRounds(tester, fixer, 500, true)).toEqual([1000, 3500, 50]);
    expect(finishedRounds([action(600, null, 70)], [], 500, true)).toEqual([]);
  });

  it('averages this task’s newest finished rounds, else keeps the rough figure', () => {
    expect(roundEstimate([1000, 3500], 99_000)).toEqual({ tokens: 2250, rounds: 2 });
    expect(roundEstimate([], 99_000)).toEqual({ tokens: 99_000, rounds: 0 });
    expect(roundEstimate([0, 0], 99_000)).toEqual({ tokens: 99_000, rounds: 0 }); // rounds with no reported tokens don't count
    const many = Array.from({ length: CALIBRATE_ROUNDS + 3 }, (_, i) => (i < 3 ? 1 : 100));
    expect(roundEstimate(many, 5)).toEqual({ tokens: 100, rounds: CALIBRATE_ROUNDS });
  });

  it('one agent on a brief: its context read again on each typical turn', () => {
    expect(agentTokens(4000, 10)).toBe((BASE_CONTEXT_TOKENS + 1000) * 10);
    expect(agentEstimateText(160_000)).toBe('About 160k tokens. A rough estimate from the brief and typical turns.');
  });
});

describe('what Testing prunes', () => {
  const base = (over: Partial<PruneFacts> = {}): PruneFacts => ({
    tasks: [task('t-auto'), task('t-mine')], autoTasks: ['t-auto'], recordTasks: [], runTasks: new Set(), liveTasks: new Set(), openSessions: new Set(), now: NOW, ...over,
  });

  it('an auto task whose session closed, older than 30 days, with no runs', () => {
    expect(prunePlan(base())).toEqual({ tasks: ['t-auto'], records: [], autoTasks: [] });
  });

  it('keeps it while its session is open, it is young, it has runs or subtasks; never one she made', () => {
    expect(prunePlan(base({ openSessions: new Set(['s-t-auto']) })).tasks).toEqual([]);
    expect(prunePlan(base({ tasks: [task('t-auto', { createdAt: NOW - (AUTO_TASK_DAYS - 1) * DAY })] })).tasks).toEqual([]);
    expect(prunePlan(base({ runTasks: new Set(['t-auto']) })).tasks).toEqual([]);
    expect(prunePlan(base({ liveTasks: new Set(['t-auto']) })).tasks).toEqual([]); // its drafting agent is still open
    expect(prunePlan(base({ tasks: [task('t-auto'), task('t-sub', { parentId: 't-auto' })] })).tasks).toEqual([]);
    expect(prunePlan(base({ autoTasks: [] })).tasks).toEqual([]);
  });

  it('agent records and saved loops of tasks that no longer exist, and of a pruned task', () => {
    const plan = prunePlan(base({ recordTasks: ['t-gone', 't-mine', 't-auto', 't-gone'], autoTasks: ['t-auto', 't-deleted'] }));
    expect(plan.records.sort()).toEqual(['t-auto', 't-gone']);
    expect(plan.autoTasks).toEqual([]); // a deleted auto task leaves the list too
  });
});

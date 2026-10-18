// The test loop as two agents at once: the bug queue between them, the mid-edit recheck, stop rules, Stop halting both,
// the two briefs, token counts and the action log read from a transcript.
import { describe, expect, it } from 'vitest';
import { activeBugs, bugKey, fixLines, queueCounts, queueDone, stepQueue, type QueueFacts, type QueuedBug } from '../src/shared/bug-queue';
import { buildFixerBrief, buildLoopBrief, parseCriteria, stopAll, STOP_MESSAGE } from '../src/shared/test-loop';
import { estimateRoundTokens, sumUsage, tokenText, totalTokens, CHARS_PER_TOKEN, TURNS_PER_ROUND, BASE_CONTEXT_TOKENS } from '../src/shared/token-usage';
import { actionsFrom, roundSummaries } from '../src/shared/agent-actions';
import { agentTabTitle } from '../src/shared/agent-names';
import { ASKING_NOTE, chatTurns, routeMessage } from '../src/shared/agent-chat';

const words = { tester: 'Quinn', fixer: 'Fixie', failure: () => 'Failure output:\nexpected 10 to be 9' };
const bugs = (text: string) => parseCriteria(`## Bugs\n${text}`).bugs;
const facts = (over: Partial<QueueFacts> = {}): QueueFacts => ({ bugs: [], testerRound: 1, fixerBusy: false, fixesDone: [], now: 100, ...over });

describe('the bug queue', () => {
  it('a new bug opens and goes to the idle fixer with its test and failure', () => {
    const step = stepQueue([], facts({ bugs: bugs('- [fail] total off by a cent · test: src/cart.test.ts::rounds · round 1 · task: t') }), words);
    expect(step.queue).toMatchObject([{ key: 'total off by a cent', state: 'fixing', test: 'src/cart.test.ts::rounds', asked: true }]);
    expect(step.send).toEqual([{ to: 'fixer', key: 'total off by a cent', text: 'Bug: total off by a cent.\nFailing test: src/cart.test.ts::rounds.\nFailure output:\nexpected 10 to be 9\nFix the app code, run that test to confirm, then end with **Fix:** total off by a cent · done' }]);
    expect(step.moves.map((m) => [m.from, m.to])).toEqual([[null, 'open'], ['open', 'fixing']]);
  });

  it('the fixer takes one bug at a time, oldest first; the tester keeps filing meanwhile', () => {
    let queue: QueuedBug[] = stepQueue([], facts({ bugs: bugs('- [fail] first · round 1') }), words).queue;
    const second = stepQueue(queue, facts({ bugs: bugs('- [fail] first · round 1\n- [fail] second · round 1'), fixerBusy: false, now: 200 }), words);
    expect(second.send).toEqual([]); // first is still fixing
    queue = second.queue;
    expect(queueCounts(queue)).toMatchObject({ fixing: 1, open: 1 });
    const done = stepQueue(queue, facts({ bugs: bugs('- [fail] first · round 1\n- [fail] second · round 1'), fixesDone: [{ name: 'first', at: 300 }], now: 300 }), words);
    expect(done.queue.find((b) => b.key === 'first')?.state).toBe('verify');
    expect(done.queue.find((b) => b.key === 'second')?.state).toBe('fixing');
    expect(done.send.map((m) => [m.to, m.key])).toEqual([['tester', 'first'], ['fixer', 'second']]);
    expect(done.send[0]?.text).toMatch(/^Verify "first": Fixie says it is fixed\./);
  });

  it('verified when the tester marks it fixed; still failing on its next round goes back to open', () => {
    const verifying: QueuedBug[] = [{ key: 'a', name: 'a', test: null, state: 'verify', since: 1, asked: true, testerRound: 2, rechecked: false }];
    expect(stepQueue(verifying, facts({ bugs: bugs('- [fixed] a · round 2'), testerRound: 2 }), words).queue[0]?.state).toBe('verified');
    expect(stepQueue(verifying, facts({ bugs: bugs('- [fail] a · round 2'), testerRound: 2, fixerBusy: true }), words).queue[0]?.state).toBe('verify');
    const back = stepQueue(verifying, facts({ bugs: bugs('- [fail] a · round 3'), testerRound: 3, fixerBusy: true }), words);
    expect(back.queue[0]?.state).toBe('open');
  });

  it('a failure seen while the fixer is busy is rechecked once it goes idle, before it counts', () => {
    const busy = stepQueue([], facts({ bugs: bugs('- [fail] flaky total · round 1'), fixerBusy: true }), words);
    expect(busy.queue[0]).toMatchObject({ state: 'recheck', asked: false });
    expect(busy.send).toEqual([]);
    const idle = stepQueue(busy.queue, facts({ bugs: bugs('- [fail] flaky total · round 1'), fixerBusy: false }), words);
    expect(idle.send).toEqual([expect.objectContaining({ to: 'tester', key: 'flaky total' })]);
    expect(idle.send[0]?.text).toMatch(/Fixie was mid-edit when it failed/);
    // It passed: the tester removed the line, so the bug is gone.
    expect(stepQueue(idle.queue, facts({ bugs: [] }), words).queue).toEqual([]);
    // It still failed: the tester notes "rechecked" and it opens for the fixer, noted as rechecked.
    const still = stepQueue(idle.queue, facts({ bugs: bugs('- [fail] flaky total, rechecked · round 1') }), words);
    expect(still.queue[0]).toMatchObject({ state: 'fixing', rechecked: true });
    expect(still.send[0]?.text).toMatch(/^Bug: flaky total \(rechecked\)\./);
    expect(bugKey('Flaky total (rechecked)')).toBe('flaky total');
  });

  it('done only when the queue is empty and the tester’s latest round found nothing new', () => {
    const verified: QueuedBug[] = [{ key: 'a', name: 'a', test: null, state: 'verified', since: 1, asked: false, testerRound: 1, rechecked: false }];
    expect(queueDone(verified, 'done')).toBe(true);
    expect(queueDone([], 'testing')).toBe(false);
    expect(queueDone([{ ...verified[0] as QueuedBug, state: 'verify' }], 'done')).toBe(false);
    expect(activeBugs([{ ...verified[0] as QueuedBug, state: 'recheck' }])).toHaveLength(1);
  });

  it('reads the fixer’s Fix lines since the loop started', () => {
    const replies = [{ markdown: 'Fixed.\n**Fix:** total off by a cent · done', timestamp: new Date(500).toISOString() }, { markdown: '**Fix:** old one · done', timestamp: new Date(50).toISOString() }, { markdown: 'Fix: coupon · blocked: needs a product rule', timestamp: new Date(600).toISOString() }];
    expect(fixLines(replies, 100)).toEqual([{ name: 'total off by a cent', at: 500, outcome: 'done' }, { name: 'coupon', at: 600, outcome: 'blocked' }]);
  });
});

describe('Stop halts both agents', () => {
  it('each gets Esc, then the stop message', async () => {
    const sent: string[] = [];
    const agent = (name: string) => ({ sendEsc: () => sent.push(`${name}:esc`), isIdle: () => true, send: async (text: string) => { sent.push(`${name}:${text}`); return true; }, sleep: async () => {} });
    expect(await stopAll([agent('tester'), agent('fixer')])).toEqual(['idle', 'idle']);
    expect(sent.sort()).toEqual(['fixer:esc', `fixer:${STOP_MESSAGE}`, 'tester:esc', `tester:${STOP_MESSAGE}`].sort());
  });
});

describe('the two briefs', () => {
  const stages = [{ id: 'unit', name: 'Unit', command: 'npm test' }];
  const names = { tester: 'Quinn', fixer: 'Fixie' };

  it('the testing agent files bugs and never edits app code; it owns the suite', () => {
    const brief = buildLoopBrief({ focus: 'cart', rounds: 3, stages, stack: [], taskId: 't-1', agent: true, names });
    expect(brief).toContain('You are Quinn, this task\'s testing agent.');
    expect(brief).toContain('while Fixie fixes the bugs you find in its own session');
    expect(brief).toContain('Never edit app code: Petal hands each bug to Fixie');
    expect(brief).toContain('The suite lives in .petal/suites/t-1.json. You own it and the tests');
    expect(brief).toContain('or file the bug for Fixie');
    expect(brief).toContain('Never weaken, skip or delete a test');
    expect(brief).not.toMatch(/[—–]/);
  });

  it('the bug fix agent fixes app code only and ends each bug with a Fix line', () => {
    const brief = buildFixerBrief({ taskId: 't-1', taskTitle: 'Fix the cart total.', stages, names });
    expect(brief).toContain('You are Fixie, the bug fix agent for the task "Fix the cart total" (t-1).');
    expect(brief).toContain('Never edit tests, test data, snapshot baselines or .petal/suites/t-1.json: they belong to Quinn.');
    expect(brief).toContain('**Fix:** the bug name · done');
    expect(brief).toContain('Never commit');
    expect(brief).not.toMatch(/[—–]/);
  });

  it('tab titles use her names; the default names otherwise', () => {
    expect(agentTabTitle({ tester: 'Quinn' }, 'tester', 'Fix the cart total')).toBe('Quinn · Fix the cart total');
    expect(agentTabTitle({}, 'fixer', 'Fix the cart total')).toBe('Bug fix agent · Fix the cart total');
  });
});

describe('tokens', () => {
  it('sums message.usage once per message id', () => {
    const usage = { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000 };
    const entries = [
      { type: 'assistant', message: { id: 'm1', usage } },
      { type: 'assistant', message: { id: 'm1', usage } }, // a second content block of the same message
      { type: 'assistant', message: { id: 'm2', usage: { input_tokens: 1, output_tokens: 2 } } },
      { type: 'user', message: { content: 'hi' } },
    ];
    expect(sumUsage(entries)).toEqual({ input: 11, output: 7, cacheWrite: 100, cacheRead: 1000 });
    expect(totalTokens(sumUsage(entries))).toBe(1118);
  });

  it('estimates a round from the briefs and the last output, locally', () => {
    const perAgent = (chars: number) => (BASE_CONTEXT_TOKENS + chars / CHARS_PER_TOKEN) * TURNS_PER_ROUND;
    expect(estimateRoundTokens({ briefChars: [4000, 2000], suiteOutputChars: 800 })).toBe(perAgent(4000) + perAgent(2000) + 400);
    expect(tokenText(950)).toBe('950');
    expect(tokenText(12_345)).toBe('12k');
    expect(tokenText(1234)).toBe('1.2k');
    expect(tokenText(2_500_000)).toBe('2.5M');
  });
});

describe('the action log', () => {
  const at = (s: number) => new Date(1_000_000 + s * 1000).toISOString();
  const use = (id: string, name: string, input: object, s: number, msg = id, usage?: object) => ({ type: 'assistant', timestamp: at(s), message: { id: msg, usage, content: [{ type: 'tool_use', id, name, input }] } });
  const result = (id: string, content: string, s: number, isError = false) => ({ type: 'user', timestamp: at(s), message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] } });
  const root = '/r/shop';
  const entries = [
    { type: 'assistant', timestamp: at(0), message: { id: 'm0', content: [{ type: 'text', text: 'Starting.\n**Loop:** round 1/3 · scenarios · 0 open' }] } },
    use('e1', 'Edit', { file_path: `${root}/src/cart.ts`, old_string: 'a', new_string: 'a\nb\nc\nd' }, 1, 'm1', { input_tokens: 100, output_tokens: 20 }),
    result('e1', 'ok', 2),
    use('w1', 'Write', { file_path: `${root}/src/cart.test.ts`, content: 'x\ny' }, 3),
    result('w1', 'ok', 4),
    use('r1', 'Read', { file_path: `${root}/a.ts` }, 5), result('r1', '...', 5),
    use('r2', 'Read', { file_path: `${root}/b.ts` }, 6), result('r2', '...', 6),
    use('r3', 'Read', { file_path: `${root}/c.ts` }, 7), result('r3', '...', 7),
    use('b1', 'Bash', { command: 'npm test' }, 8), result('b1', 'Exit code 1\n1 failed', 9, true),
    use('d1', 'Edit', { file_path: `${root}/src/cart.test.ts`, old_string: 'x', new_string: 'y' }, 10), result('d1', 'PreToolUse:Edit hook error: Tests belong to Quinn. Ask it to change them.', 10, true),
    use('p1', 'Bash', { command: 'sleep 1' }, 11), // no result yet
  ];

  it('maps each tool call to a line, oldest first, with tokens on the first step of a message', () => {
    const actions = actionsFrom(entries, root);
    expect(actions.map((a) => [a.kind, a.text, a.round])).toEqual([
      ['edit', 'Edited src/cart.ts (+4 −1)', 1],
      ['write', 'Wrote test src/cart.test.ts (2 lines)', 1],
      ['read', 'Read 3 files', 1],
      ['bash', 'Ran npm test · exit 1', 1],
      ['refused', 'Refused: tried to edit src/cart.test.ts', 1],
    ]);
    expect(actions[0]?.tokens).toBe(120);
    expect(actions[0]?.detail).toBe('- a\n+ a\n+ b\n+ c\n+ d');
    expect(actions[3]?.detail).toBe('Exit code 1\n1 failed');
    expect(actions[2]?.detail).toBe('a.ts\nb.ts\nc.ts');
  });

  it('sums each round in one line', () => {
    expect(roundSummaries(actionsFrom(entries, root)).map((r) => r.text)).toEqual(['Round 1 · 2 edits · 1 command · 1 refusal']);
  });
});

describe('chatting with an agent', () => {
  const agents = { tester: { sessionId: 'tester-1' }, fixer: { sessionId: 'fixer-1' } };
  it('a message goes to that role’s own session', () => {
    expect(routeMessage('tester', agents, () => false, 'add a test for coupons')).toEqual({ sessionId: 'tester-1' });
    expect(routeMessage('fixer', agents, () => false, 'look at totals.ts')).toEqual({ sessionId: 'fixer-1' });
  });
  it('refused while that agent is asking something, before the loop starts, or when empty', () => {
    expect(routeMessage('fixer', agents, (id) => id === 'fixer-1', 'hi')).toEqual({ note: ASKING_NOTE });
    expect(routeMessage('tester', agents, (id) => id === 'fixer-1', 'hi')).toEqual({ sessionId: 'tester-1' });
    expect(routeMessage('tester', null, () => false, 'hi')).toEqual({ note: 'Start the loop first. Each agent gets its own tab.' });
    expect(routeMessage('tester', agents, () => false, '  ')).toEqual({ note: 'Type a message first.' });
  });
  it('shows the last few turns, oldest first, since the loop started', () => {
    const reply = (id: string, s: number) => ({ id, timestamp: new Date(s * 1000).toISOString(), markdown: `reply ${id}`, prompt: `ask ${id}` });
    const turns = chatTurns([reply('e', 50), reply('d', 40), reply('c', 30), reply('b', 20), reply('a', 5)], 10_000, 3);
    expect(turns.map((t) => t.id)).toEqual(['c', 'd', 'e']);
    expect(chatTurns([reply('a', 5)], 10_000)).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { latestLoop, loopBarHtml, loopCaption, parseLoop, parseLoopLine } from '../src/shared/loop-line';
import {
  STOP_MESSAGE, buildLoopBrief, clampRounds, cleanFocus, loopStatus, loopTarget, openBugs, parseCriteria, stopLoop, ESC_SETTLE_MS, IDLE_GIVE_UP_MS,
} from '../src/shared/test-loop';
import type { StackItem, StageConfig } from '../src/shared/testing';

describe('parseLoopLine', () => {
  it('reads round, total, phase and open count', () => {
    expect(parseLoopLine('**Loop:** round 2/5 · fixing · 3 open')).toEqual({ round: 2, total: 5, phase: 'fixing', open: 3 });
    expect(parseLoopLine('Loop: round 1/5 • scenarios • 0 open.')).toEqual({ round: 1, total: 5, phase: 'scenarios', open: 0 });
    expect(parseLoopLine('  __Loop__: Round 5 / 5 · DONE ')).toEqual({ round: 5, total: 5, phase: 'done', open: null });
  });
  it('accepts every phase', () => {
    for (const phase of ['scenarios', 'testing', 'fixing', 'verifying', 'done', 'stopped']) expect(parseLoopLine(`**Loop:** round 1/3 · ${phase} · 1 open`)?.phase).toBe(phase);
  });
  it('rejects malformed lines', () => {
    for (const bad of ['**Loop:** round 6/5 · fixing · 1 open', '**Loop:** round 0/5 · fixing', '**Loop:** round 2/5 · resting · 1 open', '**Loop:** 2/5 fixing', 'The loop: round 2/5 · fixing', '**Loop:** round 2/5 · fixing · lots open']) {
      expect(parseLoopLine(bad)).toBeNull();
    }
  });
  it('takes the last line of a reply, never one in a fence', () => {
    const reply = 'Round one.\n**Loop:** round 1/5 · testing · 0 open\n\nMore.\n**Loop:** round 1/5 · fixing · 2 open\n```\n**Loop:** round 4/5 · done\n```';
    expect(parseLoop(reply)).toEqual({ round: 1, total: 5, phase: 'fixing', open: 2 });
  });
  it('finds the newest reply with a line, ignoring replies before the loop started', () => {
    const t = (s: number) => new Date(1_000_000 + s * 1000).toISOString();
    const replies = [
      { markdown: 'no line', timestamp: t(30) },
      { markdown: '**Loop:** round 2/5 · fixing · 3 open', timestamp: t(20) },
      { markdown: '**Loop:** round 5/5 · done · 0 open', timestamp: t(1) },
    ];
    expect(latestLoop(replies)?.round).toBe(2);
    expect(latestLoop(replies.slice(2))?.phase).toBe('done');
    expect(latestLoop(replies.slice(2), 1_000_000 + 10_000)).toBeNull();
  });
  it('draws one segment per round with an accessible caption', () => {
    const html = loopBarHtml({ round: 2, total: 5, phase: 'fixing', open: 3 });
    expect(html.match(/station-seg /g)).toHaveLength(5);
    expect(html.match(/station-seg done/g)).toHaveLength(1);
    expect(html).toContain('current pending');
    expect(html).toContain('aria-valuetext="Round 2 of 5, fixing, 3 open"');
    expect(loopCaption({ round: 5, total: 5, phase: 'done', open: 0 })).toBe('Done · round 5/5 · 0 open');
    expect(loopBarHtml({ round: 5, total: 5, phase: 'done', open: 0 })).toContain('current met');
  });
});

describe('parseCriteria', () => {
  const file = [
    '# Test criteria',
    '## Scenarios',
    '- [pass] guest checkout with a saved card · test: src/checkout.test.ts::guest checkout · round 1',
    '- [fail] coupon over the total · test: src/coupon.test.ts::caps at the total · round 2',
    '- [flaky] slow network retry · test: e2e/retry.spec.ts · round 1',
    '- [x] a plain checkbox',
    '- [pass] · test: missing name',
    'Some prose that is not an item.',
    '## Bugs',
    '- [fixed] tax rounds per order, not per line · test: src/cart/totals.test.ts::rounds tax per line · round 1',
    '- [fail] empty cart crashes the button · round 2',
    '- [fail] bad part · weird: thing',
    '## Notes',
    '- [pass] outside a section is ignored',
  ].join('\n');
  const parsed = parseCriteria(file);

  it('groups items and reads every status', () => {
    expect(parsed.scenarios.map((s) => s.status)).toEqual(['pass', 'fail', 'flaky']);
    expect(parsed.bugs.map((b) => b.status)).toEqual(['fixed', 'fail']);
    expect(parsed.scenarios[0]).toEqual({ status: 'pass', name: 'guest checkout with a saved card', test: { path: 'src/checkout.test.ts', name: 'guest checkout' }, tests: [{ path: 'src/checkout.test.ts', name: 'guest checkout' }], source: null, round: 1, regression: false, taskId: null, ticket: null, level: null, details: {} });
    expect(parsed.scenarios[2].test).toEqual({ path: 'e2e/retry.spec.ts', name: null });
  });
  it('marks bugs with a test as regressions', () => {
    expect(parsed.bugs[0].regression).toBe(true);
    expect(parsed.bugs[1]).toMatchObject({ regression: false, test: null, round: 2 });
    expect(openBugs(parsed)).toBe(1);
  });
  it('counts malformed list lines inside sections only', () => {
    expect(parsed.malformed).toBe(3);
    expect(parseCriteria('').scenarios).toEqual([]);
    expect(parseCriteria('## Bugs\r\n- [FIXED] Windows line ends · round 3\r\n').bugs[0]).toMatchObject({ status: 'fixed', round: 3 });
  });
});

describe('buildLoopBrief', () => {
  const stages: StageConfig[] = [
    { id: 'typecheck', name: 'Typecheck', command: 'npm run typecheck' },
    { id: 'unit', name: 'Unit', command: 'npm test' },
    { id: 'mobile', name: 'Mobile flows', command: 'maestro test .maestro' },
  ];
  const stack: StackItem[] = [
    { id: 'vitest', label: 'Vitest', kind: 'unit', foundIn: 'package.json' },
    { id: 'maestro', label: 'Maestro', kind: 'mobile', foundIn: '.maestro/login.yaml' },
    { id: 'ci', label: 'CI', kind: 'ci', foundIn: '.github/workflows/ci.yml' },
    { id: 'skill', label: 'prove-it', kind: 'skill', foundIn: 'user skills', insert: '/prove-it' },
  ];
  const brief = buildLoopBrief({ focus: 'checkout flow', rounds: 5, stages, stack });

  it('carries the exact stage commands in order, the focus and the rounds', () => {
    expect(brief).toContain('1. Typecheck: `npm run typecheck`\n2. Unit: `npm test`\n3. Mobile flows: `maestro test .maestro`');
    expect(brief).toContain('Focus: checkout flow.');
    expect(brief).toContain('up to 5 rounds');
    expect(brief).toContain('**Loop:** round 1/5 · scenarios · 0 open');
    expect(brief).toContain('Stack: Vitest (package.json), Maestro (.maestro/login.yaml).');
    expect(brief).toContain('plus Maestro flows');
    expect(brief).toContain('Criteria file: .petal/criteria.md');
  });
  it('carries the rules: no commits, no weakening, flaky re-run, her messages first', () => {
    expect(brief).toContain('Never commit, push, or change git history.');
    expect(brief).toContain('Never weaken, skip or delete a test to get green.');
    expect(brief).toContain('Never edit snapshot baselines without saying why.');
    expect(brief).toContain('run that test once more');
    expect(brief).toContain('Messages I send during the loop come first');
    expect(brief).toContain('fails first');
  });
  it('has no em dashes, even from her focus, and caps rounds', () => {
    expect(brief).not.toMatch(/\u2014/);
    expect(buildLoopBrief({ focus: 'login \u2014 and\nsignup', rounds: 99, stages, stack: [] })).toMatch(/up to 10 rounds[\s\S]*Focus: login and signup\./);
    expect(buildLoopBrief({ focus: '', rounds: 1, stages, stack: [] })).toContain('Focus: the whole project');
    expect(buildLoopBrief({ focus: '', rounds: 1, stages, stack: [] })).not.toContain('Maestro flows next');
    expect(clampRounds('x')).toBe(5);
    expect(clampRounds(0)).toBe(1);
    expect(cleanFocus('a\u0007b')).toBe('a b');
  });
});

describe('loopTarget', () => {
  it('pastes into the live session tab, else opens a new tab', () => {
    expect(loopTarget('t1', () => true)).toEqual({ kind: 'paste', tabId: 't1' });
    expect(loopTarget('t1', () => false)).toEqual({ kind: 'new-tab' });
    expect(loopTarget(null, () => true)).toEqual({ kind: 'new-tab' });
  });
});

describe('loopStatus', () => {
  const base = { progress: null, live: true, startedAt: null, stoppedAt: null, now: 10_000_000 };
  it('is active while a non-final line has a live claude, or just after Start', () => {
    expect(loopStatus({ ...base, progress: { round: 2, total: 5, phase: 'fixing', open: 3 } })).toBe('running');
    expect(loopStatus({ ...base, startedAt: base.now - 1000 })).toBe('starting');
    expect(loopStatus({ ...base, live: false, startedAt: base.now - 1000 })).toBe('starting');
    expect(loopStatus({ ...base, live: false, startedAt: base.now - 10 * 60_000 })).toBe('idle');
  });
  it('ends on done or stopped, a stop sent, or claude gone', () => {
    expect(loopStatus({ ...base, progress: { round: 3, total: 5, phase: 'done', open: 0 } })).toBe('done');
    expect(loopStatus({ ...base, progress: { round: 3, total: 5, phase: 'stopped', open: 1 } })).toBe('stopped');
    expect(loopStatus({ ...base, progress: { round: 2, total: 5, phase: 'fixing', open: 1 }, stoppedAt: base.now })).toBe('stopped');
    expect(loopStatus({ ...base, progress: { round: 2, total: 5, phase: 'fixing', open: 1 }, live: false })).toBe('stopped');
    expect(loopStatus(base)).toBe('idle');
  });
});

describe('stopLoop', () => {
  it('sends one Esc, waits for idle, then the stop message', async () => {
    const events: string[] = [];
    let clock = 0;
    const result = await stopLoop({
      sendEsc: () => events.push('esc'),
      isIdle: () => clock >= ESC_SETTLE_MS + 2000,
      send: async (text) => { events.push(`send@${clock}:${text}`); },
      sleep: async (ms) => { clock += ms; },
    });
    expect(result).toBe('idle');
    expect(events[0]).toBe('esc');
    expect(events).toHaveLength(2);
    expect(events[1]).toBe(`send@${clock}:${STOP_MESSAGE}`);
    expect(clock).toBeGreaterThanOrEqual(ESC_SETTLE_MS + 2000);
  });
  it('sends anyway after the give-up time, since Claude Code queues it', async () => {
    let clock = 0;
    const sent: string[] = [];
    const result = await stopLoop({ sendEsc: () => {}, isIdle: () => false, send: async (t) => { sent.push(t); }, sleep: async (ms) => { clock += ms; } });
    expect(result).toBe('timeout');
    expect(sent).toEqual([STOP_MESSAGE]);
    expect(clock).toBeGreaterThanOrEqual(IDLE_GIVE_UP_MS);
  });
  it('the stop message is the one she asked for, with no em dash', () => {
    expect(STOP_MESSAGE).toBe('Stop the test loop now. Leave the code as it is and summarise: round reached, bugs fixed, bugs still open, files changed.');
  });
});

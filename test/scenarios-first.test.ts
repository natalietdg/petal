// Scenarios first: the [todo] scenario line, where scenarios come from in the testing agent's briefs, when Petal shows
// them for her review, and the go-ahead it sends. Plus the bundled skill's own example lines.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildLoopBrief, CRITERIA_SKELETON, parseCriteria, reviewBrief, scenarioSources, SOURCE_CAP } from '../src/shared/test-loop';
import { awaitingReview, draftBrief, draftEnded, draftRequest, scenariosApprovedText, TESTING_SKILL, type ReviewFacts } from '../src/shared/suite-draft';

const BUNDLED = fs.readFileSync(path.join(__dirname, '..', 'resources', 'skills', TESTING_SKILL, 'SKILL.md'), 'utf8');

describe('the scenario line', () => {
  const file = [
    '## Scenarios',
    '- [todo] a refund over the amount paid is refused · from: prd · task: t-1',
    '- [ ] an empty reason is asked for again · from: notes · task: t-1',
    '- [todo] a second refund on the same order waits for the first · task: t-1',
    '- [pass] a full refund closes the order · test: src/refund.test.ts::closes · test: e2e/refund.spec.ts::shows closed · from: prd · task: t-1',
    '- [todo] a source Petal does not know · from: slack',
    '## Bugs',
  ].join('\n');
  const parsed = parseCriteria(file);

  it('reads [todo] and "[ ]" as a scenario with no test yet, and where its rule came from', () => {
    expect(parsed.scenarios.map((s) => [s.status, s.source, s.tests.length])).toEqual([['todo', 'prd', 0], ['todo', 'notes', 0], ['todo', null, 0], ['pass', 'prd', 2]]);
    expect(parsed.scenarios[0]).toMatchObject({ test: null, taskId: 't-1', regression: false });
  });

  it('links every test to its scenario, the first one as test', () => {
    expect(parsed.scenarios[3].tests).toEqual([{ path: 'src/refund.test.ts', name: 'closes' }, { path: 'e2e/refund.spec.ts', name: 'shows closed' }]);
    expect(parsed.scenarios[3].test).toEqual({ path: 'src/refund.test.ts', name: 'closes' });
  });

  it('counts an unknown source as malformed rather than guessing', () => {
    expect(parsed.malformed).toBe(1);
  });

  it('parses the skill’s own scenario examples: one waiting for tests, one passing with two', () => {
    const lines = BUNDLED.split('\n').filter((l) => /^- \[(todo|pass)\] /.test(l));
    expect(lines).toHaveLength(2);
    const criteria = parseCriteria(`${CRITERIA_SKELETON.replace('## Bugs', `${lines.join('\n')}\n\n## Bugs`)}`);
    expect(criteria.malformed).toBe(0);
    expect(criteria.scenarios.map((s) => [s.status, s.source, s.tests.length, s.taskId])).toEqual([['todo', 'prd', 0, 't-1a2b'], ['pass', 'prd', 2, 't-1a2b']]);
  });
});

describe('the skill', () => {
  it('writes scenarios after Inspect and stops for review before any test', () => {
    const headings = BUNDLED.split('\n').filter((l) => /^## \d\./.test(l));
    expect(headings).toEqual(['## 0. Which task, and whether you may change its suite', '## 1. Inspect first', '## 2. Write the scenarios, then stop', '## 3. Propose, then build', '## 4. Run it', '## 5. Hand Petal the suite', '## 6. Report']);
    expect(BUNDLED).toContain('Then stop. Don\'t write any test, config or suite file yet.');
    expect(BUNDLED).toContain('Only after the go-ahead.');
    expect(BUNDLED).not.toMatch(/[—–]/);
  });

  it('reaches an edited copy too: the inline brief carries the scenarios step', () => {
    const inline = draftBrief(true, 'for task t-1: "Refunds".', BUNDLED);
    expect(inline).toContain('## 2. Write the scenarios, then stop');
    expect(inline).toContain('ready for review in Petal');
  });
});

describe('where scenarios come from', () => {
  it('labels the task notes and the PRD, keeping their lines', () => {
    const lines = scenarioSources({ notes: 'Refunds cap at the amount paid.\n\nA reason is required.', prd: { title: 'Refunds  v2', notes: '- Partial refunds\n- Email on refund' } });
    expect(lines[0]).toMatch(/^Source of scenarios: .*"from: notes" or "from: prd"/);
    expect(lines.slice(1)).toEqual(['Task notes:', 'Refunds cap at the amount paid.\nA reason is required.', 'PRD "Refunds v2":', '- Partial refunds\n- Email on refund']);
  });

  it('is empty with neither, and says so when a PRD has only a title', () => {
    expect(scenarioSources({ notes: '  ', prd: null })).toEqual([]);
    expect(scenarioSources({ notes: '', prd: { title: 'Refunds', notes: '' } }).slice(1)).toEqual(['PRD "Refunds":', '(no text beyond its title)']);
  });

  it('caps each source and strips control characters', () => {
    const lines = scenarioSources({ notes: `a\u0007b ${'x'.repeat(SOURCE_CAP * 2)}`, prd: null });
    expect(lines[2]).toHaveLength(SOURCE_CAP);
    expect(lines[2].startsWith('a b')).toBe(true);
    expect(lines[2].endsWith('…')).toBe(true);
  });

  it('the draft request names the task, its files, then its notes and PRD as the source', () => {
    const request = draftRequest({ id: 't-1', title: 'Refunds', notes: 'Refunds cap at the amount paid.' }, { title: 'Payments', notes: 'Every refund emails the payer.' });
    expect(request.split('\n')).toEqual([
      'for task t-1: "Refunds". You are this task\'s testing agent, so you may write .petal/suites/t-1.json. Write its scenarios and record its bugs in .petal/criteria/t-1.md.',
      expect.stringMatching(/^Source of scenarios: /),
      'Task notes:', 'Refunds cap at the amount paid.',
      'PRD "Payments":', 'Every refund emails the payer.',
    ]);
    expect(draftRequest({ id: 't-1', title: 'Refunds', notes: '' }, null)).not.toContain('Source of scenarios');
    expect(draftBrief(false, request, BUNDLED).startsWith('/petal-testing-suite for task t-1: "Refunds".')).toBe(true);
  });

  it('a loop with nothing approved stops in round 1 for her review; an approved one only for new scenarios', () => {
    const base = { focus: '', rounds: 3, stages: [{ id: 's', name: 'Unit', command: 'npm test' }], stack: [], taskId: 't-6b86cb76', agent: true };
    const first = buildLoopBrief({ ...base, review: true });
    expect(first).toContain('Scenarios first: before any test in round 1, write this task\'s scenarios under Scenarios in the criteria file as [todo] lines');
    expect(first).toContain('end your reply with the Loop line in the phase scenarios and wait');
    expect(first).toContain('A scenario you add in a later round goes in as [todo] too');
    expect(first).toContain('1. Scenarios: give every approved [todo] scenario its tests');
    const later = buildLoopBrief({ ...base, review: false });
    expect(later).not.toContain('before any test in round 1');
    expect(later).toContain('The scenarios already in the criteria file are the ones I approved.');
    expect(later).toContain('A scenario you add in a later round goes in as [todo] too');
    expect(reviewBrief(true).join('\n')).not.toMatch(/[—–]/);
    expect(buildLoopBrief({ ...base, agent: false })).not.toContain('Scenarios first'); // the old single-agent loop is unchanged
  });

  it('the loop brief carries them after the focus, with the todo status explained', () => {
    const brief = buildLoopBrief({ focus: 'refunds', rounds: 3, stages: [{ id: 's', name: 'Unit', command: 'npm test' }], stack: [], taskId: 't-1', agent: true, sources: { notes: 'Refunds cap at the amount paid.', prd: { title: 'Payments', notes: 'Partial refunds allowed.' } } });
    expect(brief).toContain('Focus: refunds.\nSource of scenarios:');
    expect(brief).toContain('Task notes:\nRefunds cap at the amount paid.\nPRD "Payments":\nPartial refunds allowed.');
    expect(brief).toContain('give every approved [todo] scenario its tests');
    expect(brief).toContain('or todo for a scenario with no test yet');
    expect(brief).not.toMatch(/[—–]/);
    expect(buildLoopBrief({ focus: '', rounds: 3, stages: [], stack: [], taskId: 't-1', agent: true })).not.toContain('Source of scenarios');
  });
});

describe('her review', () => {
  const idle: ReviewFacts = { stopped: false, approved: [], busy: false, asking: false };
  const scenarios = [{ status: 'todo' as const, name: 'refund is capped' }, { status: 'pass' as const, name: 'refund emails the payer' }, { status: 'todo' as const, name: 'cancelled order is refused' }];
  const names = (list: { name: string }[]) => list.map((s) => s.name);

  it('shows the [todo] scenarios once the testing agent sits idle on them', () => {
    expect(names(awaitingReview(scenarios, idle))).toEqual(['refund is capped', 'cancelled order is refused']);
    expect(awaitingReview(scenarios, { ...idle, busy: true })).toEqual([]); // still writing them
    expect(awaitingReview(scenarios, { ...idle, asking: true })).toEqual([]); // a prompt waits on her first
    expect(awaitingReview(scenarios, { ...idle, stopped: true })).toEqual([]);
    expect(awaitingReview([], idle)).toEqual([]);
  });

  it('once approved they don’t show again; only scenarios added later do', () => {
    const approved = { ...idle, approved: ['refund is capped', 'cancelled order is refused'] };
    expect(awaitingReview(scenarios, approved)).toEqual([]); // an approved one still [todo] (untestable) never re-asks
    expect(names(awaitingReview([...scenarios, { status: 'todo', name: 'a second refund waits' }], approved))).toEqual(['a second refund waits']);
  });

  it('a draft waiting on her review has not ended without a suite, even with no claude running it; a closed one has', () => {
    const idle = { suite: false, state: 'idle' as const, worked: true };
    expect(draftEnded({ ...idle, reviewing: true })).toBe(false);
    expect(draftEnded(idle)).toBe(true);
    expect(draftEnded({ ...idle, state: 'ended', reviewing: true })).toBe(false);
    expect(draftEnded({ ...idle, state: 'closed', reviewing: true })).toBe(true);
  });

  it('the go-ahead names the file, says she may have edited it, and asks for linked tests', () => {
    const text = scenariosApprovedText('t-1');
    expect(text).toContain('.petal/criteria/t-1.md');
    expect(text).toContain('look right');
    expect(text).toContain('Read the file again first');
    expect(text).toContain('"test: path::test name"');
    expect(text).not.toMatch(/[—–]/);
  });
});

// Scenarios first: the [todo] scenario line, where scenarios come from in the testing agent's briefs, when Petal shows
// them for her review, and the go-ahead it sends. Plus the bundled skill's own example lines.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildLoopBrief, CRITERIA_SKELETON, parseCriteria, scenarioSources, SOURCE_CAP } from '../src/shared/test-loop';
import { draftBrief, draftEnded, draftRequest, scenarioReview, scenariosApprovedText, TESTING_SKILL, type ReviewFacts } from '../src/shared/suite-draft';

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

  it('the loop brief carries them after the focus, with the todo status explained', () => {
    const brief = buildLoopBrief({ focus: 'refunds', rounds: 3, stages: [{ id: 's', name: 'Unit', command: 'npm test' }], stack: [], taskId: 't-1', agent: true, sources: { notes: 'Refunds cap at the amount paid.', prd: { title: 'Payments', notes: 'Partial refunds allowed.' } } });
    expect(brief).toContain('Focus: refunds.\nSource of scenarios:');
    expect(brief).toContain('Task notes:\nRefunds cap at the amount paid.\nPRD "Payments":\nPartial refunds allowed.');
    expect(brief).toContain('give any still [todo] its tests first');
    expect(brief).toContain('or todo for a scenario with no test yet');
    expect(brief).not.toMatch(/[—–]/);
    expect(buildLoopBrief({ focus: '', rounds: 3, stages: [], stack: [], taskId: 't-1', agent: true })).not.toContain('Source of scenarios');
  });
});

describe('her review', () => {
  const ready: ReviewFacts = { kind: 'draft', stopped: false, approvedAt: null, scenarios: [{ status: 'todo' }, { status: 'pass' }], busy: false, asking: false };

  it('is ready once an idle, live draft has scenarios with no test yet', () => {
    expect(scenarioReview(ready)).toBe('ready');
    expect(scenarioReview({ ...ready, busy: true })).toBe('none'); // still writing them
    expect(scenarioReview({ ...ready, asking: true })).toBe('none'); // a prompt waits on her first
    expect(scenarioReview({ ...ready, scenarios: [{ status: 'pass' }] })).toBe('none');
    expect(scenarioReview({ ...ready, scenarios: [] })).toBe('none');
  });

  it('is over once she approved, and never shows for a loop or a stopped draft', () => {
    expect(scenarioReview({ ...ready, approvedAt: 5 })).toBe('approved');
    expect(scenarioReview({ ...ready, kind: 'loop' })).toBe('none');
    expect(scenarioReview({ ...ready, stopped: true })).toBe('none');
  });

  it('a draft waiting on her review has not ended without a suite; a closed tab still has', () => {
    const idle = { suite: false, tab: 'open' as const, busy: false, asking: false, worked: true };
    expect(draftEnded({ ...idle, reviewing: true })).toBe(false);
    expect(draftEnded(idle)).toBe(true);
    expect(draftEnded({ ...idle, tab: 'gone', reviewing: true })).toBe(true);
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

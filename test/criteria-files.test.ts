// The repo's criteria file: Scenarios, Manual and Bugs parsed and written back, her manual ticks, ticket and level filters,
// the coverage count, bugs in ADO shape, and the one-time import of older per-task files.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { removeTempDirs, tempDir, useTempUserData } from './helpers';
import {
  CRITERIA_SKELETON, adoBugText, addCriteriaItems, buildLoopBrief, criteriaText, filterCriteria, parseCriteria, setManualResult, setScenarioStatuses, ticketInText, ticketsOf, untested,
} from '../src/shared/test-loop';
import { repoKey } from '../src/main/petal-repos';
import { criteriaFile, prepareCriteria, readCriteria, saveManualResult, saveScenarioStatuses } from '../src/main/criteria-store';
import type { Task } from '../src/shared/tasks';

afterEach(removeTempDirs);

const FILE = [
  '# Test criteria',
  '',
  'Her notes stay as written.',
  '',
  '## Scenarios',
  '- [pass] refund over the amount paid is refused · test: src/refund.test.ts::refuses over-refund · test: e2e/refund.spec.ts::shows the limit · ticket: AB#1234 · level: regression · from: prd',
  '- [todo] partial refund emails the payer · ticket: AB#1234 · level: smoke',
  '- [fail] staging webhook retries · test: e2e/hook.spec.ts::retries · ticket: AB#1250 · level: staging',
  '- [pass] old line · test: src/old.test.ts · round 2',
  '',
  '## Manual',
  '- [todo] receipt email arrives on a real phone · ticket: AB#1234 · level: manual',
  '  - Prereq: staging account with a verified email',
  '  - Steps: pay RM10, open the inbox',
  '  - Expected: receipt within 1 minute',
  '- [blocked] SMS on a Celcom SIM · ticket: AB#1250 · level: manual',
  '  - Steps: request an OTP',
  '  - Expected: SMS within 30 s',
  '  - Result: no Celcom SIM in the office',
  '',
  '## Bugs',
  '- [open] coupon can take the total below zero · test: src/coupon.test.ts::caps at the total · ticket: AB#1234',
  '  - Steps: add a RM5 item, apply SAVE10',
  '  - Expected: total RM0.00',
  '  - Actual: total -RM5.00',
  '  - Env: local, node 22',
  '  - Evidence: expected 0, received -5',
  '- [fixed] cent off · ticket: AB#1250',
  '',
].join('\n');

const task = (id: string, title: string): Task => ({ id, title, notes: '', status: 'open', owner: null, createdAt: 0, claimedAt: null, doneAt: null, doneBy: null, prdId: null, parentId: null }) as Task;
const put = (file: string, text: string) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { stdio: 'ignore' });

describe('the three sections', () => {
  const parsed = parseCriteria(FILE);

  it('reads scenarios with every test, ticket, level and source; manual cases and bugs with their sub-bullets', () => {
    expect(parsed.malformed).toBe(0);
    expect(parsed.scenarios.map((s) => [s.status, s.tests.length, s.ticket, s.level, s.source])).toEqual([
      ['pass', 2, 'AB#1234', 'regression', 'prd'], ['todo', 0, 'AB#1234', 'smoke', null], ['fail', 1, 'AB#1250', 'staging', null], ['pass', 1, null, null, null],
    ]);
    expect(parsed.manual[0]).toMatchObject({ status: 'todo', name: 'receipt email arrives on a real phone', ticket: 'AB#1234', level: 'manual', details: { Prereq: 'staging account with a verified email', Steps: 'pay RM10, open the inbox', Expected: 'receipt within 1 minute' } });
    expect(parsed.manual[1].details.Result).toBe('no Celcom SIM in the office');
    expect(parsed.bugs[0]).toMatchObject({ status: 'open', regression: true, ticket: 'AB#1234', details: { Steps: 'add a RM5 item, apply SAVE10', Actual: 'total -RM5.00', Env: 'local, node 22' } });
  });

  it('round-trips all three sections, sub-bullets included', () => {
    const text = criteriaText(parsed);
    expect(parseCriteria(text)).toEqual({ ...parsed, truncated: false });
    expect(criteriaText(parseCriteria(text))).toBe(text);
    expect(text).toContain('## Manual\n- [todo] receipt email arrives on a real phone · ticket: AB#1234 · level: manual\n  - Prereq: staging account with a verified email\n  - Steps: pay RM10, open the inbox\n  - Expected: receipt within 1 minute\n');
  });

  it('a sub-bullet with no item above it, or an unknown part, counts as malformed', () => {
    expect(parseCriteria('## Manual\n  - Steps: orphan\n- [todo] x · weird: y\n').malformed).toBe(2);
    expect(parseCriteria('## Scenarios\n- [pass] x · level: nightly\n').malformed).toBe(1);
  });
});

describe('her manual ticks', () => {
  it('sets the status and the Result note, keeping every other line as written', () => {
    const ticked = setManualResult(FILE, 'receipt email arrives on a real phone', 'pass', 'arrived in 20 s');
    expect(ticked).not.toBeNull();
    const parsed = parseCriteria(ticked as string);
    expect(parsed.manual[0]).toMatchObject({ status: 'pass', details: { Result: 'arrived in 20 s', Steps: 'pay RM10, open the inbox' } });
    expect((ticked as string).split('\n').filter((l) => !FILE.split('\n').includes(l))).toEqual(['- [pass] receipt email arrives on a real phone · ticket: AB#1234 · level: manual', '  - Result: arrived in 20 s']);
  });

  it('replaces an existing Result, removes it when empty, and is null for a case that’s gone', () => {
    const fail = setManualResult(FILE, 'SMS on a Celcom SIM', 'fail', 'no SMS after 5 min') as string;
    expect(parseCriteria(fail).manual[1]).toMatchObject({ status: 'fail', details: { Result: 'no SMS after 5 min' } });
    expect(parseCriteria(setManualResult(FILE, 'SMS on a Celcom SIM', 'todo', '') as string).manual[1].details.Result).toBeUndefined();
    expect(setManualResult(FILE, 'not a case', 'pass', '')).toBeNull();
    expect(setManualResult(FILE, 'refund over the amount paid is refused', 'pass', '')).toBeNull(); // a scenario, not a manual case
  });

  it('a scenario run sets each named scenario’s status only', () => {
    const next = setScenarioStatuses(FILE, { 'partial refund emails the payer': 'fail', 'staging webhook retries': 'pass', toString: 'pass' as const });
    expect(parseCriteria(next).scenarios.map((s) => s.status)).toEqual(['pass', 'fail', 'pass', 'pass']);
    expect(next.split('\n').length).toBe(FILE.split('\n').length);
  });
});

describe('filters and coverage', () => {
  const parsed = parseCriteria(FILE);

  it('ticket chips list every ticket once; a ticket filters every section', () => {
    expect(ticketsOf(parsed)).toEqual(['AB#1234', 'AB#1250']);
    const one = filterCriteria(parsed, { ticket: 'AB#1250', levels: [] });
    expect([one.scenarios.length, one.manual.length, one.bugs.length]).toEqual([1, 1, 1]);
  });

  it('level chips filter scenarios; manual cases and bugs stay', () => {
    const smoke = filterCriteria(parsed, { ticket: null, levels: ['smoke'] });
    expect(smoke.scenarios.map((s) => s.name)).toEqual(['partial refund emails the payer']);
    expect(smoke.manual).toHaveLength(2);
    expect(filterCriteria(parsed, { ticket: null, levels: ['regression', 'staging'] }).scenarios).toHaveLength(2);
    expect(filterCriteria(parsed, { ticket: null, levels: [] }).scenarios).toHaveLength(4);
  });

  it('counts scenarios with no test', () => {
    expect(untested(parsed).map((s) => s.name)).toEqual(['partial refund emails the payer']);
  });

  it('takes a task’s AB# id from its name', () => {
    expect(ticketInText('AB#1234 refund caps')).toBe('AB#1234');
    expect(ticketInText('Refunds')).toBeNull();
  });
});

describe('a bug for Azure DevOps', () => {
  it('is plain text in the repro-steps shape, with its failing test', () => {
    const text = adoBugText(parseCriteria(FILE).bugs[0]);
    expect(text).toBe([
      'Title: coupon can take the total below zero', 'Related: AB#1234', '',
      'Steps to reproduce:', 'add a RM5 item, apply SAVE10', '',
      'Expected result:', 'total RM0.00', '',
      'Actual result:', 'total -RM5.00', '',
      'Environment: local, node 22', 'Failing test: src/coupon.test.ts::caps at the total', 'Evidence: expected 0, received -5',
    ].join('\n'));
    expect(adoBugText(parseCriteria(FILE).bugs[1])).toContain('Steps to reproduce:\n(not recorded)');
  });
});

describe('adding items', () => {
  it('appends to the right section by name, never twice, and adds a missing section', () => {
    const [item] = parseCriteria('## Manual\n- [todo] new case · level: manual\n  - Steps: tap\n').manual;
    const once = addCriteriaItems(CRITERIA_SKELETON, { manual: [item] });
    expect(once).toContain('## Manual\n- [todo] new case · level: manual\n  - Steps: tap\n');
    expect(addCriteriaItems(once, { manual: [item] })).toBe(once);
    expect(addCriteriaItems('# Notes only\n', { manual: [item] })).toContain('## Manual\n- [todo] new case');
  });
});

describe('the repo file on disk', () => {
  it('lives in Petal’s suite folder for the main checkout: a worktree prepares, reads and writes the same one, and no .petal is made in the repo', () => {
    const petalHome = useTempUserData(); // the electron mock's app.getPath('home')
    const dir = fs.realpathSync(tempDir('petal-git-'));
    const main = path.join(dir, 'main');
    fs.mkdirSync(main);
    git(main, 'init', '-q');
    put(path.join(main, 'a.txt'), 'a');
    git(main, 'add', 'a.txt');
    git(main, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'i');
    const wt = path.join(dir, 'wt');
    git(main, 'worktree', 'add', '-q', wt, '-b', 'x');
    prepareCriteria(wt);
    const file = path.join(petalHome, '.petal', 'repos', repoKey(main), 'criteria.md');
    expect(criteriaFile(wt)).toBe(file);
    expect(fs.readFileSync(file, 'utf8')).toBe(CRITERIA_SKELETON);
    put(file, FILE);
    expect(readCriteria(wt, [])?.manual).toHaveLength(2);
    expect(saveManualResult(wt, 'SMS on a Celcom SIM', 'pass', 'ok')).toBeNull();
    expect(readCriteria(main, [])?.manual[1]).toMatchObject({ status: 'pass', details: { Result: 'ok' } });
    expect(saveManualResult(wt, 'gone', 'pass', '')).toMatch(/gone/);
    saveScenarioStatuses(wt, { 'partial refund emails the payer': 'pass' });
    expect(readCriteria(main, [])?.scenarios[1].status).toBe('pass');
    expect(fs.existsSync(path.join(main, '.petal'))).toBe(false);
    expect(fs.existsSync(path.join(wt, '.petal'))).toBe(false);
  });

  it('imports older per-task files once: lines merged by text, tagged with the task’s AB# id, old files untouched', () => {
    useTempUserData();
    const root = tempDir('petal-repo-');
    const cart = '## Scenarios\n- [pass] cart rounds · test: src/cart.test.ts::rounds · round 1 · task: t-cart\n## Bugs\n- [fail] cent off · test: src/cart.test.ts::cent · task: t-cart\n';
    const coupon = '## Scenarios\n- [pass] cart rounds · test: src/other.test.ts · task: t-coupon\n- [todo] coupon caps · ticket: AB#9\n';
    const shared = '## Scenarios\n- [pass] an old scenario · round 1\n';
    put(path.join(root, '.petal', 'criteria', 't-cart.md'), cart);
    put(path.join(root, '.petal', 'criteria', 't-coupon.md'), coupon);
    put(path.join(root, '.petal', 'test-criteria.md'), shared);
    const tasks = [task('t-cart', 'AB#1234 Fix the cart total'), task('t-coupon', 'Coupons')];
    const read = readCriteria(root, tasks);
    expect(read?.scenarios.map((s) => [s.name, s.ticket, s.taskId])).toEqual([['an old scenario', null, null], ['cart rounds', 'AB#1234', null], ['coupon caps', 'AB#9', null]]);
    expect(read?.bugs.map((b) => [b.name, b.status, b.ticket])).toEqual([['cent off', 'fail', 'AB#1234']]);
    expect(fs.readFileSync(path.join(root, '.petal', 'criteria', 't-cart.md'), 'utf8')).toBe(cart);
    expect(fs.readFileSync(path.join(root, '.petal', 'test-criteria.md'), 'utf8')).toBe(shared);
    const text = fs.readFileSync(criteriaFile(root), 'utf8');
    fs.writeFileSync(criteriaFile(root), text.replace(/^- \[pass\] cart rounds.*\n/m, '')); // she removes a line
    expect(readCriteria(root, tasks)?.scenarios.map((s) => s.name)).toEqual(['an old scenario', 'coupon caps']); // not imported again
  });

  it('imports the main checkout’s .petal/criteria.md once and never changes it', () => {
    const petalHome = useTempUserData();
    const root = fs.realpathSync(tempDir('petal-repo-'));
    const inRepo = '## Scenarios\n- [pass] refund capped · test: src/refund.test.ts::caps · ticket: AB#1\n';
    put(path.join(root, '.petal', 'criteria.md'), inRepo);
    expect(readCriteria(root, [])?.scenarios.map((s) => [s.name, s.ticket])).toEqual([['refund capped', 'AB#1']]);
    expect(criteriaFile(root)).toBe(path.join(petalHome, '.petal', 'repos', repoKey(root), 'criteria.md'));
    saveScenarioStatuses(root, { 'refund capped': 'fail' }); // writes go to Petal's copy only
    expect(fs.readFileSync(path.join(root, '.petal', 'criteria.md'), 'utf8')).toBe(inRepo);
    put(path.join(root, '.petal', 'criteria.md'), `${inRepo}- [todo] a later line\n`); // an old-skill session edits the repo copy
    expect(readCriteria(root, [])?.scenarios.map((s) => [s.name, s.status])).toEqual([['refund capped', 'fail']]); // not imported again
    expect(fs.readdirSync(path.join(root, '.petal'))).toEqual(['criteria.md']);
  });

  it('no file at all reads as none', () => {
    useTempUserData();
    expect(readCriteria(tempDir('petal-repo-'), [])).toBeNull();
  });
});

describe('the loop brief', () => {
  it('names the repo’s criteria file in Petal’s suite folder and the three sections', () => {
    const brief = buildLoopBrief({ focus: '', rounds: 2, stages: [], stack: [], taskId: 't-1', agent: true, suiteDir: '/h/.petal/repos/-code-app' });
    expect(brief).toContain('Criteria file: /h/.petal/repos/-code-app/criteria.md');
    expect(brief).toContain('The suite lives in /h/.petal/repos/-code-app/suite.json');
    expect(brief).toContain('"## Scenarios", "## Manual" and "## Bugs"');
    expect(brief).not.toMatch(/[—–]/);
  });
});

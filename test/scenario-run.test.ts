// A scenario's own Run and a ticket's Run: the command per test file and runner, escaping, several names in one run,
// unknown runners, the stages' shared environment prefix, and reading each scenario's result back.
import { describe, expect, it } from 'vitest';
import {
  dquote, envPrefix, escapeRegex, fileCommand, isOutsidePath, planScenario, planTests, planTicket, runnerForFile, scenarioBlock, scenarioOutcome, shellPath, suiteCallFor, ticketScenarios,
} from '../src/shared/scenario-run';
import { parseCriteria } from '../src/shared/test-loop';
import type { StageResult, TestCase } from '../src/shared/testing';

const VITEST = new Set(['vitest']);

describe('the environment prefix', () => {
  it('is the leading steps every stage shares, each stage keeping one of its own', () => {
    const nvm = 'source ~/.nvm/nvm.sh && nvm use 22';
    expect(envPrefix([`${nvm} && npm run typecheck`, `${nvm} && npx vitest run`])).toBe(`${nvm} && `);
    expect(envPrefix(['source ~/.nvm/nvm.sh && npm test', 'npm run lint'])).toBe('');
    expect(envPrefix(['cd app && npm test'])).toBe('cd app && ');
    expect(envPrefix(['npm test'])).toBe('');
    expect(envPrefix([])).toBe('');
  });
});

describe('the runner for a test file', () => {
  it('pytest and go by file; JS by the suite’s runners, e2e folders to Playwright', () => {
    expect(runnerForFile('tests/test_refund.py', VITEST)).toBe('pytest');
    expect(runnerForFile('pkg/refund_test.go', VITEST)).toBe('go');
    expect(runnerForFile('src/a.test.ts', VITEST)).toBe('vitest');
    expect(runnerForFile('src/a.test.tsx', new Set(['jest']))).toBe('jest');
    expect(runnerForFile('e2e/refund.spec.ts', new Set(['vitest', 'playwright']))).toBe('playwright');
    expect(runnerForFile('tests/refund.spec.ts', new Set(['playwright']))).toBe('playwright');
  });

  it('is unknown with no matching runner, or for a file it can’t run', () => {
    expect(runnerForFile('src/a.test.ts', new Set())).toBeNull();
    expect(runnerForFile('flows/login.yaml', VITEST)).toBeNull();
    expect(runnerForFile('Tests/AppTests.swift', VITEST)).toBeNull();
  });
});

describe('the command', () => {
  it('escapes regex characters in names and shell characters in the quoted word', () => {
    expect(escapeRegex('caps (at) $5 + tax?')).toBe('caps \\(at\\) \\$5 \\+ tax\\?');
    expect(dquote('say "hi" $HOME `x` \\')).toBe('"say \\"hi\\" \\$HOME \\`x\\` \\\\"');
    expect(fileCommand('vitest', 'src/refund.test.ts', ['caps (at) $5'])).toBe('npx vitest run "src/refund.test.ts" -t "caps \\\\(at\\\\) \\\\\\$5"');
  });

  it('several names in one file make one run with an OR pattern', () => {
    expect(fileCommand('vitest', 'src/a.test.ts', ['one', 'two'])).toBe('npx vitest run "src/a.test.ts" -t "one|two"');
    expect(fileCommand('jest', 'src/a.test.ts', ['one', 'two'])).toBe('npx jest "src/a.test.ts" -t "one|two"');
    expect(fileCommand('playwright', 'e2e/a.spec.ts', ['shows the limit'])).toBe('npx playwright test "e2e/a.spec.ts" -g "shows the limit"');
    expect(fileCommand('pytest', 'tests/test_a.py', ['test_one', 'test_two'])).toBe('pytest "tests/test_a.py::test_one" "tests/test_a.py::test_two"');
    expect(fileCommand('go', 'pkg/refund/refund_test.go', ['TestCaps', 'TestRound'])).toBe("go test ./pkg/refund -run '^(TestCaps|TestRound)$'");
    expect(fileCommand('go', 'refund_test.go', ["Test'x"])).toBe("go test . -run '^(Test'\\''x)$'");
  });

  it('groups tests by file, runs a file whole when a test has no name, prefixes each, and skips unknown runners', () => {
    const plan = planTests([
      { path: 'src/a.test.ts', name: 'one' }, { path: 'src/a.test.ts', name: 'two' }, { path: 'src/b.test.ts', name: null }, { path: 'src/b.test.ts', name: 'x' },
      { path: 'flows/login.yaml', name: 'logs in' },
    ], VITEST, 'source ~/.nvm/nvm.sh && ');
    expect(plan.stages).toEqual([
      { id: 'scenario-1', name: 'Scenario · a.test.ts', command: 'source ~/.nvm/nvm.sh && npx vitest run "src/a.test.ts" -t "one|two"' },
      { id: 'scenario-2', name: 'Scenario · b.test.ts', command: 'source ~/.nvm/nvm.sh && npx vitest run "src/b.test.ts"' },
    ]);
    expect(plan.files).toEqual({ 'scenario-1': 'src/a.test.ts', 'scenario-2': 'src/b.test.ts' });
    expect(plan.skipped).toEqual(['flows/login.yaml']);
  });
});

const CRITERIA = parseCriteria([
  '## Scenarios',
  '- [todo] refund capped · test: src/refund.test.ts::caps · test: e2e/refund.spec.ts::shows the limit · ticket: AB#1 · level: regression',
  '- [todo] refund emails · test: src/refund.test.ts::emails · ticket: AB#1 · level: smoke',
  '- [todo] staging webhook · test: e2e/hook.spec.ts::retries · ticket: AB#1 · level: staging',
  '- [todo] no test yet · ticket: AB#1',
  '- [todo] other ticket · test: src/x.test.ts::x · ticket: AB#2',
  '- [todo] a flow · test: flows/login.yaml::logs in · ticket: AB#2',
].join('\n'));
const RUNNERS = new Set(['vitest', 'playwright']);

describe('a scenario’s Run and a ticket’s Run', () => {
  it('a scenario runs only its own tests; with no test or an unknown runner its button says why', () => {
    expect(planScenario(CRITERIA.scenarios[0], RUNNERS, '').stages.map((s) => s.command)).toEqual(['npx vitest run "src/refund.test.ts" -t "caps"', 'npx playwright test "e2e/refund.spec.ts" -g "shows the limit"']);
    expect(scenarioBlock(CRITERIA.scenarios[0], RUNNERS)).toBeNull();
    expect(scenarioBlock(CRITERIA.scenarios[3], RUNNERS)).toBe('No test names this scenario yet.');
    expect(scenarioBlock(CRITERIA.scenarios[5], RUNNERS)).toBe('No known runner for flows/login.yaml');
  });

  it('a ticket runs its tested scenarios batched per file; staging only when turned on', () => {
    const without = ticketScenarios(CRITERIA.scenarios, 'AB#1', false);
    expect(without.map((s) => s.name)).toEqual(['refund capped', 'refund emails']);
    expect(planTicket(without, RUNNERS, '').stages.map((s) => s.command)).toEqual(['npx vitest run "src/refund.test.ts" -t "caps|emails"', 'npx playwright test "e2e/refund.spec.ts" -g "shows the limit"']);
    expect(ticketScenarios(CRITERIA.scenarios, 'AB#1', true).map((s) => s.name)).toContain('staging webhook');
  });
});

describe('each scenario’s result', () => {
  const plan = planTicket(ticketScenarios(CRITERIA.scenarios, 'AB#1', false), RUNNERS, '');
  const test = (name: string, status: TestCase['status']): TestCase => ({ name, file: 'x', status, durationMs: 1 });
  const stage = (stageId: string, status: StageResult['status'], tests: TestCase[]): StageResult =>
    ({ stageId, name: stageId, command: '', status, exitCode: status === 'passed' ? 0 : 1, durationMs: 1, counts: { passed: 0, failed: 0, skipped: 0 }, tests, output: '', runner: null });

  it('passes when every one of its tests passed, found by name under its describe blocks', () => {
    const stages = [stage('scenario-1', 'failed', [test('refund > caps', 'passed'), test('refund > emails', 'failed')]), stage('scenario-2', 'passed', [])];
    expect(scenarioOutcome(CRITERIA.scenarios[0], stages, plan.files)).toBe('pass');
    expect(scenarioOutcome(CRITERIA.scenarios[1], stages, plan.files)).toBe('fail');
  });

  it('a test the report doesn’t list takes its stage’s result; a file that never ran leaves it as it was', () => {
    expect(scenarioOutcome(CRITERIA.scenarios[0], [stage('scenario-1', 'passed', []), stage('scenario-2', 'failed', [])], plan.files)).toBe('fail');
    expect(scenarioOutcome(CRITERIA.scenarios[1], [stage('scenario-1', 'skipped', [])], plan.files)).toBeNull();
  });
});

describe('a test kept in the suite folder in Petal', () => {
  const NVM = 'source ~/.nvm/nvm.sh >/dev/null && nvm use 24 >/dev/null';
  const SUITE = '~/.petal/repos/-home-me-app';
  const general = `${NVM} && npx vitest run --config ${SUITE}/vitest.config.mjs --project general`;
  const other = `${NVM} && npx vitest run --config ${SUITE}/vitest.config.mjs --project needs-x`;
  const repoStages = [`${NVM} && npm test`, 'zsh ~/scripts/staging.sh'];
  const file = `${SUITE}/tests/routes/email/perEmail.test.ts`;

  it('is a home or absolute path; it becomes one shell word with $HOME, never ~ inside quotes', () => {
    expect([file, '$HOME/x.test.ts', '/abs/x.test.ts', 'src/x.test.ts'].map(isOutsidePath)).toEqual([true, true, true, false]);
    expect(shellPath(`${SUITE}/a b.test.ts`)).toBe('"$HOME""/.petal/repos/-home-me-app/a b.test.ts"');
    expect(shellPath('/abs/x.test.ts')).toBe('"/abs/x.test.ts"');
  });

  it('runs through the suite stage whose --config sits in its folder: that stage’s steps, config and project, then the file and test filter', () => {
    const plan = planTests([{ path: file, name: 'caller sends old names only' }], VITEST, '', [...repoStages, general]);
    expect(plan.skipped).toEqual([]);
    expect(plan.stages.map((s) => s.command)).toEqual([
      `${NVM} && npx vitest run --config "$HOME""/.petal/repos/-home-me-app/vitest.config.mjs" --project "general" "$HOME""/.petal/repos/-home-me-app/tests/routes/email/perEmail.test.ts" -t "caller sends old names only"`,
    ]);
    expect(plan.files).toEqual({ 'scenario-1': file });
  });

  it('across stages on several projects: the one its path names, else the first; a config in another folder is not used', () => {
    expect(suiteCallFor(file, [general, other])?.project).toBe('general');
    expect(suiteCallFor(`${SUITE}/tests/needs-x/routes/email/perEmail.test.ts`, [general, other])?.project).toBe('needs-x');
    expect(suiteCallFor(file, [`npx vitest run --config=${SUITE}/vitest.config.mjs`])).toMatchObject({ prefix: '', project: null });
    expect(suiteCallFor(file, [`npx vitest run --config ~/.petal/repos/-home-me-other/vitest.config.mjs`])).toBeNull();
    expect(suiteCallFor(file.replace('~', '$HOME'), [general])?.config).toBe(`${SUITE}/vitest.config.mjs`);
  });

  it('with no such stage, or a runner other than vitest, its Run is off instead of a broken command; repo paths are unchanged', () => {
    const item = (path: string) => parseCriteria(`## Scenarios\n- [todo] x · test: ${path}::t\n## Manual\n## Bugs\n`).scenarios[0];
    expect(scenarioBlock(item(file), VITEST, repoStages)).toBe(`No known runner for ${file}`);
    expect(scenarioBlock(item(file), VITEST, [general])).toBeNull();
    for (const path of [`${SUITE}/tests/a_test.go`, `${SUITE}/tests/test_a.py`, `${SUITE}/flows/login.yaml`]) {
      expect(scenarioBlock(item(path), new Set(['vitest', 'jest', 'playwright']), [general])).toBe(`No known runner for ${path}`);
    }
    expect(planTests([{ path: 'src/a.test.ts', name: 'one' }], VITEST, `${NVM} && `, [general]).stages[0].command).toBe(`${NVM} && npx vitest run "src/a.test.ts" -t "one"`);
  });
});

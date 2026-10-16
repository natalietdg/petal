// The Testing tab: stack detection, result parsers on real runner output, Claude's runs from a log,
// history caps per project, the fix prompt, confirm and remember, and the pipeline script's exit markers.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { removeTempDirs, tempDir, useTempUserData } from './helpers';
import { detectStack, isAboutTestingSoftware, proposeStages, testingSkills } from '../src/main/testing-detect';
import { slashCatalog } from '../src/main/slash-catalog';
import { parseGoJson, parseJUnit, parseJestJson, parsePlaywrightJson, parseReport, parseText, stripAnsi } from '../src/main/testing-parse';
import { claudeRun, forgetLogs, isCheckCommand, scanLog } from '../src/main/testing-claude';
import * as store from '../src/main/testing-store';
import { cleanPipeline, repoRoot } from '../src/main/testing-ipc';
import { pipelineScript, resolveRunner, stageFiles, withReporter } from '../src/main/testing-runner';
import {
  FIX_PROMPT_CAP, RUN_CAP, buildFixPrompt, groupByFile, isTestCommand, matchStage, runStateOf, unconfirmed,
  type PipelineConfig, type PipelineRun, type StageResult, type TestCase,
} from '../src/shared/testing';

const FIX = path.join(__dirname, 'fixtures', 'testing');
const fixture = (name: string) => fs.readFileSync(path.join(FIX, name), 'utf8');
const write = (root: string, rel: string, text = '') => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
const ids = (root: string) => detectStack(root).map((s) => s.id);
const failingNames = (tests: TestCase[]) => tests.filter((t) => t.status === 'failed').map((t) => t.name);

afterEach(() => { removeTempDirs(); forgetLogs(); });

describe('detecting what a project tests with', () => {
  it('reads a Node project: runners, e2e, Testing Library, typecheck and lint', () => {
    const root = tempDir();
    write(root, 'package.json', JSON.stringify({
      scripts: { typecheck: 'tsc --noEmit', lint: 'eslint .', test: 'vitest run', 'test:e2e': 'playwright test' },
      devDependencies: { vitest: '^5.0.0', '@playwright/test': '^1.64.0', '@testing-library/react': '^16.0.0', typescript: '^5.9.0', eslint: '^10.0.0', cypress: '^14.0.0', detox: '^20.0.0' },
    }));
    const stack = detectStack(root);
    expect(stack.map((s) => s.id)).toEqual(expect.arrayContaining(['vitest', 'playwright', 'cypress', 'detox', 'testing-library', 'tsc', 'eslint']));
    expect(stack.find((s) => s.id === 'vitest')).toMatchObject({ foundIn: 'package.json', detail: 'vitest ^5.0.0' });
    expect(proposeStages(root, stack).map((s) => [s.name, s.command])).toEqual([
      ['Typecheck', 'npm run typecheck'], ['Lint', 'npm run lint'], ['Unit', 'npm test'], ['E2E', 'npm run test:e2e'], ['Mobile', 'npx detox test'],
    ]);
  });

  it('finds jest and mocha from config files alone, and uses the lockfile’s package manager', () => {
    const root = tempDir();
    write(root, 'package.json', JSON.stringify({ scripts: { test: 'jest' } }));
    write(root, 'jest.config.js', 'module.exports = {}');
    write(root, '.mocharc.json', '{}');
    write(root, 'pnpm-lock.yaml', '');
    expect(ids(root)).toEqual(expect.arrayContaining(['jest', 'mocha']));
    expect(detectStack(root).find((s) => s.id === 'jest')?.foundIn).toBe('jest.config.js');
    expect(proposeStages(root, detectStack(root))[0]).toMatchObject({ name: 'Unit', command: 'pnpm test' });
  });

  it('finds Maestro in .maestro and in YAML flows with an appId elsewhere, never in CI YAML', () => {
    const a = tempDir();
    write(a, '.maestro/login.yaml', 'appId: com.acme.app\n---\n- launchApp\n');
    write(a, '.maestro/checkout.yaml', 'appId: com.acme.app\n---\n- tapOn: Pay\n');
    expect(detectStack(a).find((s) => s.id === 'maestro')).toMatchObject({ foundIn: expect.stringMatching(/^\.maestro\//), detail: '2 flows in .maestro' });
    expect(proposeStages(a, detectStack(a)).at(-1)).toMatchObject({ name: 'Mobile flows', command: 'maestro test .maestro' });
    const b = tempDir();
    write(b, 'e2e/flows/signup.yaml', 'appId: com.acme.app\n---\n- launchApp\n');
    write(b, 'config/app.yaml', 'name: not a flow\n');
    write(b, '.github/workflows/ci.yml', 'appId: nope\njobs: {}\n');
    expect(detectStack(b).find((s) => s.id === 'maestro')).toMatchObject({ foundIn: 'e2e/flows/signup.yaml', detail: '1 flow in e2e/flows' });
  });

  it('finds pytest, tox, go test, cargo, XCTest, Gradle Android tests and k6', () => {
    const py = tempDir();
    write(py, 'pyproject.toml', '[tool.pytest.ini_options]\naddopts = "-q"\n');
    write(py, 'tox.ini', '[tox]\n');
    expect(detectStack(py).map((s) => [s.id, s.foundIn])).toEqual([['pytest', 'pyproject.toml'], ['tox', 'tox.ini']]);
    const go = tempDir();
    write(go, 'go.mod', 'module example.com/acme\n');
    expect(ids(go)).not.toContain('go'); // a module with no tests
    write(go, 'auth/token_test.go', 'package auth\n');
    expect(detectStack(go).find((s) => s.id === 'go')?.detail).toBe('1 *_test.go file, e.g. auth/token_test.go');
    const native = tempDir();
    write(native, 'Cargo.toml', '[package]\nname = "acme"\n');
    fs.mkdirSync(path.join(native, 'Acme.xcodeproj'));
    write(native, 'build.gradle.kts', '');
    fs.mkdirSync(path.join(native, 'app/src/androidTest'), { recursive: true });
    write(native, 'load/checkout.js', "import http from 'k6/http';\nexport default function () {}\n");
    const stack = detectStack(native);
    expect(stack.map((s) => s.id)).toEqual(expect.arrayContaining(['cargo', 'xcodebuild', 'gradle', 'k6']));
    expect(stack.find((s) => s.id === 'gradle')).toMatchObject({ label: 'Gradle and Android tests', kind: 'mobile', foundIn: 'app/src/androidTest' });
    expect(proposeStages(native, stack).map((s) => s.command)).toEqual(expect.arrayContaining(['cargo test', 'xcodebuild test -scheme Acme', 'gradle test', 'k6 run load/checkout.js']));
  });

  it('reads CI hints with the command each workflow runs', () => {
    const root = tempDir();
    write(root, '.github/workflows/ci.yml', 'jobs:\n  test:\n    steps:\n      - run: npm ci\n      - run: npx vitest run --coverage\n');
    write(root, '.github/workflows/release.yml', 'jobs: {}\n');
    expect(detectStack(root).filter((s) => s.kind === 'ci')).toEqual([{ id: 'ci:.github/workflows/ci.yml', label: 'CI', kind: 'ci', foundIn: '.github/workflows/ci.yml', detail: 'runs npx vitest run --coverage' }]);
  });

  it('lists testing skills and agents from the user and project folders, not unrelated ones', () => {
    const claudeDir = tempDir();
    write(claudeDir, 'skills/prove-it/SKILL.md', '---\nname: prove-it\ndescription: Verify that claimed changes actually landed in the running app.\n---\n');
    write(claudeDir, 'skills/deploy/SKILL.md', '---\nname: deploy\ndescription: Ship the app to staging.\n---\n');
    write(claudeDir, 'agents/qa-runner.md', '---\nname: qa-runner\ndescription: Runs the e2e suite and reports failures.\n---\n');
    const project = tempDir();
    write(project, '.claude/commands/smoke.md', 'Run the smoke tests against staging.\n');
    const skills = testingSkills(slashCatalog({ claudeDir, projectDir: path.join(project, '.claude') }));
    expect(skills.map((s) => [s.label, s.kind, s.foundIn, s.insert])).toEqual([
      ['prove-it', 'skill', 'user skills', '/prove-it '],
      ['smoke', 'command', 'project commands', '/smoke '],
      ['qa-runner', 'agent', 'user agents', '@agent-qa-runner '],
    ]);
  });

  it.each([
    ['a prove-it skill', 'Verify that claimed changes actually landed in the running app and inventory what is real vs mocked.'],
    ['a playwright skill', 'Drive the browser with Playwright to click through the signup flow.'],
    ['a QA agent', 'QA agent that runs the regression pack before a release.'],
    ['a deploy check', 'Verify the deploy on staging before announcing it.'],
    ['a hyphenated unit-test skill', 'Write unit-tests for the function you just changed.'],
    ['a prove phrase', 'Prove it works: run the change and show the output.'],
  ])('counts %s as testing software', (_, description) => {
    expect(isAboutTestingSoftware(description)).toBe(true);
  });

  it.each([
    ['a mom-test agent', 'Use after the editor to mom-test the piece against a non-expert reader: would they understand it and keep reading?'],
    ['a stress-test agent', 'Stress-test the argument before it goes out and flag weak claims.'],
    ['an A/B test copywriting skill', 'Write two headline variants to A/B test on the landing page copy.'],
    ['a final QA pass on writing', 'Use after the CTA step for the last QA pass before delivery: a full read of hook, body and CTA as one piece.'],
    ['a fact-checking agent', 'Verify and strengthen technical accuracy: facts, mechanisms, numbers, terminology.'],
    ['an idea-testing skill', 'Test the idea with three customers before building anything.'],
    ['a spec far from any code word', 'Turn a plan / spec / migration doc into an interactive, self-tracking checklist with a markdown source of truth plus a browser mirror.'],
    ['an end-to-end trace', 'Trace a request flow end-to-end across the microservice repos.'],
  ])('does not count %s as testing software', (_, description) => {
    expect(isAboutTestingSoftware(description)).toBe(false);
  });

  it('scores the description, never the name alone', () => {
    const claudeDir = tempDir();
    write(claudeDir, 'agents/mom-test.md', '---\nname: mom-test\ndescription: Read the draft as a newcomer would and say where they get lost.\n---\n');
    write(claudeDir, 'skills/test-utils/SKILL.md', '---\nname: test-utils\ndescription: Helpers for writing vitest cases against the api.\n---\n');
    expect(testingSkills(slashCatalog({ claudeDir, projectDir: null })).map((s) => s.label)).toEqual(['test-utils']);
  });
});

describe('parsers on real runner output', () => {
  const expired = /rejects.an.expired.token/;

  it('vitest JSON report and text', () => {
    const report = parseJestJson(fixture('vitest-report.json'), '/Users/demo/acme', 'vitest');
    expect(report.counts).toEqual({ passed: 4, failed: 1, skipped: 1 });
    expect(failingNames(report.tests)).toEqual(['auth > tokens > rejects an expired token']);
    const failed = report.tests.find((t) => t.status === 'failed');
    expect(failed?.file).not.toMatch(/^\//);
    expect(failed?.failure).toBeTruthy();
    expect(failed?.failure).not.toContain('\u001b');
    const text = parseText(fixture('vitest-output.txt'), 'vitest');
    expect(text).toMatchObject({ runner: 'vitest', counts: { passed: 4, failed: 1, skipped: 1 } });
    expect(text.tests.map((t) => [t.file, t.name])).toEqual([['src/auth.test.js', 'auth > tokens > rejects an expired token']]);
  });

  it('jest JSON report and text', () => {
    const report = parseReport('jest-json', fixture('jest-report.json'), '/Users/demo/acme', 'jest');
    expect(report.counts).toEqual({ passed: 4, failed: 1, skipped: 1 });
    expect(failingNames(report.tests)).toEqual(['auth > tokens > rejects an expired token']);
    const text = parseText(fixture('jest-output.txt'));
    expect(text).toMatchObject({ runner: 'jest', counts: { passed: 4, failed: 1, skipped: 1 } });
    expect(failingNames(text.tests)).toEqual(['auth > tokens > rejects an expired token']);
  });

  it('playwright JSON report and list output', () => {
    const report = parsePlaywrightJson(fixture('playwright-report.json'));
    expect(report.counts).toEqual({ passed: 4, failed: 1, skipped: 1 });
    expect(failingNames(report.tests)).toHaveLength(1);
    expect(failingNames(report.tests)[0]).toMatch(/auth > tokens > rejects an expired token$/);
    expect(report.tests.find((t) => t.status === 'failed')?.failure).toMatch(/toBeGreaterThan/);
    const text = parseText(fixture('playwright-output.txt'), 'playwright');
    expect(text).toMatchObject({ runner: 'playwright', counts: { passed: 4, failed: 1, skipped: 1 } });
    expect(text.tests.map((t) => [t.file, t.name])).toEqual([['tests/auth.spec.js', 'auth > tokens > rejects an expired token']]);
  });

  it('pytest JUnit XML and text', () => {
    const report = parseJUnit(fixture('pytest-junit.xml'), 'pytest');
    expect(report.counts).toEqual({ passed: 4, failed: 1, skipped: 1 });
    expect(report.tests.find((t) => t.status === 'failed')).toMatchObject({ name: 'test_rejects_an_expired_token', file: 'tests.test_auth.TestAuth.TestTokens' });
    expect(report.tests.find((t) => t.status === 'failed')?.failure).toMatch(/1700000000/);
    const text = parseText(fixture('pytest-output.txt'), 'pytest');
    expect(text).toMatchObject({ runner: 'pytest', counts: { passed: 4, failed: 1, skipped: 1 } });
    expect(text.tests.map((t) => [t.file, t.name])).toEqual([['tests/test_auth.py', 'TestAuth > TestTokens > test_rejects_an_expired_token']]);
  });

  it('go test -json and -v text, failing subtests only', () => {
    const report = parseGoJson(fixture('go-test.jsonl'));
    expect(report.counts.failed).toBe(1);
    expect(report.tests.find((t) => t.status === 'failed')).toMatchObject({ name: 'TestTokens/rejects_an_expired_token', file: 'example.com/acme/auth' });
    expect(report.tests.find((t) => t.status === 'failed')?.failure).toBeTruthy();
    expect(new Set(report.tests.map((t) => t.file))).toEqual(new Set(['example.com/acme/auth', 'example.com/acme/mathx']));
    const text = parseText(fixture('go-output.txt'), 'go');
    expect(text.runner).toBe('go');
    expect(failingNames(text.tests)).toEqual(['TestTokens/rejects_an_expired_token']);
    expect(text.counts.passed).toBe(report.counts.passed);
  });

  it('cargo and mocha text', () => {
    const cargo = parseText(fixture('cargo-output.txt'));
    expect(cargo).toMatchObject({ runner: 'cargo', counts: { passed: 4, failed: 1, skipped: 1 } }); // two test binaries, 2 passing each
    expect(failingNames(cargo.tests)).toEqual(['auth::tokens::rejects_an_expired_token']);
    const mocha = parseText(fixture('mocha-output.txt'), 'mocha');
    expect(mocha).toMatchObject({ runner: 'mocha', counts: { passed: 4, failed: 1, skipped: 1 } });
    expect(failingNames(mocha.tests)).toEqual(['auth > tokens > rejects an expired token']);
  });

  // Fixtures captured from Maestro 2.11.0 on an Android emulator running its Wikipedia sample flows.
  describe('Maestro', () => {
    const assertion = 'Assertion is false: "This text is not on screen" is visible';

    it('a folder run, piped and under script(1), with minute-long flows', () => {
      const piped = parseText(fixture('maestro-output.txt'), 'maestro');
      expect(piped).toMatchObject({ runner: 'maestro', counts: { passed: 2, failed: 1, skipped: 0 } });
      expect(piped.tests.find((t) => t.status === 'failed')).toMatchObject({ name: 'android-flow-broken', durationMs: 19000, failure: assertion });
      const tty = parseText(fixture('maestro-tty-output.txt'));
      expect(tty).toMatchObject({ runner: 'maestro', counts: { passed: 2, failed: 1, skipped: 0 } });
      expect(tty.tests.map((t) => [t.name, t.durationMs])).toEqual([['android-advanced-flow', 73000], ['android-flow', 966], ['android-flow-broken', 19000]]);
      expect(tty.tests.find((t) => t.status === 'failed')?.failure).toBe(assertion);
      expect(parseText(fixture('maestro-pass-output.txt'))).toMatchObject({ runner: 'maestro', counts: { passed: 2, failed: 0, skipped: 0 }, durationMs: 59000 });
    });

    it('the summary line alone, passing or failing', () => {
      expect(parseText('1/3 Flow Failed\n', 'maestro').counts).toEqual({ passed: 2, failed: 1, skipped: 0 });
      expect(parseText('3/3 Flows Failed\n', 'maestro').counts).toEqual({ passed: 0, failed: 3, skipped: 0 });
      expect(parseText('2/2 Flows Passed in 1m 8s\n', 'maestro')).toMatchObject({ counts: { passed: 2, failed: 0, skipped: 0 }, durationMs: 68000 });
    });

    it('a single flow, which prints steps instead of a summary', () => {
      for (const name of ['maestro-single-output.txt', 'maestro-single-tty-output.txt']) {
        const single = parseText(fixture(name));
        expect(single, name).toMatchObject({ runner: 'maestro', counts: { passed: 0, failed: 1, skipped: 0 } });
        expect(single.tests[0], name).toMatchObject({ name: 'android-flow-broken', status: 'failed' });
        expect(single.tests[0].failure?.startsWith(`${assertion}\n`), name).toBe(true);
        expect(single.tests[0].failure, name).not.toMatch(/Debug output|\/Users\/demo/);
      }
      expect(parseText(fixture('maestro-single-tty-pass-output.txt'))).toMatchObject({ runner: 'maestro', counts: { passed: 1, failed: 0, skipped: 0 }, tests: [{ name: 'android-flow', status: 'passed' }] });
      expect(parseText('Running on Pixel\n > Flow android-flow\nLaunch app "org.wikipedia"... COMPLETED\n')).toMatchObject({ counts: { passed: 1, failed: 0, skipped: 0 } });
      expect(parseText('Running on Pixel\n > Flow android-flow\nLaunch app "org.wikipedia"...\n').counts).toEqual({ passed: 0, failed: 0, skipped: 0 }); // cut off mid-step
    });

    it('the JUnit report from --format junit', () => {
      const junit = parseJUnit(fixture('maestro-junit.xml'), 'maestro');
      expect(junit).toMatchObject({ counts: { passed: 2, failed: 1, skipped: 0 }, durationMs: 59803 });
      expect(junit.tests.find((t) => t.status === 'failed')).toMatchObject({ name: 'android-flow-broken', file: '.maestro/android-flow-broken.yaml', durationMs: 18635, failure: assertion });
    });
  });

  it('strips what script(1) leaves in a log', () => {
    expect(stripAnsi('\x04\b\bhi\r\n\x1b[?2026l\x1b[32mok\x1b[0m')).toBe('hi\nok');
    expect(expired.test('rejects an expired token')).toBe(true);
  });

  it('groups by file with failures first and open', () => {
    const groups = groupByFile([
      { name: 'a', file: 'one.ts', status: 'passed', durationMs: 1 },
      { name: 'b', file: 'two.ts', status: 'passed', durationMs: 1 },
      { name: 'c', file: 'two.ts', status: 'failed', durationMs: 1 },
    ]);
    expect(groups.map((g) => [g.file, g.failed, g.tests.map((t) => t.name)])).toEqual([['two.ts', true, ['c', 'b']], ['one.ts', false, ['a']]]);
  });
});

describe('Claude’s test runs from the session log', () => {
  const entry = (o: object, at: string) => `${JSON.stringify({ isSidechain: false, timestamp: at, ...o })}\n`;
  const use = (id: string, name: string, input: object) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
  const result = (id: string, content: unknown, is_error = false) => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error }] } });

  it('picks test commands, pairs results, counts edits, reads only what was appended', () => {
    const file = path.join(tempDir(), 's.jsonl');
    fs.writeFileSync(file, entry(use('t1', 'Bash', { command: 'git status' }), '2026-10-16T01:00:00Z')
      + entry(result('t1', 'clean'), '2026-10-16T01:00:01Z')
      + entry(use('e1', 'Edit', { file_path: '/x.ts' }), '2026-10-16T01:00:02Z')
      + entry(use('t2', 'Bash', { command: 'npx vitest run src/auth.test.js' }), '2026-10-16T01:00:03Z')
      + entry(result('t2', `Exit code 1\n${fixture('vitest-output.txt')}`, true), '2026-10-16T01:00:09Z'));
    const first = scanLog(file, 'sess-1');
    expect(first.calls.map((c) => c.command)).toEqual(['npx vitest run src/auth.test.js']);
    expect(first.edits).toBe(1);
    fs.appendFileSync(file, entry(use('t3', 'Bash', { command: 'pytest -q' }), '2026-10-16T01:01:00Z')
      + entry(result('t3', [{ type: 'text', text: fixture('pytest-output.txt') }], true), '2026-10-16T01:01:05Z'));
    expect(scanLog(file, 'sess-1').calls.map((c) => c.id)).toEqual(['t2', 't3']);

    const stages = [{ id: 'unit', name: 'Unit', command: 'npm test' }, { id: 'vitest', name: 'Vitest', command: 'npx vitest run' }];
    const run = claudeRun(first.calls[0], stages);
    expect(run).toMatchObject({ id: 'claude-t2', by: 'claude', state: 'failed', totals: { passed: 4, failed: 1, skipped: 1 }, sessionId: 'sess-1' });
    expect(run.stages[0]).toMatchObject({ stageId: 'vitest', exitCode: 1, runner: 'vitest' });
    expect(failingNames(run.stages[0].tests)).toEqual(['auth > tokens > rejects an expired token']);
    expect(claudeRun(scanLog(file, 'sess-1').calls[1], stages).stages[0]).toMatchObject({ stageId: null, name: 'Claude’s run' });
    // "npm test" running vitest is the stage for Claude's "npx vitest run".
    expect(claudeRun(first.calls[0], [stages[0]], { test: 'vitest run' }).stages[0].stageId).toBe('unit');
  });

  it('knows a test, typecheck or lint command from anything else', () => {
    for (const c of ['npm test', 'pnpm run test:e2e', 'npx vitest run', 'go test ./...', 'cargo test', 'maestro test .maestro', 'python -m pytest -q', 'npx playwright test', './gradlew connectedAndroidTest'])
      expect(isTestCommand(c), c).toBe(true);
    for (const c of ['npm run typecheck', 'npx tsc --noEmit', 'npm run lint']) expect(isCheckCommand(c), c).toBe(true);
    for (const c of ['git status', 'ls test', 'cat vitest.config.ts', 'npm install']) expect(isCheckCommand(c), c).toBe(false);
    const stages = [{ id: 'tc', name: 'Typecheck', command: 'npm run typecheck' }, { id: 'unit', name: 'Unit', command: 'npm test' }];
    expect(matchStage('npm run typecheck', stages)?.id).toBe('tc');
    expect(matchStage('npm test -- auth', stages)?.id).toBe('unit');
    expect(matchStage('pytest', stages)).toBeNull();
  });
});

describe('history per project', () => {
  const stage = (tests: TestCase[]): StageResult => ({ stageId: 'unit', name: 'Unit', command: 'npm test', status: 'passed', exitCode: 0, durationMs: 10, counts: { passed: tests.length, failed: 0, skipped: 0 }, tests, output: '', runner: 'vitest' });
  const run = (i: number): PipelineRun => ({ id: `r${i}`, by: 'you', trigger: 'click', startedAt: 1_000_000 + i, finishedAt: 1_000_001 + i, state: 'passed', totals: { passed: 2, failed: 0, skipped: 0 }, stages: [stage([{ name: 'a', file: 'f', status: 'passed', durationMs: 1 }, { name: 'b', file: 'f', status: 'failed', durationMs: 1 }])] });

  it('caps at 200 runs, newest first, and trims tests of older runs to the failing ones', () => {
    useTempUserData();
    const root = '/Users/demo/acme';
    for (let i = 0; i < RUN_CAP + 10; i += 1) store.putRun(root, run(i));
    const data = store.load(root);
    expect(data.runs).toHaveLength(RUN_CAP);
    expect(data.runs[0].id).toBe(`r${RUN_CAP + 9}`);
    expect(data.runs[0].stages[0].tests).toHaveLength(2);
    expect(data.runs.at(-1)?.stages[0].tests.map((t) => t.name)).toEqual(['b']);
  });

  it('keeps each project in its own file and ignores a file for another folder', () => {
    const dir = useTempUserData();
    store.putRun('/Users/demo/acme', run(1));
    store.putRun('/Users/demo/other', run(2));
    expect(store.load('/Users/demo/acme').runs.map((r) => r.id)).toEqual(['r1']);
    expect(store.load('/Users/demo/other').runs.map((r) => r.id)).toEqual(['r2']);
    expect(fs.readdirSync(path.join(dir, 'testing')).filter((f) => f.endsWith('.json'))).toHaveLength(2);
    fs.copyFileSync(store.projectFile('/Users/demo/acme'), store.projectFile('/Users/demo/third'));
    expect(store.load('/Users/demo/third').runs).toEqual([]);
  });

  it('finds the repo root above a folder', () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, '.git'));
    fs.mkdirSync(path.join(root, 'packages/app'), { recursive: true });
    expect(repoRoot(path.join(root, 'packages/app'))).toBe(root);
  });
});

describe('Ask Claude to fix', () => {
  const failing = (failure: string): TestCase => ({ name: 'auth > tokens > rejects an expired token', file: 'src/auth.test.js', status: 'failed', durationMs: 3, failure });

  it('names the test, file and command, with the output in a fence', () => {
    const prompt = buildFixPrompt({ stage: 'Unit', command: 'npm test', tests: [failing('AssertionError: expected true to be false')] });
    expect(prompt).toContain('"auth > tokens > rejects an expired token" in src/auth.test.js');
    expect(prompt).toContain('`npm test`');
    expect(prompt).toMatch(/```\nAssertionError: expected true to be false\n```$/);
  });

  it('stays under the cap with huge output, keeping the end of it', () => {
    const huge = `${'noise line\n'.repeat(2000)}the real error at the end`;
    const one = buildFixPrompt({ stage: 'Unit', command: 'npm test', tests: [failing(huge)] });
    expect(one.length).toBeLessThanOrEqual(FIX_PROMPT_CAP);
    expect(one).toContain('the real error at the end');
    const many = buildFixPrompt({ stage: 'Unit', command: 'npm test', tests: Array.from({ length: 30 }, () => failing(huge)) });
    expect(many.length).toBeLessThanOrEqual(FIX_PROMPT_CAP);
    expect(many).toContain('30 failing tests');
  });

  it('uses the stage output for a failure with no tests, like a typecheck', () => {
    const prompt = buildFixPrompt({ stage: 'Typecheck', command: 'npm run typecheck', tests: [], output: "src/a.ts(3,1): error TS2304: Cannot find name 'x'." });
    expect(prompt).toContain('The Typecheck stage fails (`npm run typecheck`)');
    expect(prompt).toContain('TS2304');
  });
});

describe('confirm once, remember, and run', () => {
  const pipeline: PipelineConfig = { stages: [{ id: 'unit', name: 'Unit', command: 'npm test' }, { id: 'e2e', name: 'E2E', command: 'npx playwright test' }], keepGoing: false, autoRun: false, confirmed: ['npm test'] };

  it('asks only for commands not confirmed before, ignoring spacing', () => {
    expect(unconfirmed(pipeline, pipeline.stages).map((s) => s.id)).toEqual(['e2e']);
    expect(unconfirmed({ ...pipeline, confirmed: ['npm test', 'npx playwright  test'] }, pipeline.stages)).toEqual([]);
  });

  it('a saved pipeline keeps the confirmations main recorded, never the renderer’s', () => {
    const saved = cleanPipeline({ ...pipeline, confirmed: ['rm -rf /'], autoRun: true }, pipeline);
    expect(saved).toMatchObject({ confirmed: ['npm test'], autoRun: true });
    expect(cleanPipeline({ ...pipeline, stages: [{ id: 'x', name: 'X', command: 'echo a\nrm -rf /' }] }, null)).toBeNull();
    expect(cleanPipeline({ ...pipeline, stages: [{ id: 'x', name: '', command: 'npm test' }] }, null)).toBeNull();
  });

  it('adds a machine reporter per runner, through package scripts too', () => {
    const scripts = { test: 'vitest run', 'test:e2e': 'playwright test', unit: 'jest' };
    expect(resolveRunner('npm test', scripts)).toMatchObject({ runner: 'vitest', viaNpm: true });
    expect(withReporter('npm test', scripts, '/r/s1', '/r/s1.log')).toMatchObject({ exec: "npm test -- --reporter=default --reporter=json --outputFile.json='/r/s1.json'", report: { kind: 'vitest-json', file: '/r/s1.json' } });
    expect(withReporter('pnpm run unit', scripts, '/r/s1', '/r/s1.log').exec).toBe("pnpm run unit --json --outputFile='/r/s1.json'");
    expect(withReporter('npm run test:e2e', scripts, '/r/s1', '/r/s1.log').exec).toBe("PLAYWRIGHT_JSON_OUTPUT_NAME='/r/s1.json' npm run test:e2e -- --reporter=list,json");
    expect(withReporter('pytest -q', {}, '/r/s1', '/r/s1.log')).toMatchObject({ exec: "pytest -q --junitxml='/r/s1.xml'", report: { kind: 'junit' } });
    expect(withReporter('go test ./...', {}, '/r/s1', '/r/s1.log')).toMatchObject({ exec: 'go test -json ./...', report: { kind: 'go-json', file: '/r/s1.log' } });
    expect(withReporter('maestro test .maestro', {}, '/r/s1', '/r/s1.log').exec).toBe("maestro test .maestro --format junit --output '/r/s1.xml'");
    expect(withReporter('npx vitest run --reporter=dot', {}, '/r/s1', '/r/s1.log')).toMatchObject({ exec: 'npx vitest run --reporter=dot', report: null });
    expect(withReporter('cargo test', {}, '/r/s1', '/r/s1.log').report).toBeNull();
  });

  it('the pipeline script writes each stage’s exit code and stops at a failure unless told to keep going', () => {
    const go = (keepGoing: boolean) => {
      const dir = tempDir('petal-pipeline-');
      const commands = ['echo one', 'exit 3', 'echo three'];
      const stages = commands.map((command, i) => ({ name: `S${i + 1}`, command, exec: command, ...stageFiles(dir, i) }));
      const done = path.join(dir, 'done');
      const script = path.join(dir, 'pipeline.sh');
      fs.writeFileSync(script, pipelineScript({ root: dir, stages, keepGoing, done }));
      try { execFileSync('/bin/sh', [script], { stdio: ['ignore', 'pipe', 'pipe'] }); } catch { /* exits with the failed stage's code when stopping */ }
      const read = (f: string) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim() : null);
      return { exits: stages.map((s) => read(s.exit)), done: read(done), log: read(stages[0].log) ?? '' };
    };
    const stop = go(false);
    expect(stop.exits).toEqual(['0', '3', null]);
    expect(stop.done).toBe('3');
    expect(stripAnsi(stop.log)).toContain('one');
    expect(go(true)).toMatchObject({ exits: ['0', '3', '0'], done: '1' });
  });

  it('a run’s state follows its stages', () => {
    const s = (status: StageResult['status']) => ({ status }) as StageResult;
    expect(runStateOf([s('passed'), s('running')])).toBe('running');
    expect(runStateOf([s('passed'), s('failed'), s('skipped')])).toBe('failed');
    expect(runStateOf([s('passed'), s('passed')])).toBe('passed');
  });
});

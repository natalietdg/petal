import { describe, expect, it } from 'vitest';
import { coreCommand, isFlaky, suiteHealth, touchesChanged, withCoreStage, CORE_STAGE_ID, FLAKY_WINDOW_MS } from '../src/shared/suite-health';
import type { PipelineRun, TestCase, TestStatus } from '../src/shared/testing';

const MIN = 60_000;
const HOUR = 60 * MIN;
let n = 0;
const test = (file: string, name: string, status: TestStatus, durationMs: number | null = 10): TestCase => ({ file, name, status, durationMs });
// One finished run at `at` ms with these tests, one vitest stage.
function run(at: number, tests: TestCase[], runner = 'vitest', by: PipelineRun['by'] = 'you'): PipelineRun {
  n += 1;
  const failed = tests.filter((t) => t.status === 'failed').length;
  const passed = tests.filter((t) => t.status === 'passed').length;
  return {
    id: `r${n}`, by, trigger: 'click', startedAt: at, finishedAt: at + 1000, state: failed ? 'failed' : 'passed', totals: { passed, failed, skipped: 0 },
    stages: [{ stageId: 'unit', name: 'Unit', command: 'npm test', status: failed ? 'failed' : 'passed', exitCode: failed ? 1 : 0, durationMs: 1000, counts: { passed, failed, skipped: 0 }, tests, output: '', runner }],
  };
}

// Twelve runs over twelve hours: retry flips within minutes, totals failed once early, theme always passes,
// "renders" exists in two files, e2e is slow.
function fixture(): PipelineRun[] {
  const runs: PipelineRun[] = [];
  for (let i = 0; i < 12; i += 1) {
    const at = i * HOUR;
    runs.push(run(at, [
      test('src/api/client.test.ts', 'client > retries a 503', i === 6 ? 'failed' : 'passed'),
      test('src/cart/totals.test.ts', 'totals > rounds per line', i === 2 ? 'failed' : 'passed'),
      test('src/theme.test.ts', 'theme > renders', 'passed', 4),
      test('src/settings.test.ts', 'settings > renders', 'passed', 5),
      test('e2e/checkout.test.ts', 'checkout > pays', 'passed', 4200 + i),
    ]));
  }
  // The retry test fails then passes again five minutes later, on the same code.
  runs.push(run(6 * HOUR + 5 * MIN, [test('src/api/client.test.ts', 'client > retries a 503', 'passed')], 'vitest', 'claude'));
  return runs.reverse(); // newest first, as the store keeps them
}

describe('flaky', () => {
  const seen = (pattern: string, gapMs: number) => [...pattern].map((c, i) => ({ status: (c === 'p' ? 'passed' : 'failed') as TestStatus, at: i * gapMs, durationMs: null }));
  it('is a pass and a fail close together, or a result that keeps changing', () => {
    expect(isFlaky(seen('pf', 5 * MIN))).toBe(true);
    expect(isFlaky(seen('pf', FLAKY_WINDOW_MS + 1))).toBe(false); // far apart: the code likely changed
    expect(isFlaky(seen('pfpf', 2 * HOUR))).toBe(true); // three flips
    expect(isFlaky(seen('ppppfff', 2 * HOUR))).toBe(false); // broke once and stayed broken
    expect(isFlaky(seen('pppp', MIN))).toBe(false);
  });
  it('finds the retry test in the history, not the one that failed once hours apart', () => {
    const health = suiteHealth({ runs: fixture() });
    expect(health.flaky.map((t) => t.name)).toEqual(['client > retries a 503']);
    expect(health.flaky[0]).toMatchObject({ passes: 12, fails: 1 });
  });
});

describe('never failing, slowest, duplicates', () => {
  const health = suiteHealth({ runs: fixture() });
  it('lists tests that passed every one of ten or more runs', () => {
    expect(health.steady.map((t) => t.name).sort()).toEqual(['checkout > pays', 'settings > renders', 'theme > renders']);
    expect(health.steady.every((t) => t.runs === 12)).toBe(true);
  });
  it('puts the slow e2e test first by median time', () => {
    expect(health.slowest[0]).toMatchObject({ name: 'checkout > pays', medianMs: 4206 });
  });
  it('flags the same title in two files', () => {
    expect(health.duplicates).toEqual([{ title: 'renders', files: ['src/settings.test.ts', 'src/theme.test.ts'] }]);
  });
  it('needs ten runs before calling anything steady', () => {
    expect(suiteHealth({ runs: fixture().slice(0, 5) }).steady).toEqual([]);
  });
  it('ignores a run still going and reads nothing from an empty history', () => {
    const running = { ...run(99 * HOUR, [test('src/x.test.ts', 'x', 'failed')]), state: 'running' as const };
    expect(suiteHealth({ runs: [running] }).runsRead).toBe(0);
    expect(suiteHealth({ runs: [] })).toMatchObject({ runsRead: 0, core: [], command: null });
  });
});

describe('core stage', () => {
  it('takes tests that failed recently plus tests touching changed files, as one vitest file list', () => {
    const health = suiteHealth({ runs: fixture(), changed: ['src/settings.ts', 'README.md'] });
    expect(health.core.map((t) => [t.file, t.why])).toEqual([
      ['src/api/client.test.ts', 'failed'],
      ['src/cart/totals.test.ts', 'failed'],
      ['src/settings.test.ts', 'changed'],
    ]);
    expect(health.command).toBe('npx vitest run src/api/client.test.ts src/cart/totals.test.ts src/settings.test.ts');
  });
  it('matches a changed test file or its source by name', () => {
    expect(touchesChanged('src/cart/totals.test.ts', ['src/cart/totals.ts'])).toBe(true);
    expect(touchesChanged('tests/test_billing.py', ['app/billing.py'])).toBe(true);
    expect(touchesChanged('src/cart/totals.test.ts', ['./src/cart/totals.test.ts'])).toBe(true);
    expect(touchesChanged('src/cart/totals.test.ts', ['src/cart/tax.ts'])).toBe(false);
    expect(touchesChanged('src/a.test.ts', [])).toBe(false);
  });
  it('drops a failure older than the newest twenty runs', () => {
    const runs: PipelineRun[] = [run(0, [test('src/old.test.ts', 'old', 'failed')])];
    for (let i = 1; i <= 25; i += 1) runs.push(run(i * HOUR, [test('src/old.test.ts', 'old', 'passed')]));
    expect(suiteHealth({ runs: runs.reverse() }).core).toEqual([]);
  });
});

describe('core command per runner', () => {
  const t = (file: string, name: string) => ({ file, name, runner: null });
  it('uses file lists where the runner filters by path', () => {
    expect(coreCommand('vitest', [t('src/a.test.ts', 'a > one'), t('src/a.test.ts', 'a > two'), t('src/b c.test.ts', 'b')])).toBe("npx vitest run src/a.test.ts 'src/b c.test.ts'");
    expect(coreCommand('jest', [t('src/a.test.js', 'a')])).toBe('npx jest --runTestsByPath src/a.test.js');
    expect(coreCommand('playwright', [t('e2e/pay.spec.ts', 'pays')])).toBe('npx playwright test e2e/pay.spec.ts');
    expect(coreCommand('pytest', [t('tests/test_cart.py', 'test_total')])).toBe('python -m pytest tests/test_cart.py');
    expect(coreCommand('mocha', [t('test/a.js', 'a')])).toBe('npx mocha test/a.js');
  });
  it('falls back to names when a test has no file path', () => {
    expect(coreCommand('vitest', [t('auth suite', 'auth > rejects (expired) token')])).toBe("npx vitest run -t 'rejects \\(expired\\) token'");
    expect(coreCommand('jest', [t('Cart', 'Cart > adds'), t('Cart', 'Cart > removes')])).toBe("npx jest -t 'adds|removes'");
    expect(coreCommand('pytest', [t('TestCart', 'test_adds'), t('TestCart', 'test_removes')])).toBe("python -m pytest -k 'test_adds or test_removes'");
  });
  it('builds go test -run over packages, and nothing for runners without a filter', () => {
    expect(coreCommand('go', [t('./cart', 'TestTotal'), t('./api', 'TestRetry')])).toBe("go test ./cart ./api -run '^(TestTotal|TestRetry)$'");
    expect(coreCommand('cargo', [t('src/lib.rs', 'adds')])).toBeNull();
    expect(coreCommand(null, [t('a.test.ts', 'a')])).toBeNull();
    expect(coreCommand('vitest', [])).toBeNull();
  });
  it('joins runners and names the ones it cannot filter', () => {
    const runs = [run(2 * HOUR, [test('src/a.test.ts', 'a', 'failed')]), run(HOUR, [test('tests/test_b.py', 'test_b', 'failed')], 'pytest'), run(0, [test('src/lib.rs', 'c', 'failed')], 'cargo')];
    const health = suiteHealth({ runs });
    expect(health.command).toBe('npx vitest run src/a.test.ts && python -m pytest tests/test_b.py');
    expect(health.unfiltered).toEqual(['cargo']);
  });
});

describe('withCoreStage', () => {
  it('puts core first and replaces an older one', () => {
    const stages = [{ id: 'typecheck', name: 'Typecheck', command: 'tsc' }, { id: CORE_STAGE_ID, name: 'Core', command: 'old' }, { id: 'unit', name: 'Unit', command: 'npm test' }];
    expect(withCoreStage(stages, 'npx vitest run a.test.ts').map((s) => [s.id, s.command])).toEqual([['core', 'npx vitest run a.test.ts'], ['typecheck', 'tsc'], ['unit', 'npm test']]);
  });
});

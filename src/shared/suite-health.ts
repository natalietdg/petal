// Suite health: from a project's run history (hers and Claude's), which tests are flaky, which never fail,
// which are slowest, which look duplicated, and a fast "core" stage to run first. It only recommends; nothing deletes a test.
import type { PipelineRun, TestStatus } from './testing';

export const FLAKY_WINDOW_MS = 30 * 60 * 1000; // a pass and a fail this close together is the same code, near enough
export const FLAKY_FLIPS = 3; // or the result changed this many times across the history
export const STEADY_RUNS = 10; // seen this many times, never failed
export const RECENT_FAIL_RUNS = 20; // a failure in the newest runs this many makes a test core
export const SLOW_SHOWN = 5;
export const LIST_CAP = 8;
export const CORE_CAP = 60; // tests in a core command

export interface TestRef { file: string; name: string; runner: string | null }
export interface FlakyTest extends TestRef { passes: number; fails: number; flips: number }
export interface SteadyTest extends TestRef { runs: number }
export interface SlowTest extends TestRef { medianMs: number; runs: number }
export interface DuplicateTest { title: string; files: string[] }
export interface CoreTest extends TestRef { why: 'failed' | 'changed' | 'both' }
export interface CoreCommand { runner: string; command: string; tests: number }

export interface SuiteHealth {
  runsRead: number;
  flaky: FlakyTest[];
  steady: SteadyTest[];
  slowest: SlowTest[];
  duplicates: DuplicateTest[];
  core: CoreTest[];
  commands: CoreCommand[];
  unfiltered: string[]; // runners in the core that have no filter Petal can build
  command: string | null; // the core stage's command, every runner's part joined
}

interface Seen { status: TestStatus; at: number; durationMs: number | null }
interface Track extends TestRef { seen: Seen[] }

const keyOf = (file: string, name: string): string => `${file}\u0000${name}`;
const titleOf = (name: string): string => name.split(/\s+[>›]\s+/).pop()?.trim() ?? name;
const stem = (file: string): string => (file.split(/[\\/]/).pop() ?? file).replace(/\.(test|spec)(?=\.)|(_test|_spec)(?=\.)|^test_/g, '').replace(/\.[^.]+$/, '').toLowerCase();

// Every test's results across finished runs, oldest first.
function tracks(runs: readonly PipelineRun[]): Map<string, Track> {
  const out = new Map<string, Track>();
  const finished = runs.filter((r) => r.state !== 'running').sort((a, b) => a.startedAt - b.startedAt);
  for (const run of finished) {
    for (const stage of run.stages) {
      for (const test of stage.tests) {
        if (test.status === 'skipped') continue;
        const key = keyOf(test.file, test.name);
        const track = out.get(key) ?? { file: test.file, name: test.name, runner: stage.runner, seen: [] };
        track.seen.push({ status: test.status, at: run.startedAt, durationMs: test.durationMs });
        track.runner ??= stage.runner;
        out.set(key, track);
      }
    }
  }
  return out;
}

const flipsOf = (seen: readonly Seen[]): number => seen.reduce((n, s, i) => n + (i && s.status !== seen[i - 1].status ? 1 : 0), 0);

// Passed and failed within the window of each other, or kept changing its result.
export function isFlaky(seen: readonly Seen[], windowMs = FLAKY_WINDOW_MS): boolean {
  if (flipsOf(seen) >= FLAKY_FLIPS) return true;
  for (let i = 1; i < seen.length; i += 1) if (seen[i].status !== seen[i - 1].status && seen[i].at - seen[i - 1].at <= windowMs) return true;
  return false;
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

// A test file, or the source file it tests, is among the recently changed files.
export function touchesChanged(file: string, changed: readonly string[]): boolean {
  if (!changed.length || !file) return false;
  const norm = (f: string) => f.replace(/\\/g, '/').replace(/^\.\//, '');
  const target = norm(file);
  const own = stem(target);
  return changed.some((c) => { const n = norm(c); return n === target || target.endsWith(`/${n}`) || n.endsWith(`/${target}`) || (own.length > 2 && stem(n) === own); });
}

const quote = (arg: string): string => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`);
const regexEscape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const looksLikePath = (file: string): boolean => /\.[a-z0-9]+$/i.test(file);

// One runner's part of the core stage: files where the runner filters by path, names where it filters by title.
export function coreCommand(runner: string | null, tests: readonly TestRef[]): string | null {
  if (!runner || !tests.length) return null;
  const files = [...new Set(tests.map((t) => t.file).filter(looksLikePath))];
  const titles = [...new Set(tests.map((t) => titleOf(t.name)))];
  const byFiles = (base: string) => (files.length === new Set(tests.map((t) => t.file)).size && files.length ? `${base} ${files.map(quote).join(' ')}` : null);
  switch (runner) {
    case 'vitest': return byFiles('npx vitest run') ?? `npx vitest run -t ${quote(titles.map(regexEscape).join('|'))}`;
    case 'jest': return byFiles('npx jest --runTestsByPath') ?? `npx jest -t ${quote(titles.map(regexEscape).join('|'))}`;
    case 'playwright': return byFiles('npx playwright test') ?? `npx playwright test -g ${quote(titles.map(regexEscape).join('|'))}`;
    case 'mocha': return byFiles('npx mocha') ?? `npx mocha -g ${quote(titles.map(regexEscape).join('|'))}`;
    case 'pytest': return byFiles('python -m pytest') ?? `python -m pytest -k ${quote(titles.join(' or '))}`;
    case 'go': {
      const packages = [...new Set(tests.map((t) => t.file).filter(Boolean))];
      return `go test ${packages.length ? packages.map(quote).join(' ') : './...'} -run ${quote(`^(${titles.map(regexEscape).join('|')})$`)}`;
    }
    default: return null; // cargo takes one filter, others have none Petal knows
  }
}

export interface HealthInput { runs: readonly PipelineRun[]; changed?: readonly string[] }

export function suiteHealth({ runs, changed = [] }: HealthInput): SuiteHealth {
  const all = [...tracks(runs).values()];
  const finished = runs.filter((r) => r.state !== 'running');
  const recentCutoff = [...finished].sort((a, b) => b.startedAt - a.startedAt)[Math.min(RECENT_FAIL_RUNS, finished.length) - 1]?.startedAt ?? 0;

  const flaky = all.filter((t) => isFlaky(t.seen))
    .map((t) => ({ file: t.file, name: t.name, runner: t.runner, passes: t.seen.filter((s) => s.status === 'passed').length, fails: t.seen.filter((s) => s.status === 'failed').length, flips: flipsOf(t.seen) }))
    .sort((a, b) => b.flips - a.flips || b.fails - a.fails).slice(0, LIST_CAP);

  const steady = all.filter((t) => t.seen.length >= STEADY_RUNS && t.seen.every((s) => s.status === 'passed'))
    .map((t) => ({ file: t.file, name: t.name, runner: t.runner, runs: t.seen.length })).sort((a, b) => b.runs - a.runs);

  const slowest = all.map((t) => ({ t, times: t.seen.map((s) => s.durationMs).filter((ms): ms is number => ms !== null && ms > 0) }))
    .filter(({ times }) => times.length).map(({ t, times }) => ({ file: t.file, name: t.name, runner: t.runner, medianMs: median(times), runs: times.length }))
    .sort((a, b) => b.medianMs - a.medianMs).slice(0, SLOW_SHOWN);

  // The same test title in more than one file.
  const titles = new Map<string, { title: string; files: Set<string> }>();
  for (const t of all) {
    const title = titleOf(t.name);
    if (!title) continue;
    const entry = titles.get(title.toLowerCase()) ?? { title, files: new Set<string>() };
    entry.files.add(t.file);
    titles.set(title.toLowerCase(), entry);
  }
  const duplicates = [...titles.values()].filter((d) => d.files.size > 1).map((d) => ({ title: d.title, files: [...d.files].sort() }))
    .sort((a, b) => b.files.length - a.files.length || a.title.localeCompare(b.title)).slice(0, LIST_CAP);

  // Core: failed in the newest runs, or its file (or the file it tests) changed recently.
  const core: CoreTest[] = [];
  for (const t of all) {
    const failed = t.seen.some((s) => s.status === 'failed' && s.at >= recentCutoff);
    const touched = touchesChanged(t.file, changed);
    if (failed || touched) core.push({ file: t.file, name: t.name, runner: t.runner, why: failed && touched ? 'both' : failed ? 'failed' : 'changed' });
  }
  const rank: Record<CoreTest['why'], number> = { both: 0, failed: 1, changed: 2 };
  core.sort((a, b) => rank[a.why] - rank[b.why] || a.file.localeCompare(b.file));
  const kept = core.slice(0, CORE_CAP);

  const runners = [...new Set(kept.map((t) => t.runner ?? ''))];
  const commands: CoreCommand[] = [];
  const unfiltered: string[] = [];
  for (const runner of runners) {
    const tests = kept.filter((t) => (t.runner ?? '') === runner);
    const command = coreCommand(runner || null, tests);
    if (command) commands.push({ runner, command, tests: tests.length }); else unfiltered.push(runner || 'unknown runner');
  }
  return {
    runsRead: finished.length, flaky, steady: steady.slice(0, LIST_CAP), slowest, duplicates, core: kept, commands, unfiltered,
    command: commands.length ? commands.map((c) => c.command).join(' && ') : null,
  };
}

export const CORE_STAGE_ID = 'core';
export const CORE_STAGE_NAME = 'Core';

// The pipeline with the core stage first; an older core stage is replaced, never added twice.
export function withCoreStage<T extends { id: string; name: string; command: string }>(stages: readonly T[], command: string): { id: string; name: string; command: string }[] {
  return [{ id: CORE_STAGE_ID, name: CORE_STAGE_NAME, command }, ...stages.filter((s) => s.id !== CORE_STAGE_ID)];
}

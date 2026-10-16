// Turns test runner output into tests and counts: machine reports first (Jest-style JSON, Playwright JSON,
// JUnit XML, go test -json), then the summary lines each runner prints, for runs Petal didn't add a reporter to.
import path from 'node:path';
import { countTests, emptyCounts, OUTPUT_KEEP, trimOutput, type Counts, type TestCase, type TestStatus } from '../shared/testing';

export interface Parsed {
  runner: string | null;
  tests: TestCase[]; // may hold only the failing ones when the output names no others
  counts: Counts;
  durationMs: number | null;
}

const FAILURE_CAP = 2000;
const NONE: Parsed = { runner: null, tests: [], counts: emptyCounts(), durationMs: null };

// ANSI colours, cursor moves, and the ^D and backspaces script(1) leaves in its log.
// eslint-disable-next-line no-control-regex -- stripping terminal control codes is the point
export const stripAnsi = (text: string): string => text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, '').replace(/[\x04\x08]/g, '').replace(/\r\n?/g, '\n');

// Inside the project: relative to it; anywhere else the path stays as the runner wrote it.
const relativeTo = (root: string | null, file: string): string => {
  if (!root || !path.isAbsolute(file)) return file;
  const relative = path.relative(root, file);
  return relative && !relative.startsWith('..') ? relative : file;
};
const failure = (text: string): string | undefined => (text.trim() ? trimOutput(stripAnsi(text), FAILURE_CAP) : undefined);
const ms = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null);

// ---- Jest and Vitest share the Jest JSON shape: testResults[].assertionResults[].
interface JestAssertion { ancestorTitles?: string[]; title?: string; fullName?: string; status?: string; duration?: number | null; failureMessages?: string[] }
interface JestFile { name?: string; testFilePath?: string; assertionResults?: JestAssertion[]; message?: string; status?: string; startTime?: number; endTime?: number }
interface JestReport { testResults?: JestFile[]; startTime?: number }

const jestStatus = (status: string | undefined): TestStatus => (status === 'passed' ? 'passed' : status === 'failed' ? 'failed' : 'skipped');

export function parseJestJson(text: string, root: string | null, runner = 'jest'): Parsed {
  const report = JSON.parse(text) as JestReport;
  const tests: TestCase[] = [];
  let end = 0;
  for (const file of report.testResults ?? []) {
    const name = relativeTo(root, file.name ?? file.testFilePath ?? 'tests');
    end = Math.max(end, file.endTime ?? 0);
    const assertions = file.assertionResults ?? [];
    // A file that failed to load has no assertions, only a message.
    if (!assertions.length && file.status === 'failed') tests.push({ name: 'file failed to run', file: name, status: 'failed', durationMs: null, failure: failure(file.message ?? '') });
    for (const a of assertions) {
      const title = [...(a.ancestorTitles ?? []), a.title ?? ''].filter(Boolean).join(' > ') || a.fullName || 'test';
      const status = jestStatus(a.status);
      tests.push({ name: title, file: name, status, durationMs: ms(a.duration), ...(status === 'failed' ? { failure: failure((a.failureMessages ?? []).join('\n')) } : {}) });
    }
  }
  const durationMs = report.startTime && end > report.startTime ? Math.round(end - report.startTime) : null;
  return { runner, tests, counts: countTests(tests), durationMs };
}

// ---- Playwright JSON: suites nest, specs hold tests per project, each with results per retry.
interface PwResult { status?: string; duration?: number; error?: { message?: string; stack?: string }; errors?: { message?: string }[] }
interface PwTest { projectName?: string; status?: string; results?: PwResult[] }
interface PwSpec { title?: string; file?: string; tests?: PwTest[] }
interface PwSuite { title?: string; file?: string; specs?: PwSpec[]; suites?: PwSuite[] }
interface PwReport { suites?: PwSuite[]; stats?: { duration?: number } }

export function parsePlaywrightJson(text: string): Parsed {
  const report = JSON.parse(text) as PwReport;
  const tests: TestCase[] = [];
  const walk = (suite: PwSuite, titles: string[], file: string) => {
    const here = suite.file ?? file;
    const own = suite.title && suite.title !== here && suite.title !== path.basename(here) ? [...titles, suite.title] : titles;
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const last = test.results?.at(-1);
        const status: TestStatus = test.status === 'skipped' ? 'skipped' : test.status === 'unexpected' ? 'failed' : 'passed';
        const project = test.projectName ? `[${test.projectName}] ` : '';
        const message = last?.error?.message ?? last?.errors?.map((e) => e.message ?? '').join('\n') ?? '';
        tests.push({ name: `${project}${[...own, spec.title ?? 'test'].join(' > ')}`, file: spec.file ?? here, status, durationMs: ms(last?.duration), ...(status === 'failed' ? { failure: failure(message) } : {}) });
      }
    }
    for (const child of suite.suites ?? []) walk(child, own, here);
  };
  for (const suite of report.suites ?? []) walk(suite, [], suite.file ?? suite.title ?? 'tests');
  return { runner: 'playwright', tests, counts: countTests(tests), durationMs: ms(report.stats?.duration) };
}

// ---- JUnit XML (pytest --junitxml, maestro --format junit, and most CI tools). A small reader, no XML library.
const decode = (text: string): string => text
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&');

const attrs = (tag: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) out[m[1]] = decode(m[3] ?? m[4] ?? '');
  return out;
};

export function parseJUnit(xml: string, runner: string | null): Parsed {
  const tests: TestCase[] = [];
  let durationMs = 0;
  for (const suite of xml.matchAll(/<testsuite\b([^>]*?)(\/>|>([\s\S]*?)<\/testsuite>)/g)) {
    const suiteAttrs = attrs(suite[1]);
    durationMs += Math.round(Number(suiteAttrs.time ?? 0) * 1000) || 0;
    for (const c of (suite[3] ?? '').matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)) {
      const a = attrs(c[1]);
      const body = c[3] ?? '';
      const bad = /<(failure|error)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/.exec(body);
      const skipped = /<skipped\b/.test(body);
      const status: TestStatus = bad ? 'failed' : skipped ? 'skipped' : 'passed';
      const message = bad ? [attrs(bad[2]).message ?? '', decode(bad[4] ?? '')].filter(Boolean).join('\n') : '';
      const group = a.file || a.classname || suiteAttrs.name || 'tests';
      tests.push({ name: a.name || 'test', file: group, status, durationMs: a.time ? Math.round(Number(a.time) * 1000) : null, ...(bad ? { failure: failure(message) } : {}) });
    }
  }
  return { runner, tests, counts: countTests(tests), durationMs: durationMs || null };
}

// ---- go test -json: one event per line; a test's output lines are its failure text.
interface GoEvent { Action?: string; Package?: string; Test?: string; Elapsed?: number; Output?: string }

export function parseGoJson(text: string): Parsed {
  const tests = new Map<string, TestCase & { out: string[] }>();
  let durationMs = 0;
  for (const line of text.split('\n')) {
    if (!line.startsWith('{')) continue;
    let event: GoEvent;
    try { event = JSON.parse(line) as GoEvent; } catch { continue; }
    if (!event.Test) {
      if ((event.Action === 'pass' || event.Action === 'fail') && typeof event.Elapsed === 'number') durationMs += event.Elapsed * 1000;
      continue;
    }
    const key = `${event.Package}\n${event.Test}`;
    const test = tests.get(key) ?? { name: event.Test, file: event.Package ?? 'go', status: 'passed' as TestStatus, durationMs: null, out: [] };
    tests.set(key, test);
    if (event.Action === 'output' && event.Output) test.out.push(event.Output);
    if (event.Action === 'pass' || event.Action === 'fail' || event.Action === 'skip') {
      test.status = event.Action === 'pass' ? 'passed' : event.Action === 'fail' ? 'failed' : 'skipped';
      test.durationMs = typeof event.Elapsed === 'number' ? Math.round(event.Elapsed * 1000) : null;
    }
  }
  const list = [...tests.values()].map(({ out, ...test }) => (test.status === 'failed' ? { ...test, failure: failure(out.filter((l) => !/^(=== RUN|--- FAIL)/.test(l.trim())).join('')) } : test));
  // A parent test fails with its failing subtest; only the subtest row carries the reason.
  const leaves = list.filter((t) => !(t.status === 'failed' && list.some((o) => o !== t && o.file === t.file && o.name.startsWith(`${t.name}/`))));
  return { runner: 'go', tests: leaves, counts: countTests(leaves), durationMs: Math.round(durationMs) || null };
}

// ---- Summary lines, for output with no machine report (Claude's runs, or a runner without one).
const num = (re: RegExp, text: string): number => Number(re.exec(text)?.[1] ?? 0);
const lastMatch = (re: RegExp, text: string): RegExpExecArray | null => {
  let found: RegExpExecArray | null = null;
  for (const m of text.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`))) found = m as RegExpExecArray;
  return found;
};
const seconds = (text: string | undefined): number | null => {
  if (!text) return null;
  const m = /([\d.]+)\s*(ms|s|m)\b/.exec(text);
  if (!m) return null;
  const value = Number(m[1]);
  return Math.round(m[2] === 'ms' ? value : m[2] === 'm' ? value * 60000 : value * 1000);
};

const failingRows = (names: { name: string; file: string }[], output: string): TestCase[] =>
  names.map(({ name, file }) => ({ name, file, status: 'failed' as TestStatus, durationMs: null, failure: failureFor(name, output) }));

// The lines after a failing test's header, up to the next blank-line-separated header; good enough for a fix prompt.
function failureFor(name: string, output: string): string | undefined {
  const last = name.split(/ > | › |::/).at(-1) ?? name;
  const at = output.lastIndexOf(last);
  if (at < 0) return undefined;
  return failure(output.slice(at, at + FAILURE_CAP));
}

function vitestText(out: string): Parsed | null {
  const line = lastMatch(/^\s*Tests\s+(.+)$/m, out);
  if (!line || !/\b(passed|failed)\b/.test(line[1])) return null;
  const counts = { passed: num(/(\d+) passed/, line[1]), failed: num(/(\d+) failed/, line[1]), skipped: num(/(\d+) skipped/, line[1]) + num(/(\d+) todo/, line[1]) };
  const names: { name: string; file: string }[] = [];
  for (const m of out.matchAll(/^\s*FAIL\s+(\S+)\s+>\s+(.+?)\s*$/gm)) if (!names.some((n) => n.file === m[1] && n.name === m[2])) names.push({ file: m[1], name: m[2] });
  return { runner: 'vitest', tests: failingRows(names, out), counts, durationMs: seconds(/^\s*Duration\s+(\S+)/m.exec(out)?.[1]) };
}

function jestText(out: string): Parsed | null {
  const line = lastMatch(/^Tests:\s+(.+)$/m, out);
  if (!line) return null;
  const counts = { passed: num(/(\d+) passed/, line[1]), failed: num(/(\d+) failed/, line[1]), skipped: num(/(\d+) skipped/, line[1]) + num(/(\d+) todo/, line[1]) };
  const names: { name: string; file: string }[] = [];
  let file = 'tests';
  for (const l of out.split('\n')) {
    const fail = /^\s*FAIL\s+(\S+)/.exec(l);
    if (fail) file = fail[1];
    const bullet = /^\s*●\s+(.+?)\s*$/.exec(l);
    if (bullet && !/Console$|Test suite failed to run/.test(bullet[1])) names.push({ file, name: bullet[1].replace(/ › /g, ' > ') });
  }
  return { runner: 'jest', tests: failingRows(names, out), counts, durationMs: seconds(/^Time:\s+(.+)$/m.exec(out)?.[1]) };
}

function pytestText(out: string): Parsed | null {
  const line = lastMatch(/^=+ (.*\b(passed|failed|error|errors|skipped|no tests ran)\b.*?) =+$/m, out);
  if (!line) return null;
  const counts = { passed: num(/(\d+) passed/, line[1]), failed: num(/(\d+) failed/, line[1]) + num(/(\d+) errors?/, line[1]), skipped: num(/(\d+) skipped/, line[1]) + num(/(\d+) xfailed/, line[1]) };
  const names: { name: string; file: string }[] = [];
  for (const m of out.matchAll(/^(?:FAILED|ERROR) (\S+?)::(\S+?)(?: - .*)?$/gm)) names.push({ file: m[1], name: m[2].replace(/::/g, ' > ') });
  return { runner: 'pytest', tests: failingRows(names, out), counts, durationMs: seconds(/ in ([\d.]+s)/.exec(line[1])?.[1]) };
}

function goText(out: string): Parsed | null {
  if (!/^(--- (PASS|FAIL|SKIP)|ok\s+\S+|FAIL\s+\S+)/m.test(out)) return null;
  const tests: TestCase[] = [];
  let pending: TestCase[] = [];
  for (const l of out.split('\n')) {
    const t = /^\s*--- (PASS|FAIL|SKIP): (\S+) \(([\d.]+)s\)/.exec(l);
    if (t) pending.push({ name: t[2], file: 'go', status: t[1] === 'PASS' ? 'passed' : t[1] === 'FAIL' ? 'failed' : 'skipped', durationMs: Math.round(Number(t[3]) * 1000) });
    const pkg = /^(?:ok|FAIL)\s+(\S+)\s/.exec(l);
    if (pkg) { tests.push(...pending.map((p) => ({ ...p, file: pkg[1] }))); pending = []; }
  }
  tests.push(...pending);
  const leaves = tests.filter((t) => !(t.status === 'failed' && tests.some((o) => o !== t && o.name.startsWith(`${t.name}/`))));
  for (const t of leaves) if (t.status === 'failed') t.failure = failureFor(t.name, out);
  return { runner: 'go', tests: leaves, counts: countTests(leaves), durationMs: null };
}

function cargoText(out: string): Parsed | null {
  const results = [...out.matchAll(/^test result: \w+\. (\d+) passed; (\d+) failed; (\d+) ignored/gm)];
  if (!results.length) return null;
  const counts = results.reduce((c, m) => ({ passed: c.passed + Number(m[1]), failed: c.failed + Number(m[2]), skipped: c.skipped + Number(m[3]) }), emptyCounts());
  const names = [...out.matchAll(/^test (\S+) \.\.\. FAILED$/gm)].map((m) => ({ name: m[1], file: m[1].split('::').slice(0, -1).join('::') || 'crate' }));
  return { runner: 'cargo', tests: failingRows(names, out), counts, durationMs: null };
}

function mochaText(out: string): Parsed | null {
  if (!/^\s+\d+ passing\b/m.test(out)) return null;
  const counts = { passed: num(/^\s+(\d+) passing/m, out), failed: num(/^\s+(\d+) failing/m, out), skipped: num(/^\s+(\d+) pending/m, out) };
  const names: { name: string; file: string }[] = [];
  // The failure list after "N failing": "  1) Suite\n       test name:".
  const tail = out.slice(out.search(/^\s+\d+ failing/m));
  for (const m of tail.matchAll(/^\s+\d+\) (.+)\n((?:\s{5,}.+\n)*?)\s{5,}(.+):\s*$/gm)) {
    const titles = [m[1], ...m[2].split('\n').map((l) => l.trim()).filter(Boolean), m[3]];
    names.push({ file: titles[0], name: titles.join(' > ') });
  }
  return { runner: 'mocha', tests: failingRows(names, out), counts, durationMs: seconds(/^\s+\d+ passing \((.+)\)/m.exec(out)?.[1]) };
}

function playwrightText(out: string): Parsed | null {
  if (!/^\s+\d+ (passed|failed)\b/m.test(out) || !/Running \d+ tests? using/.test(out)) return null;
  const counts = { passed: num(/^\s+(\d+) passed/m, out) + num(/^\s+(\d+) flaky/m, out), failed: num(/^\s+(\d+) failed/m, out), skipped: num(/^\s+(\d+) skipped/m, out) };
  const names: { name: string; file: string }[] = [];
  for (const m of out.matchAll(/^\s+\d+\) (?:\[([^\]]+)\] › )?(\S+?):\d+:\d+ › (.+?)\s*─*\s*$/gm)) {
    const name = `${m[1] ? `[${m[1]}] ` : ''}${m[3].replace(/ › /g, ' > ')}`;
    if (!names.some((n) => n.name === name && n.file === m[2])) names.push({ file: m[2], name });
  }
  return { runner: 'playwright', tests: failingRows(names, out), counts, durationMs: seconds(/^\s+\d+ passed \((.+)\)/m.exec(out)?.[1]) };
}

// Maestro prints "[Passed] login (3s)" per flow for a folder, and a final "N/M Flows Passed".
function maestroText(out: string): Parsed | null {
  const flows = [...out.matchAll(/^\s*\[(Passed|Failed|Skipped)\]\s+(.+?)\s+\((\d+(?:\.\d+)?m?s)\)(?:\s+\((.+)\))?\s*$/gm)];
  if (!flows.length && !/Flows? (Passed|Failed)/.test(out)) return null;
  const tests: TestCase[] = flows.map((m) => ({
    name: m[2], file: 'Maestro flows', status: m[1] === 'Passed' ? 'passed' : m[1] === 'Failed' ? 'failed' : 'skipped', durationMs: seconds(m[3]),
    ...(m[1] === 'Failed' ? { failure: failure(m[4] ?? failureFor(m[2], out) ?? '') } : {}),
  }));
  const summary = /(\d+)\/(\d+) Flows? Passed/.exec(out);
  const counts = tests.length ? countTests(tests) : { passed: Number(summary?.[1] ?? 0), failed: Number(summary?.[2] ?? 0) - Number(summary?.[1] ?? 0), skipped: 0 };
  return { runner: 'maestro', tests, counts, durationMs: null };
}

const TEXT_PARSERS: [string, (out: string) => Parsed | null][] = [
  ['vitest', vitestText], ['jest', jestText], ['playwright', playwrightText], ['pytest', pytestText],
  ['go', goText], ['cargo', cargoText], ['mocha', mochaText], ['maestro', maestroText],
];

// The runner's own parser first when the command names it, then whichever recognises the output.
export function parseText(raw: string, runner: string | null = null): Parsed {
  const out = stripAnsi(raw);
  if (runner === 'go' && /^\{"Time"/m.test(out)) return parseGoJson(out);
  const ordered = [...TEXT_PARSERS.filter(([id]) => id === runner), ...TEXT_PARSERS.filter(([id]) => id !== runner)];
  for (const [, parse] of ordered) {
    const parsed = parse(out);
    if (parsed && (parsed.counts.passed || parsed.counts.failed || parsed.counts.skipped || parsed.tests.length)) return parsed;
  }
  return { ...NONE, runner };
}

// A report file Petal asked the runner for, read by its kind.
export type ReportKind = 'jest-json' | 'vitest-json' | 'playwright-json' | 'junit' | 'go-json';

export function parseReport(kind: ReportKind, text: string, root: string | null, runner: string | null): Parsed {
  if (kind === 'jest-json' || kind === 'vitest-json') return parseJestJson(text, root, kind === 'vitest-json' ? 'vitest' : 'jest');
  if (kind === 'playwright-json') return parsePlaywrightJson(text);
  if (kind === 'go-json') return parseGoJson(text);
  return parseJUnit(text, runner);
}

export const keepOutput = (raw: string): string => trimOutput(stripAnsi(raw), OUTPUT_KEEP);

// Paths inside the project shown relative to it, in failure text too ("at /Users/x/acme/src/a.ts:3" -> "at src/a.ts:3").
export function shortenPaths(parsed: Parsed, root: string): Parsed {
  const short = (text: string) => text.split(`file://${root}/`).join('').split(`${root}/`).join('');
  return { ...parsed, tests: parsed.tests.map((t) => (t.failure ? { ...t, failure: short(t.failure) } : t)) };
}
export const shortenText = (text: string, root: string): string => text.split(`file://${root}/`).join('').split(`${root}/`).join('');

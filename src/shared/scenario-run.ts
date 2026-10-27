// Running a scenario's own tests, or every scenario of one ticket: one command per test file, built from the scenario
// lines' "test: path::name" parts with each runner's single-test filter. Pure; main runs them like stages.
import type { CriteriaItem } from './test-loop';
import type { StageConfig, StageResult } from './testing';

export type ScenarioRunner = 'vitest' | 'jest' | 'playwright' | 'pytest' | 'go';
export interface ScenarioTest { path: string; name: string | null }

const JS_FILE = /\.(c|m)?[jt]sx?$/;
const NAME_CAP = 60;

// The environment the suite's stages share: their common leading "… &&" steps, else nothing.
export function envPrefix(commands: readonly string[]): string {
  const split = commands.map((c) => c.split(/\s*&&\s*/).map((s) => s.trim()));
  if (!split.length) return '';
  const shared: string[] = [];
  for (let i = 0; ; i += 1) {
    const step = split[0][i];
    // A shared step must leave each command at least one step of its own.
    if (step === undefined || split.some((parts) => parts[i] !== step || parts.length <= i + 1)) break;
    shared.push(step);
  }
  return shared.length ? `${shared.join(' && ')} && ` : '';
}

// The runner for one test file, from its kind and the runners the suite's stages use; null when unknown.
export function runnerForFile(file: string, runners: ReadonlySet<string>): ScenarioRunner | null {
  if (/\.py$/.test(file)) return 'pytest';
  if (/_test\.go$/.test(file)) return 'go';
  if (!JS_FILE.test(file)) return null;
  const unit = runners.has('vitest') ? 'vitest' : runners.has('jest') ? 'jest' : null;
  if (runners.has('playwright') && (/(^|\/)(e2e|playwright|tests-e2e)\//.test(file) || !unit)) return 'playwright';
  return unit;
}

export const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

// A double-quoted shell word: only \ " $ and ` are special inside one.
export const dquote = (text: string): string => `"${text.replace(/[\\"$`]/g, '\\$&')}"`;
const squote = (text: string): string => `'${text.replace(/'/g, `'\\''`)}'`;

// One command for the named tests of one file; no names runs the whole file.
export function fileCommand(runner: ScenarioRunner, file: string, names: readonly string[]): string {
  const pattern = names.map(escapeRegex).join('|');
  switch (runner) {
    case 'vitest': return `npx vitest run ${dquote(file)}${names.length ? ` -t ${dquote(pattern)}` : ''}`;
    case 'jest': return `npx jest ${dquote(file)}${names.length ? ` -t ${dquote(pattern)}` : ''}`;
    case 'playwright': return `npx playwright test ${dquote(file)}${names.length ? ` -g ${dquote(pattern)}` : ''}`;
    case 'pytest': return `pytest ${(names.length ? names.map((n) => `${file}::${n}`) : [file]).map(dquote).join(' ')}`;
    case 'go': {
      const dir = file.includes('/') ? `./${file.slice(0, file.lastIndexOf('/'))}` : '.';
      return `go test ${dir}${names.length ? ` -run ${squote(`^(${pattern})$`)}` : ''}`;
    }
  }
}

// ---- A test file outside the checkout, kept in the repo's suite folder in Petal ("~/.petal/repos/<key>/tests/…").
// It runs through the suite stage whose vitest --config sits in that folder; other runners can't be run this way yet.
const HOME_PATH = /^(?:~|\$HOME)(?=\/|$)/;
export const isOutsidePath = (file: string): boolean => HOME_PATH.test(file) || file.startsWith('/');

// A path as one shell word: the home folder as "$HOME", never "~" inside quotes, where the shell leaves it alone.
export function shellPath(file: string): string {
  const rest = file.replace(HOME_PATH, '');
  return rest === file ? dquote(file) : `"$HOME"${rest ? dquote(rest) : ''}`;
}

const homeForm = (file: string): string => file.replace(HOME_PATH, '$HOME');
const VITEST_STEP = /^(?:npx\s+)?vitest(?:\s+run)?\s/;
const flagOf = (step: string, flag: string): string | null => new RegExp(`(?:^|\\s)--${flag}(?:=|\\s+)(\\S+)`).exec(step)?.[1] ?? null;
const dirOf = (file: string): string => file.slice(0, file.lastIndexOf('/'));

interface SuiteCall { prefix: string; config: string; project: string | null }

// The suite stage that runs vitest with a --config in the folder holding this file, its --project kept: vitest's file
// filter matches by substring, so a same-named file in another project would run too. Stages on several projects:
// the one whose project names a folder on the file's path ("tests/needs-x/…"), else the first in suite order.
export function suiteCallFor(file: string, stageCommands: readonly string[]): SuiteCall | null {
  const target = homeForm(file);
  const calls = stageCommands.flatMap((command) => {
    const steps = command.split(/\s*&&\s*/).map((step) => step.trim());
    const at = steps.findIndex((step) => VITEST_STEP.test(step) && flagOf(step, 'config'));
    const config = at >= 0 ? flagOf(steps[at], 'config') : null;
    if (!config || !target.startsWith(`${dirOf(homeForm(config))}/`)) return [];
    const prefix = steps.slice(0, at).join(' && ');
    return [{ prefix: prefix ? `${prefix} && ` : '', config, project: flagOf(steps[at], 'project') }];
  });
  const folders = new Set(target.split('/'));
  return calls.find((c) => c.project !== null && folders.has(c.project)) ?? calls[0] ?? null;
}

const suiteCommand = (call: SuiteCall, file: string, names: readonly string[]): string =>
  `${call.prefix}npx vitest run --config ${shellPath(call.config)}${call.project ? ` --project ${dquote(call.project)}` : ''} ${shellPath(file)}${names.length ? ` -t ${dquote(names.map(escapeRegex).join('|'))}` : ''}`;

// A file's command, or null when it can't be run: a repo path by its runner, a suite-folder path through its suite stage.
function commandFor(file: string, names: readonly string[], runners: ReadonlySet<string>, prefix: string, stageCommands: readonly string[]): string | null {
  if (isOutsidePath(file)) {
    const call = runnerForFile(file, new Set(['vitest'])) === 'vitest' ? suiteCallFor(file, stageCommands) : null;
    return call ? suiteCommand(call, file, names) : null;
  }
  const runner = runnerForFile(file, runners);
  return runner ? `${prefix}${fileCommand(runner, file, names)}` : null;
}

// files: each stage's test file, by stage id. skipped: files with no known runner.
export interface ScenarioPlan { stages: StageConfig[]; files: Record<string, string>; skipped: string[] }

// Tests grouped by file, one stage each; a file with any unnamed test runs whole.
// stageCommands: the suite's stage commands, for files kept in the suite folder.
export function planTests(tests: readonly ScenarioTest[], runners: ReadonlySet<string>, prefix: string, stageCommands: readonly string[] = []): ScenarioPlan {
  const byFile = new Map<string, Set<string> | null>(); // null: run the whole file
  for (const t of tests) {
    const file = t.path.trim();
    if (!file) continue;
    if (!byFile.has(file)) byFile.set(file, new Set());
    const names = byFile.get(file);
    if (!names) continue;
    if (t.name) names.add(t.name); else byFile.set(file, null);
  }
  const stages: StageConfig[] = [];
  const files: Record<string, string> = {};
  const skipped: string[] = [];
  for (const [file, names] of byFile) {
    const command = commandFor(file, [...(names ?? [])], runners, prefix, stageCommands);
    if (!command) { skipped.push(file); continue; }
    const base = file.split('/').pop() ?? file;
    const id = `scenario-${stages.length + 1}`;
    files[id] = file;
    stages.push({ id, name: `Scenario · ${base}`.slice(0, NAME_CAP), command });
  }
  return { stages, files, skipped };
}

const testsOf = (items: readonly CriteriaItem[]): ScenarioTest[] => items.flatMap((s) => s.tests);

// Why a scenario's Run button is off, or null when every one of its test files has a runner.
export function scenarioBlock(scenario: CriteriaItem, runners: ReadonlySet<string>, stageCommands: readonly string[] = []): string | null {
  if (!scenario.tests.length) return 'No test names this scenario yet.';
  const unknown = scenario.tests.map((t) => t.path.trim()).filter((p) => !commandFor(p, [], runners, '', stageCommands));
  return unknown.length ? `No known runner for ${unknown[0]}` : null;
}

export const planScenario = (scenario: CriteriaItem, runners: ReadonlySet<string>, prefix: string, stageCommands: readonly string[] = []): ScenarioPlan => planTests(scenario.tests, runners, prefix, stageCommands);

// A ticket's scenarios that have tests; staging ones only when she turned staging on.
export const ticketScenarios = (scenarios: readonly CriteriaItem[], ticket: string, withStaging: boolean): CriteriaItem[] =>
  scenarios.filter((s) => s.ticket === ticket && s.tests.length && (s.level !== 'staging' || withStaging));

export const planTicket = (scenarios: readonly CriteriaItem[], runners: ReadonlySet<string>, prefix: string, stageCommands: readonly string[] = []): ScenarioPlan => planTests(testsOf(scenarios), runners, prefix, stageCommands);

// ---- After the run: each scenario passes when all its tests did. A test is found by name in its file's stage; one the
// report doesn't list takes that stage's result. Null when none of its files ran.
export function scenarioOutcome(scenario: Pick<CriteriaItem, 'tests'>, stages: readonly StageResult[], files: Readonly<Record<string, string>>): 'pass' | 'fail' | null {
  let seen = false;
  for (const t of scenario.tests) {
    const stage = stages.find((s) => s.stageId !== null && files[s.stageId] === t.path.trim());
    if (!stage || (stage.status !== 'passed' && stage.status !== 'failed')) continue;
    seen = true;
    const cases = t.name ? stage.tests.filter((c) => c.name === t.name || c.name.endsWith(` > ${t.name}`) || c.name.endsWith(` ${t.name}`)) : [];
    const failed = cases.length ? cases.some((c) => c.status === 'failed') : stage.status === 'failed';
    if (failed) return 'fail';
  }
  return seen ? 'pass' : null;
}

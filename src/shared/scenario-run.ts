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

// files: each stage's test file, by stage id. skipped: files with no known runner.
export interface ScenarioPlan { stages: StageConfig[]; files: Record<string, string>; skipped: string[] }

// Tests grouped by file, one stage each; a file with any unnamed test runs whole.
export function planTests(tests: readonly ScenarioTest[], runners: ReadonlySet<string>, prefix: string): ScenarioPlan {
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
    const runner = runnerForFile(file, runners);
    if (!runner) { skipped.push(file); continue; }
    const base = file.split('/').pop() ?? file;
    const id = `scenario-${stages.length + 1}`;
    files[id] = file;
    stages.push({ id, name: `Scenario · ${base}`.slice(0, NAME_CAP), command: `${prefix}${fileCommand(runner, file, [...(names ?? [])])}` });
  }
  return { stages, files, skipped };
}

const testsOf = (items: readonly CriteriaItem[]): ScenarioTest[] => items.flatMap((s) => s.tests);

// Why a scenario's Run button is off, or null when every one of its test files has a runner.
export function scenarioBlock(scenario: CriteriaItem, runners: ReadonlySet<string>): string | null {
  if (!scenario.tests.length) return 'No test names this scenario yet.';
  const unknown = scenario.tests.map((t) => t.path).filter((p) => !runnerForFile(p, runners));
  return unknown.length ? `No known runner for ${unknown[0]}` : null;
}

export const planScenario = (scenario: CriteriaItem, runners: ReadonlySet<string>, prefix: string): ScenarioPlan => planTests(scenario.tests, runners, prefix);

// A ticket's scenarios that have tests; staging ones only when she turned staging on.
export const ticketScenarios = (scenarios: readonly CriteriaItem[], ticket: string, withStaging: boolean): CriteriaItem[] =>
  scenarios.filter((s) => s.ticket === ticket && s.tests.length && (s.level !== 'staging' || withStaging));

export const planTicket = (scenarios: readonly CriteriaItem[], runners: ReadonlySet<string>, prefix: string): ScenarioPlan => planTests(testsOf(scenarios), runners, prefix);

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

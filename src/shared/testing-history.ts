// The Testing tab's History list as rows that each say something: what ran, why it ran, what changed since the
// last run of the same thing, and how long it took. Pure, so vitest covers it and the renderer only draws.
import { checkStep, isCheckOnly, normalizeCommand, runnerOf, slugId, type PipelineRun, type StageConfig, type TestCase } from './testing';

const TITLE_MAX = 48;
const PROMPT_MAX = 60;
const NAMES_SHOWN = 2;
const NAME_MAX = 44;
const DAY_MS = 24 * 60 * 60 * 1000;

const cut = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
};

// "cd app && npx vitest run src/auth 2>&1 | tail -20" -> "npx vitest run src/auth".
export const shortCommand = (command: string, max = TITLE_MAX): string => cut(checkStep(command), max);

// A run that parsed no test results and matched no stage: a command that only looked like a test.
export function isNoResult(run: PipelineRun): boolean {
  if (run.state === 'running' || run.stages.length !== 1) return false;
  const [stage] = run.stages;
  const counted = stage.counts.passed + stage.counts.failed + stage.counts.skipped > 0 || stage.tests.length > 0;
  return !counted && stage.stageId === null && run.state === 'passed' && !isCheckOnly(checkStep(stage.command));
}

// The same thing run again: the same stage, else the same command, else the whole pipeline.
export function runKey(run: PipelineRun): string {
  if (run.stages.length !== 1) return 'pipeline';
  const [stage] = run.stages;
  return stage.stageId ? `stage:${stage.stageId}` : `cmd:${normalizeCommand(checkStep(stage.command))}`;
}

// What ran: the stage name, else the command; a pipeline run says how many stages.
export function runTitle(run: PipelineRun): string {
  if (run.stages.length !== 1) return `Pipeline · ${run.stages.length} stages`;
  const [stage] = run.stages;
  return stage.stageId ? stage.name : shortCommand(stage.command);
}

// Why it ran: the prompt Claude's turn answered and its session, or which of her buttons started it.
export function runWhy(run: PipelineRun): string {
  if (run.by === 'claude') {
    const prompt = run.prompt ? `while: ${cut(run.prompt, PROMPT_MAX)}` : '';
    return [prompt, run.sessionName ? cut(run.sessionName, 32) : ''].filter(Boolean).join(' · ');
  }
  if (run.trigger === 'auto') return 'Auto, after Claude’s turn';
  return run.stages.length === 1 ? 'Run stage' : 'Run pipeline';
}

export const byTag = (run: PipelineRun): string => (run.by === 'claude' ? 'by Claude' : 'by you');

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

// "auth > tokens > rejects an expired token" in src/auth/tokens.test.ts -> "tokens.test.ts › rejects an expired token".
export const testLabel = (test: Pick<TestCase, 'name' | 'file'>): string => {
  const file = test.file.split(/[\\/]/).pop() ?? test.file;
  const title = test.name.split(/\s+[>›]\s+/).pop() ?? test.name;
  return cut(file && file !== title ? `${file} › ${title}` : title, NAME_MAX);
};

const nameList = (labels: string[]): string =>
  `${labels.slice(0, NAMES_SHOWN).join(', ')}${labels.length > NAMES_SHOWN ? ` + ${labels.length - NAMES_SHOWN} more` : ''}`;

const testsOf = (run: PipelineRun): TestCase[] => run.stages.flatMap((s) => s.tests);
const failingOf = (run: PipelineRun): TestCase[] => testsOf(run).filter((t) => t.status === 'failed');
const totalOf = (run: PipelineRun): number => run.totals.passed + run.totals.failed + run.totals.skipped;
const idOf = (t: TestCase): string => `${t.file}\u0000${t.name}`;

// Failing names are trustworthy when every failure the counts report has a parsed test behind it.
const namesComplete = (run: PipelineRun): boolean => failingOf(run).length === run.totals.failed;

// What changed since the previous run of the same stage or command: test count, newly failing, fixed.
export function changeSince(run: PipelineRun, prev: PipelineRun | null): string[] {
  if (!prev || run.state === 'running') return [];
  const notes: string[] = [];
  const delta = totalOf(run) - totalOf(prev);
  if (delta && totalOf(prev)) notes.push(`${delta > 0 ? '+' : '−'}${plural(Math.abs(delta), 'test')}`);
  if (namesComplete(run) && namesComplete(prev)) {
    const before = new Set(failingOf(prev).map(idOf));
    const now = new Set(failingOf(run).map(idOf));
    const passedNow = new Set(testsOf(run).filter((t) => t.status === 'passed').map(idOf));
    const keptAll = testsOf(run).length > failingOf(run).length; // older runs keep only their failing tests
    const fresh = failingOf(run).filter((t) => !before.has(idOf(t)));
    const fixed = failingOf(prev).filter((t) => !now.has(idOf(t)) && (!keptAll || passedNow.has(idOf(t))));
    if (fresh.length) notes.push(`${fresh.length} newly failing: ${nameList(fresh.map(testLabel))}`);
    if (fixed.length) notes.push(`fixed ${fixed.length}`);
  } else {
    const more = run.totals.failed - prev.totals.failed;
    if (more > 0) notes.push(`${more} more failing`);
    if (more < 0) notes.push(`fixed ${-more}`);
  }
  if (!notes.length && prev.state !== run.state) notes.push(run.state === 'passed' ? 'now passing' : 'now failing');
  return notes;
}

// The result: counts, else the state; a failure with no parsed tests names its exit code.
export function resultText(run: PipelineRun): string {
  if (run.state === 'running') return 'Running';
  const { passed, failed, skipped } = run.totals;
  if (passed || failed || skipped) return [failed && `${failed} failed`, passed && `${passed} passed`, skipped && `${skipped} skipped`].filter(Boolean).join(' · ');
  if (run.state === 'failed') {
    const code = run.stages.find((s) => s.status === 'failed')?.exitCode;
    return code ? `Failed, exit ${code}` : 'Failed';
  }
  return run.state === 'stopped' ? 'Stopped' : 'Passed';
}

// Failing tests inline: the first two and how many more.
export function failingText(run: PipelineRun): string {
  const failing = failingOf(run);
  return failing.length ? nameList(failing.map(testLabel)) : '';
}

export const runDuration = (run: PipelineRun): number | null => {
  const known = run.stages.map((s) => s.durationMs).filter((ms): ms is number => ms !== null);
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
};

export interface RunRow {
  kind: 'run';
  run: PipelineRun; // the newest of the collapsed runs; selecting the row selects it
  repeats: PipelineRun[]; // newest first, run included; more than one when collapsed
  title: string;
  by: string;
  why: string;
  result: string;
  change: string[];
  failing: string;
  durationMs: number | null;
}

export interface OtherRow { kind: 'other'; runs: PipelineRun[]; commands: string[] }

export interface HistoryDay { label: string; rows: (RunRow | OtherRow)[] }

// A collapsed row stands for runs that are the same command with the same outcome.
const sameOutcome = (a: PipelineRun, b: PipelineRun): boolean =>
  runKey(a) === runKey(b) && a.state === b.state && a.totals.passed === b.totals.passed && a.totals.failed === b.totals.failed
  && a.totals.skipped === b.totals.skipped && failingText(a) === failingText(b);

const dayStart = (ms: number): number => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };

export function dayLabel(at: number, now = Date.now()): string {
  const days = Math.round((dayStart(now) - dayStart(at)) / DAY_MS);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return new Date(at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

// Newest first, grouped by day; repeats collapse; commands with no results fold into one muted row per day.
export function historyDays(runs: PipelineRun[], now = Date.now(), limit = 60): HistoryDay[] {
  const ordered = [...runs].sort((a, b) => b.startedAt - a.startedAt).slice(0, limit);
  const counted = ordered.filter((r) => !isNoResult(r));
  const previous = (run: PipelineRun): PipelineRun | null => {
    const i = counted.indexOf(run);
    return counted.slice(i + 1).find((r) => runKey(r) === runKey(run) && r.state !== 'running') ?? null;
  };
  const days: HistoryDay[] = [];
  const others = new Map<HistoryDay, OtherRow>();
  for (const run of ordered) {
    const label = dayLabel(run.startedAt, now);
    let day = days.at(-1);
    if (!day || day.label !== label) { day = { label, rows: [] }; days.push(day); }
    if (isNoResult(run)) {
      const other = others.get(day) ?? { kind: 'other', runs: [], commands: [] };
      other.runs.push(run);
      const command = shortCommand(run.stages[0].command);
      if (!other.commands.includes(command)) other.commands.push(command);
      others.set(day, other);
      continue;
    }
    const last = day.rows.at(-1);
    if (last?.kind === 'run' && sameOutcome(last.run, run)) { last.repeats.push(run); continue; }
    day.rows.push({
      kind: 'run', run, repeats: [run], title: runTitle(run), by: byTag(run), why: runWhy(run), result: resultText(run),
      change: [], failing: failingText(run), durationMs: runDuration(run),
    });
  }
  for (const day of days) {
    // A collapsed row's change is its first repeat's, against whatever ran before the repeats.
    for (const row of day.rows) if (row.kind === 'run') row.change = changeSince(row.repeats.at(-1) as PipelineRun, previous(row.repeats.at(-1) as PipelineRun));
  }
  for (const [day, other] of others) day.rows.push(other);
  return days;
}

// Runs the trend chart counts: finished, with results.
export const chartRuns = (runs: PipelineRun[], count: number): PipelineRun[] =>
  runs.filter((r) => r.state !== 'running' && !isNoResult(r)).slice(0, count);

const STAGE_NAME: Record<string, string> = { tsc: 'Typecheck', eslint: 'Lint', playwright: 'E2E', cypress: 'E2E', detox: 'Mobile', maestro: 'Mobile flows', k6: 'Load' };
const scriptName = (step: string): string | null => /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?([\w:-]+)/.exec(step)?.[1] ?? null;

// "Make a pipeline from these commands": one stage per distinct check Claude ran, most used first, at most six.
export function stagesFromRuns(runs: PipelineRun[], max = 6): StageConfig[] {
  const uses = new Map<string, number>();
  for (const run of runs) {
    if (run.by !== 'claude' || isNoResult(run) || run.stages.length !== 1) continue;
    const step = checkStep(run.stages[0].command);
    uses.set(step, (uses.get(step) ?? 0) + 1);
  }
  const stages: StageConfig[] = [];
  for (const [command] of [...uses].sort((a, b) => b[1] - a[1]).slice(0, max)) {
    const runner = runnerOf(command);
    const script = scriptName(command);
    const base = (runner && STAGE_NAME[runner]) || (script === 'typecheck' || script === 'type-check' ? 'Typecheck' : script === 'lint' ? 'Lint' : 'Unit');
    const taken = stages.map((s) => s.name);
    const name = taken.includes(base) ? `${base} (${cut(command, 24)})` : base;
    stages.push({ id: slugId(name, stages.map((s) => s.id)), name, command });
  }
  const order = ['Typecheck', 'Lint', 'Unit', 'E2E', 'Mobile', 'Mobile flows', 'Load'];
  return stages.sort((a, b) => order.indexOf(a.name.split(' (')[0]) - order.indexOf(b.name.split(' (')[0]));
}

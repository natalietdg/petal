// The Testing tab: a project's test pipeline, its runs (hers or Claude's), what it tests with, and the pure helpers both sides share.
import type { Prd, Task } from './tasks';

export type TestStatus = 'passed' | 'failed' | 'skipped';
export type StageStatus = 'waiting' | 'running' | 'passed' | 'failed' | 'skipped' | 'stopped';
export type RunState = 'running' | 'passed' | 'failed' | 'stopped';
export type RunBy = 'you' | 'claude';

export interface TestCase {
  name: string; // suite path and title, "auth > tokens > rejects an expired token"
  file: string; // the group it shows under; a package, class or flow when the runner has no file
  status: TestStatus;
  durationMs: number | null;
  failure?: string; // trimmed failure output
}

export interface Counts { passed: number; failed: number; skipped: number }

// One stage as she set it up.
export interface StageConfig { id: string; name: string; command: string }

export interface PipelineConfig {
  stages: StageConfig[];
  keepGoing: boolean; // run later stages after a failed one
  autoRun: boolean; // run after a Claude turn that changed files; off by default
  confirmed: string[]; // commands she has confirmed once; a new or edited one asks again
  savedAt?: number; // her last save, or when she took Claude's; a newer .petal/pipeline.json is offered
}

export interface StageResult {
  stageId: string | null; // null: a Claude run that matched no stage
  name: string;
  command: string;
  status: StageStatus;
  exitCode: number | null;
  durationMs: number | null;
  counts: Counts;
  tests: TestCase[];
  output: string; // the end of the output, kept for a failure with no parsed tests
  runner: string | null;
}

export interface PipelineRun {
  id: string;
  by: RunBy;
  trigger: 'click' | 'auto' | 'transcript';
  startedAt: number;
  finishedAt: number | null;
  state: RunState;
  stages: StageResult[];
  totals: Counts;
  sessionId?: string; // a Claude run's session
  prompt?: string; // a Claude run: her prompt that turn answered; '' when the log had none
  cwd?: string; // a Claude run: the folder its command ran in, which files it under a project
  sessionName?: string; // a Claude run: its session's name, added when read, never stored
  taskId?: string | null; // the task its session held when it ran; absent on older runs
}

// <userData>/testing/<project-hash>.json
export interface ProjectTesting {
  version: 1;
  root: string;
  pipeline: PipelineConfig | null; // null until she saves or runs; the proposal comes from detection
  runs: PipelineRun[]; // newest first
}

export type StackKind = 'unit' | 'e2e' | 'mobile' | 'load' | 'lint' | 'ci' | 'skill' | 'agent' | 'command';

export interface StackItem {
  id: string;
  label: string;
  kind: StackKind;
  foundIn: string; // "package.json", ".maestro/login.yaml", "user skills"
  detail?: string;
  insert?: string; // a skill, agent or command: what lands in the reply box
}

export interface ProjectRef { root: string; name: string }

// Why the tab's folder is not a project, and the projects she can look at instead.
export interface Elsewhere { reason: 'home' | 'no-repo'; folder: string; projects: ProjectRef[] }

export interface TestingState {
  allowed: boolean; // the folder gate; false reads nothing
  project: ProjectRef | null;
  elsewhere: Elsewhere | null; // set when project is null because the tab is in ~ or outside a repo
  stack: StackItem[];
  proposed: StageConfig[]; // stages detection suggests
  pipeline: PipelineConfig; // saved, else the proposal
  saved: boolean;
  runs: PipelineRun[];
  running: string | null; // the run id still going
  sessionTab: string | null; // the tab with this project's Claude, where Ask Claude to fix and skills go
  claudePipeline: ClaudePipelineState | null; // <repo>/.petal/pipeline.json, when there is one
  changed: string[]; // files changed recently (git), for Suite health's core stage
  tasks: Task[]; // the project's tasks and PRDs, for the This task and PRD scopes
  prds: Prd[];
  sessionTaskId: string | null; // the task held by sessionTab's session, the default scope
}

// What the Testing tab shows about the pipeline Claude wrote: in use as the proposal, offered over a saved one, or why it was refused.
export type ClaudePipelineState =
  | { proposal: boolean; offer: boolean; stages: number; problem?: undefined }
  | { problem: string };

export type RunRequest = { tabId: string; root?: string | null; stageId?: string | null; confirmed?: boolean };
export type RunReply =
  | { started: string; typed: string }
  | { confirm: { commands: { name: string; command: string; isNew: boolean }[] } }
  | { note: string };

export const RUN_CAP = 200;
export const FULL_TESTS_KEPT = 30; // older runs keep only their failing tests
export const FIX_PROMPT_CAP = 3000;
export const OUTPUT_KEEP = 4000;

export const emptyCounts = (): Counts => ({ passed: 0, failed: 0, skipped: 0 });
export const addCounts = (a: Counts, b: Counts): Counts => ({ passed: a.passed + b.passed, failed: a.failed + b.failed, skipped: a.skipped + b.skipped });

export function countTests(tests: TestCase[]): Counts {
  const counts = emptyCounts();
  for (const test of tests) counts[test.status] += 1;
  return counts;
}

// Runners named in a command, most specific first, so "npx playwright test" isn't read as a generic "test".
const RUNNER_PATTERNS: [string, RegExp][] = [
  ['vitest', /\bvitest\b/],
  ['jest', /\bjest\b/],
  ['playwright', /\bplaywright\s+test\b/],
  ['cypress', /\bcypress\s+run\b/],
  ['detox', /\bdetox\s+test\b/],
  ['mocha', /\bmocha\b/],
  ['pytest', /\b(pytest|py\.test)\b|\bpython3?\s+-m\s+pytest\b/],
  ['tox', /\btox\b/],
  ['go', /\bgo\s+test\b/],
  ['cargo', /\bcargo\s+(test|nextest)\b/],
  ['xcodebuild', /\bxcodebuild\b.*\btest\b|\bswift\s+test\b/],
  ['gradle', /\bgradlew?\b.*\b(test|connectedAndroidTest|connectedCheck|check)\b/],
  ['maestro', /\bmaestro\s+test\b/],
  ['k6', /\bk6\s+run\b/],
  ['tsc', /\btsc\b/],
  ['eslint', /\beslint\b/],
];

// Programs that start a test, typecheck or lint step; "cat vitest.config.ts" or "grep jest" never count.
const LAUNCHERS = /^(npx|pnpm|yarn|bunx|bun|npm|node|python3?|py\.test|pytest|go|cargo|swift|xcodebuild|\.\/gradlew|gradlew|gradle|maestro|k6|vitest|jest|mocha|playwright|cypress|detox|tox|tsc|eslint|uv|poetry)$/;

// A heredoc's body is data, not commands: "cat >> notes.md <<'EOF' ... npm test ... EOF" runs only cat.
const stripHeredocs = (command: string): string => command.replace(/<<-?\s*(['"]?)(\w+)\1([^\n]*)\n[\s\S]*?(?:\n\s*\2\s*(?=\n|$)|$)/g, '$3');

// Each step of a shell line ("cd app && npm test | tee out"), env assignments dropped.
const steps = (command: string): string[] => stripHeredocs(command).split(/&&|\|\||;|\||\n/).map((part) => part.trim().split(/\s+/).filter((w) => !/^\w+=/.test(w)).join(' ')).filter(Boolean);

export function runnerOf(command: string): string | null {
  for (const step of steps(command)) {
    if (!LAUNCHERS.test(step.split(' ')[0])) continue;
    const hit = RUNNER_PATTERNS.find(([, pattern]) => pattern.test(step));
    if (hit) return hit[0];
  }
  return null;
}

// A package-manager script whose name says test, typecheck or lint ("npm test", "pnpm run test:e2e").
const SCRIPT_RUN = /\b(npm|pnpm|yarn|bun)\s+(?:run\s+)?(test|t|typecheck|type-check|lint|e2e|check)(?::[\w-]+)?\b/;

// A command worth showing as a test run: a known runner or a test-ish package script.
export const isTestCommand = (command: string): boolean => {
  const runner = runnerOf(command);
  return (runner !== null && runner !== 'tsc' && runner !== 'eslint') || steps(command).some((step) => /^(npm|pnpm|yarn|bun)\s+(?:run\s+)?(test|t|e2e)(?::[\w-]+)?\b/.test(step));
};

const squash = (command: string): string => command.replace(/\s+/g, ' ').trim();

// The stage a command belongs to: the same command, then one that contains it, then the same runner or script.
// stageRunner looks through a stage's package script ("npm test" running vitest); main passes one.
export function matchStage(command: string, stages: StageConfig[], stageRunner: (command: string) => string | null = runnerOf): StageConfig | null {
  const text = squash(command);
  const exact = stages.find((s) => squash(s.command) === text);
  if (exact) return exact;
  const contained = stages.find((s) => squash(s.command) && text.includes(squash(s.command)));
  if (contained) return contained;
  const runner = runnerOf(text);
  if (runner) return stages.find((s) => stageRunner(s.command) === runner) ?? null;
  const script = SCRIPT_RUN.exec(text)?.[0];
  return script ? stages.find((s) => SCRIPT_RUN.exec(s.command)?.[0] === script) ?? null : null;
}

export interface TestGroup { file: string; tests: TestCase[]; counts: Counts; failed: boolean }

// Grouped by file: groups with failures first, failing tests first inside each, both in their original order otherwise.
export function groupByFile(tests: TestCase[]): TestGroup[] {
  const groups = new Map<string, TestCase[]>();
  for (const test of tests) groups.set(test.file, [...(groups.get(test.file) ?? []), test]);
  const rank: Record<TestStatus, number> = { failed: 0, passed: 1, skipped: 2 };
  const list = [...groups].map(([file, members]) => {
    const sorted = members.map((t, i) => ({ t, i })).sort((a, b) => rank[a.t.status] - rank[b.t.status] || a.i - b.i).map((x) => x.t);
    const counts = countTests(members);
    return { file, tests: sorted, counts, failed: counts.failed > 0 };
  });
  return list.map((g, i) => ({ g, i })).sort((a, b) => Number(b.g.failed) - Number(a.g.failed) || a.i - b.i).map((x) => x.g);
}

// The end of a long output, cut at a line start, with a marker.
export function trimOutput(text: string, cap: number): string {
  const clean = text.replace(/\r\n?/g, '\n').trim();
  if (clean.length <= cap) return clean;
  const tail = clean.slice(clean.length - cap);
  const cut = tail.indexOf('\n');
  return `[earlier output trimmed]\n${cut >= 0 && cut < 200 ? tail.slice(cut + 1) : tail}`;
}

// What "Ask Claude to fix" sends: the stage, its command, the failing tests and their output, capped near 3k characters.
export function buildFixPrompt({ stage, command, tests, output }: { stage: string; command: string; tests: TestCase[]; output?: string }): string {
  const failing = tests.filter((t) => t.status === 'failed');
  const head = failing.length === 1
    ? `The test "${failing[0].name}" in ${failing[0].file} fails in the ${stage} stage (\`${command}\`). Find the cause and fix it, then run that test again to confirm.`
    : `The ${stage} stage fails (\`${command}\`)${failing.length ? ` with ${failing.length} failing tests` : ''}. Find the cause and fix it, then run the stage again to confirm.`;
  const room = FIX_PROMPT_CAP - head.length - 40;
  const parts: string[] = [];
  let used = 0;
  const each = Math.max(240, Math.floor(room / Math.max(1, failing.length)) - 30); // room per test, its label and marker included
  for (const test of failing) {
    const label = failing.length > 1 ? `${test.file} › ${test.name}\n` : '';
    const body = test.failure ? trimOutput(test.failure, Math.max(120, each - label.length - 30)) : '';
    const part = `${label}${body}`.trim();
    if (!part) continue;
    if (used + part.length > room) break;
    parts.push(part);
    used += part.length;
  }
  if (!parts.length && output) parts.push(trimOutput(output, room));
  const block = parts.length ? `\n\n\`\`\`\n${parts.join('\n\n').replace(/```/g, "'''")}\n\`\`\`` : '';
  return `${head}${block}`.slice(0, FIX_PROMPT_CAP);
}

// A run's overall state from its stages.
export function runStateOf(stages: StageResult[]): RunState {
  if (stages.some((s) => s.status === 'running' || s.status === 'waiting')) return 'running';
  if (stages.some((s) => s.status === 'failed')) return 'failed';
  if (stages.some((s) => s.status === 'stopped')) return 'stopped';
  return 'passed';
}

// Passed tests over all tests run; a run with no parsed tests counts as 1 or 0 by its state.
export function passRate(run: PipelineRun): number {
  const total = run.totals.passed + run.totals.failed;
  if (total) return run.totals.passed / total;
  return run.state === 'passed' ? 1 : 0;
}

export const slugId = (name: string, taken: string[]): string => {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'stage';
  let id = base;
  for (let n = 2; taken.includes(id); n += 1) id = `${base}-${n}`;
  return id;
};

// Commands in the pipeline she has not confirmed yet.
export const unconfirmed = (pipeline: PipelineConfig, stages: StageConfig[]): StageConfig[] =>
  stages.filter((s) => !pipeline.confirmed.some((c) => squash(c) === squash(s.command)));
export const normalizeCommand = squash;

// The step of a shell line that runs the check, "cd", env and redirections dropped:
// "cd app && CI=1 npx jest --ci 2>&1 | tail -20" -> "npx jest --ci".
export function checkStep(command: string): string {
  const parts = steps(command).map((step) => step.replace(/\s*\d?>>?\s*&?\S+/g, '').replace(/\s*<\s*\S+/g, '').trim()).filter(Boolean);
  const launches = (step: string) => LAUNCHERS.test(step.split(' ')[0]);
  const tests = (step: string) => launches(step) && isTestCommand(step); // a test step wins over a typecheck in "tsc; jest"
  const checks = (step: string) => launches(step) && (RUNNER_PATTERNS.some(([, p]) => p.test(step)) || SCRIPT_RUN.test(step));
  return parts.find(tests) ?? parts.find(checks) ?? parts.find((step) => !/^(cd|export|set|source|\.)\b/.test(step)) ?? squash(command);
}

// A typecheck or lint step: a clean pass prints nothing to parse and still says something.
export const isCheckOnly = (step: string): boolean => {
  const runner = runnerOf(step);
  return runner === 'tsc' || runner === 'eslint' || /\b(npm|pnpm|yarn|bun)\s+(?:run\s+)?(typecheck|type-check|lint)\b/.test(step);
};

// The folder a shell line moves into first ("cd ~/app && ..."), unresolved; null when it starts elsewhere.
export function cdTarget(command: string): string | null {
  const first = command.split(/&&|;|\n/)[0].trim();
  const match = /^cd\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s*$/.exec(first);
  return match ? match[1] ?? match[2] ?? match[3] : null;
}

// Test loop: Claude writes scenarios, runs the pipeline, files real bugs, fixes them and runs again, round by round.
// Petal only sends the brief, reads the criteria file and the Loop lines, and can stop it. Pure helpers both sides share.
import { isTerminal, type LoopProgress } from './loop-line';
import type { StackItem, StageConfig } from './testing';
import { suitePath } from './task-suite';
import { DEFAULT_AGENT_NAMES, type AgentRole } from './agent-names';

export const CRITERIA_PATH = '.petal/test-criteria.md';
export const CRITERIA_CAP = 64 * 1024; // bytes read; a bigger file shows its first part
export const ITEMS_CAP = 200; // per section
export const DEFAULT_ROUNDS = 5;
export const MAX_ROUNDS = 10;
export const FOCUS_CAP = 200;

export const STOP_MESSAGE = 'Stop the test loop now. Leave the code as it is and summarise: round reached, bugs fixed, bugs still open, files changed.';

// ---- The criteria file: "## Scenarios" and "## Bugs", one "- [status] name · test: path::name · round n" per item,
// with "· task: <id>" when the loop runs for a task.
export const CRITERIA_STATUSES = ['pass', 'fail', 'flaky', 'fixed'] as const;
export type CriteriaStatus = typeof CRITERIA_STATUSES[number];

export interface CriteriaItem {
  status: CriteriaStatus;
  name: string;
  test: { path: string; name: string | null } | null;
  round: number | null;
  regression: boolean; // a bug with a test that reproduces it
  taskId: string | null;
}

export interface Criteria { scenarios: CriteriaItem[]; bugs: CriteriaItem[]; malformed: number; truncated: boolean }

const HEADING = /^\s*#{1,6}\s+(scenarios|bugs)\b/i;
const OTHER_HEADING = /^\s*#{1,6}\s/;
const ITEM = /^\s*[-*]\s+\[([^\]]*)\]\s*(.*)$/;
const SEP = /\s+[·•]\s+/;

function parseItem(line: string, section: 'scenarios' | 'bugs'): CriteriaItem | null {
  const match = ITEM.exec(line);
  if (!match) return null;
  const status = (match[1] ?? '').trim().toLowerCase() as CriteriaStatus;
  if (!CRITERIA_STATUSES.includes(status)) return null;
  const [name = '', ...parts] = (match[2] ?? '').split(SEP).map((p) => p.trim());
  if (!name || /^([·•]|test:)/i.test(name)) return null; // a name is required
  let test: CriteriaItem['test'] = null;
  let round: number | null = null;
  let taskId: string | null = null;
  for (const part of parts) {
    const testPart = /^test:\s*(.+)$/i.exec(part);
    const roundPart = /^round\s+(\d{1,3})$/i.exec(part);
    const taskPart = /^task:\s*([\w-]{1,64})$/i.exec(part);
    if (taskPart?.[1]) {
      taskId = taskPart[1];
    } else if (testPart?.[1]) {
      const [file, ...rest] = testPart[1].split('::');
      test = { path: file.trim(), name: rest.length ? rest.join('::').trim() || null : null };
    } else if (roundPart?.[1]) {
      round = Number(roundPart[1]);
    } else {
      return null;
    }
  }
  return { status, name: name.slice(0, 300), test, round, regression: section === 'bugs' && test !== null, taskId };
}

// Lines outside the two sections are ignored; a list line inside one that doesn't fit the format counts as malformed.
export function parseCriteria(text: string, truncated = false): Criteria {
  const out: Criteria = { scenarios: [], bugs: [], malformed: 0, truncated };
  let section: 'scenarios' | 'bugs' | null = null;
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const heading = HEADING.exec(line);
    if (heading?.[1]) { section = heading[1].toLowerCase() as 'scenarios' | 'bugs'; continue; }
    if (OTHER_HEADING.test(line)) { section = null; continue; }
    if (!section || !/^\s*[-*]\s/.test(line)) continue;
    const item = parseItem(line, section);
    if (!item) { out.malformed += 1; continue; }
    if (out[section].length < ITEMS_CAP) out[section].push(item);
  }
  return out;
}

export const openBugs = (criteria: Criteria): number => criteria.bugs.filter((b) => b.status === 'fail').length;

export const CRITERIA_SKELETON = '# Test criteria\n\nKept by Claude during Petal’s test loop.\n\n## Scenarios\n\n## Bugs\n';

// ---- The brief Petal sends once; Claude runs the loop.
// agent: the task's testing agent, which owns the tests and suite and works beside the bug fix agent.
export interface BriefInput { focus: string; rounds: number; stages: StageConfig[]; stack: StackItem[]; taskId?: string | null; agent?: boolean; names?: Record<AgentRole, string> }

export const clampRounds = (n: unknown): number => {
  const value = Math.round(Number(n));
  return Number.isFinite(value) ? Math.min(MAX_ROUNDS, Math.max(1, value)) : DEFAULT_ROUNDS;
};

// One line, no controls or long dashes, capped; the focus goes inside the brief as text.
// eslint-disable-next-line no-control-regex -- stripping controls is the point
export const cleanFocus = (focus: string): string => focus.replace(/[\x00-\x1F\x7F\s\u2014\u2013]+/g, ' ').trim().slice(0, FOCUS_CAP);

// Each round's self-review; Petal reads the section and the Course line (shared/distillation.ts).
export const DISTILL_BRIEF = [
  '6. Distillation: before you end the round, review it yourself. From round 2 on, start by revisiting every open thread from your previous round: settle it with evidence, carry it forward (and list it again under Open threads), or drop it with a reason, as a Q/A whose answer starts with settled, carried or dropped. Then ask yourself 3 to 6 pointed questions, such as: what changed this round, what is still untested for the focus, why did a test fail, is that failure flaky or real, does the fix cover the cause or only the symptom, what would a user hit next. Answer each one yourself from evidence (test output, the code, the criteria file), never from memory.',
  '   Any question you could not settle from evidence goes under Open threads instead, with the check that would settle it. A thread only I can settle has a check that starts with "needs you · " and says what you need from me.',
  '   Write it in your reply, before the Loop line, exactly like this:',
  '   ## Distillation',
  '   - Q: an open thread from last round · A: settled · the evidence that settled it',
  '   - Q: the question · A: your answer',
  '   **Course:** retest · one clause saying why',
  '   ## Open threads',
  '   - A question you could not settle? *Check: the command or file that would settle it*',
  '   - A question only I can settle? *Check: needs you · what you need from me*',
  '   The course is one of add scenarios, retest, fix bug, hand to you. Then act on it yourself: add scenarios, rerun, or fix the bug in the next step. For hand to you, stop there and wait for my answer. A needs-you thread with another course: keep going and use my answer when it arrives.',
];

export function buildLoopBrief({ focus, rounds, stages, stack, taskId = null, agent = false, names = DEFAULT_AGENT_NAMES }: BriefInput): string {
  const n = clampRounds(rounds);
  const what = cleanFocus(focus);
  const tools = stack.filter((s) => !s.insert && s.kind !== 'ci');
  const maestro = tools.some((s) => /maestro/i.test(s.label));
  const tester = Boolean(taskId && agent); // the testing agent, working beside the bug fix agent
  const lines = [
    tester
      ? `You are ${names.tester}, this task's testing agent. Run a test loop, up to ${n} round${n === 1 ? '' : 's'}, while ${names.fixer} fixes the bugs you find in its own session. Petal shows your progress from the lines below, so keep their format exactly.`
      : `Run a test loop on this project, up to ${n} round${n === 1 ? '' : 's'}. Petal shows your progress from the lines below, so keep their format exactly.`,
    '',
    `Focus: ${what || 'the whole project; start with the riskiest untested paths'}.`,
    ...(tools.length ? [`Stack: ${tools.map((t) => `${t.label} (${t.foundIn})`).join(', ')}.`] : []),
    `${taskId ? 'This task’s suite' : 'Pipeline'}, in this order:`,
    ...stages.map((s, i) => `${i + 1}. ${s.name}: \`${s.command}\``),
    ...(tester && taskId ? [`The suite lives in ${suitePath(taskId)}. You own it and the tests: you may change it during the loop (add, fix or remove stages), keeping its shape: {"stages": [{"name": "Unit", "command": "npm test"}]}. Petal takes the change and shows it with an Undo.`] : []),
    `Criteria file: ${CRITERIA_PATH}`,
    '',
    'Each round:',
    `1. Scenarios: write new scenarios for the focus as real tests in the project's existing test folders, using its own frameworks${maestro ? ', plus Maestro flows next to the existing ones' : ''}. Add each under Scenarios in the criteria file.`,
    `2. Testing: run the ${taskId ? 'suite' : 'pipeline'} commands above, in order.`,
    '3. Before calling a failure a bug, run that test once more. If it passes, record it as flaky, not a bug.',
    tester
      ? `4. For each real bug: write or keep a regression test that reproduces it and fails, and add it under Bugs as [fail] with that test. Never edit app code: Petal hands each bug to ${names.fixer}, then asks you to verify its fix. Keep going; never wait for the fixes.`
      : '4. For each real bug: add it under Bugs, write or keep a regression test that reproduces it and fails first, fix the code, then run the pipeline again.',
    '5. A stage that fails for an environment reason (missing dependency, wrong command, port in use) is not a product bug: diagnose it, repair the environment or command, and say what you changed. Never weaken, skip or delete a test to get green. Never edit snapshot baselines without saying why.',
    ...(tester ? DISTILL_BRIEF.map((line) => line.replace('or fix the bug in the next step', `or file the bug for ${names.fixer}`)) : DISTILL_BRIEF),
    '',
    'Criteria file format: a "## Scenarios" section and a "## Bugs" section, one line per item:',
    `- [status] name · test: path::test name · round n${taskId ? ` · task: ${taskId}` : ''}`,
    `where status is pass, fail, flaky or fixed.${taskId ? ` Keep "task: ${taskId}" on every line you add, so Petal files it under this task.` : ''}`,
    '',
    `End each round, and every reply during the loop, with this line: **Loop:** round 1/${n} · scenarios · 0 open`,
    tester ? 'The phase is one of scenarios, testing, verifying, done, stopped. Open is the number of bugs not yet fixed.' : 'The phase is one of scenarios, testing, fixing, verifying, done, stopped. Open is the number of bugs not yet fixed.',
    '',
    tester
      ? `Stop when the suite is green, no bug is left open and your latest round found nothing new, or after round ${n}. Then use the phase done and give a short summary: rounds run, bugs filed, bugs verified, bugs still open, flaky tests, environment repairs, files changed. If I stop the loop, use the phase stopped.`
      : `Stop when the pipeline is green and the round found no new bugs, after round ${n}, or when a round fixed nothing. Then use the phase done and give a short summary: rounds run, bugs fixed, bugs still open, flaky tests, environment repairs, files changed. If I stop the loop, use the phase stopped.`,
    '',
    'Never commit, push, or change git history. Messages I send during the loop come first: read them before your next step and follow them.',
  ];
  return lines.join('\n');
}

export interface FixerBriefInput { taskId: string; taskTitle: string; stages: StageConfig[]; names?: Record<AgentRole, string> }

// The bug fix agent: one bug at a time from Petal, app code only, a Fix line when each is done.
export function buildFixerBrief({ taskId, taskTitle, stages, names = DEFAULT_AGENT_NAMES }: FixerBriefInput): string {
  return [
    `You are ${names.fixer}, the bug fix agent for the task "${taskTitle.replace(/[.!?]+$/, '')}" (${taskId}). ${names.tester} is testing the same task in its own session and files the bugs it finds.`,
    '',
    'Petal sends you one bug at a time: its name, the failing test and the failure output. For each:',
    '1. Read the failing test and find the cause in the app code.',
    `2. Fix the app code only. Never edit tests, test data, snapshot baselines or ${suitePath(taskId)}: they belong to ${names.tester}.`,
    '3. Run that one test to confirm, plus a quick check of the code around it.',
    '4. End your reply with this line: **Fix:** the bug name · done',
    '   If you can’t fix it, end with **Fix:** the bug name · blocked, and say why in one line.',
    '',
    `The task's suite, for reference: ${stages.map((s) => `${s.name} (\`${s.command}\`)`).join(', ') || 'none yet'}.`,
    'Until the first bug arrives, read the code this task touches and wait. Reply "Ready." now.',
    '',
    'Never commit, push, or change git history. Messages I send come first: read them before your next step and follow them.',
  ].join('\n');
}

// ---- Where the brief goes: the project's live Claude tab, else a new tab that starts claude with it.
export type LoopTarget = { kind: 'paste'; tabId: string } | { kind: 'new-tab' };

export function loopTarget(sessionTab: string | null, isLive: (tabId: string) => boolean): LoopTarget {
  return sessionTab && isLive(sessionTab) ? { kind: 'paste', tabId: sessionTab } : { kind: 'new-tab' };
}

// ---- Whether a loop is going: its latest Loop line, whether that claude is live, and what Petal itself did.
export type LoopStatus = 'idle' | 'starting' | 'running' | 'done' | 'stopped';
export const STARTING_GRACE_MS = 3 * 60 * 1000; // a new tab's claude may take a while to write its first line

export interface LoopFacts { progress: LoopProgress | null; live: boolean; startedAt: number | null; stoppedAt: number | null; now: number }

export function loopStatus({ progress, live, startedAt, stoppedAt, now }: LoopFacts): LoopStatus {
  if (progress && isTerminal(progress.phase)) return progress.phase as 'done' | 'stopped';
  if (stoppedAt !== null) return 'stopped';
  if (progress) return live ? 'running' : 'stopped';
  if (startedAt !== null && (live || now - startedAt < STARTING_GRACE_MS)) return 'starting';
  return 'idle';
}

export const isActive = (status: LoopStatus): boolean => status === 'starting' || status === 'running';

// ---- Stop: one Esc interrupts the current step, then the stop message once that claude is idle.
export interface StopDeps {
  sendEsc: () => void;
  isIdle: () => boolean;
  send: (text: string) => Promise<unknown>;
  sleep: (ms: number) => Promise<void>;
}
export const ESC_SETTLE_MS = 800; // Claude Code takes a moment to show the interrupt
export const IDLE_POLL_MS = 400;
export const IDLE_GIVE_UP_MS = 60_000; // still busy after this: send anyway, Claude Code queues it

export async function stopLoop({ sendEsc, isIdle, send, sleep }: StopDeps): Promise<'idle' | 'timeout'> {
  sendEsc();
  await sleep(ESC_SETTLE_MS);
  let waited = 0;
  while (!isIdle() && waited < IDLE_GIVE_UP_MS) {
    await sleep(IDLE_POLL_MS);
    waited += IDLE_POLL_MS;
  }
  const outcome = isIdle() ? 'idle' : 'timeout';
  await send(STOP_MESSAGE);
  return outcome;
}

// Stop halts both agents of a task's loop at once, each with its own Esc and stop message.
export const stopAll = (agents: readonly StopDeps[]): Promise<('idle' | 'timeout')[]> => Promise.all(agents.map(stopLoop));

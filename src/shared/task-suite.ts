// Each task's own testing suite. One copy per task: <repo>/.petal/suites/<taskId>.json, edited in Petal or by the task's testing agent.
// Pure: parsing that file, taking a change the testing agent made (with Undo), and which suite a task runs.
import { slugId, type StageConfig } from './testing';
import type { Task } from './tasks';

export interface TaskSuite {
  stages: StageConfig[];
  keepGoing: boolean; // run later stages after a failed one
  autoRun: boolean; // run after a Claude turn on this task that changed files
}

export const SUITES_DIR = '.petal/suites';
export const suitePath = (taskId: string): string => `${SUITES_DIR}/${taskId}.json`;
export const isTaskId = (id: unknown): id is string => typeof id === 'string' && /^[\w-]{1,64}$/.test(id);

export const MAX_SUITE_STAGES = 20;
export const SUITE_FILE_BYTES = 16 * 1024;
export const STAGE_NAME_CHARS = 60;
export const STAGE_COMMAND_CHARS = 2000;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const oneLine = (text: unknown, cap: number): string | null => {
  const value = typeof text === 'string' ? text.trim() : '';
  return value && value.length <= cap && !/[\r\n\0]/.test(value) ? value : null;
};

export type SuiteParse = { suite: TaskSuite } | { problem: string };

// { "stages": [{ "name", "command" }], "keepGoing"?, "autoRun"? } or just the list. Ids come from the names.
export function parseSuite(raw: unknown): SuiteParse {
  const body = Array.isArray(raw) ? { stages: raw } : raw;
  if (!isRecord(body) || !Array.isArray(body.stages)) return { problem: 'it should have a "stages" list' };
  if (!body.stages.length) return { problem: 'it has no stages' };
  if (body.stages.length > MAX_SUITE_STAGES) return { problem: `it has more than ${MAX_SUITE_STAGES} stages` };
  const stages: StageConfig[] = [];
  for (const [i, item] of body.stages.entries()) {
    const where = `stage ${i + 1}`;
    if (!isRecord(item)) return { problem: `${where} should be a name and a command` };
    const name = oneLine(item.name, STAGE_NAME_CHARS);
    if (!name) return { problem: `${where} needs a one-line name of ${STAGE_NAME_CHARS} characters or fewer` };
    const command = oneLine(item.command, STAGE_COMMAND_CHARS);
    if (!command) return { problem: `${where} needs a one-line command` };
    stages.push({ id: slugId(name, stages.map((s) => s.id)), name, command });
  }
  return { suite: { stages, keepGoing: body.keepGoing === true, autoRun: body.autoRun === true } };
}

export function parseSuiteText(text: string): SuiteParse {
  try {
    return parseSuite(JSON.parse(text));
  } catch {
    return { problem: 'it isn’t valid JSON' };
  }
}

// The file as Petal writes it, so Claude sees and edits the same shape.
export const suiteText = (suite: TaskSuite): string =>
  `${JSON.stringify({ stages: suite.stages.map(({ name, command }) => ({ name, command })), keepGoing: suite.keepGoing, autoRun: suite.autoRun }, null, 2)}\n`;

export const sameSuite = (a: TaskSuite | null, b: TaskSuite | null): boolean => (a && b ? suiteText(a) === suiteText(b) : a === b);

// What Petal remembers about a task's file, outside the repo: the text last taken, the suite it held, and the last agent change.
export interface SuiteChange {
  at: number;
  previous: TaskSuite | null; // what Undo puts back
}

export interface SuiteRecord {
  text: string | null; // the file as last taken; null when there was none
  good: TaskSuite | null; // the suite in use
  change: SuiteChange | null;
  problem: string | null; // why the file as it is now was not taken
}

export interface SuiteFileNow { text: string | null; at: number }

export const OUTSIDE_AGENT = 'Changed outside the testing agent, not applied.';

// Only the task's testing agent changes its suite. Writer: the session whose log last wrote the file, if any; agents: the
// session ids Petal launched as this task's testing agent. Anything else keeps the suite in use and says why; a rejected
// file is checked again on every read, so the agent's log catching up still counts.
export function takeSuiteFile(record: SuiteRecord | null, file: SuiteFileNow, writer: string | null, agents: readonly string[]): SuiteRecord | null {
  if (record ? record.text === file.text : file.text === null) return record?.problem ? { ...record, problem: null } : record;
  // First sight of a file nobody was seen writing, on a task with no testing agent: taken as it is. With an agent, its log may
  // not be read yet, so the file waits like any unattributed change and is taken with Undo once the log shows the write.
  if (!record && !writer && !agents.length && file.text !== null) {
    const parsed = parseSuiteText(file.text);
    return 'suite' in parsed ? { text: file.text, good: parsed.suite, change: null, problem: null } : { text: null, good: null, change: null, problem: `This suite’s file can’t be used: ${parsed.problem}.` };
  }
  const base: SuiteRecord = { text: record?.text ?? null, good: record?.good ?? null, change: record?.change ?? null, problem: null };
  if (!writer || !agents.includes(writer)) return { ...base, problem: OUTSIDE_AGENT };
  let next: TaskSuite | null = null;
  if (file.text !== null) {
    const parsed = parseSuiteText(file.text);
    if ('problem' in parsed) return { ...base, problem: `The testing agent’s change was not used: ${parsed.problem}.` };
    next = parsed.suite;
  }
  return { text: file.text, good: next, change: sameSuite(base.good, next) ? base.change : { at: file.at, previous: base.good }, problem: null };
}

// After Petal writes the file itself (her edit, a seed, an Undo).
export const writtenRecord = (suite: TaskSuite | null): SuiteRecord => ({ text: suite ? suiteText(suite) : null, good: suite, change: null, problem: null });

export interface TaskSuiteView { suite: TaskSuite | null; change: SuiteChange | null; problem: string | null; at?: number } // at: the file's last change
export type SuiteViews = Record<string, TaskSuiteView>;

// The suite to send for editing: every stage good, or nothing. No stages removes the suite.
export function checkSuite(raw: unknown): { ok: true; suite: TaskSuite | null } | { ok: false } {
  if (isRecord(raw) && Array.isArray(raw.stages) && !raw.stages.length) return { ok: true, suite: null };
  const parsed = parseSuite(raw);
  return 'suite' in parsed ? { ok: true, suite: parsed.suite } : { ok: false };
}

export const emptySuite = (stages: StageConfig[] = []): TaskSuite => ({ stages: stages.map((s) => ({ ...s })), keepGoing: false, autoRun: false });

export interface SuiteFor {
  suite: TaskSuite;
  owner: Task; // the task whose suite it is: this one, or a subtask's parent
}

// The suite a task runs: its own, else its parent's; null when neither has one.
export function suiteFor(tasks: readonly Task[], suites: SuiteViews, id: string | null): SuiteFor | null {
  const task = tasks.find((t) => t.id === id);
  if (!task) return null;
  const own = suites[task.id]?.suite;
  if (own) return { suite: own, owner: task };
  const parent = task.parentId ? tasks.find((t) => t.id === task.parentId) : undefined;
  const borrowed = parent ? suites[parent.id]?.suite : null;
  return parent && borrowed ? { suite: borrowed, owner: parent } : null;
}

// Records tagged with this task; a task's runs, criteria and rounds are its own.
export const forTask = <T extends { taskId?: string | null }>(items: readonly T[], id: string | null): T[] =>
  id ? items.filter((item) => item.taskId === id) : [];

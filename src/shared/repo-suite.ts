// The repo's one testing suite: <main checkout>/.petal/suite.json, shared by every worktree and every Claude session.
// Pure: parsing and writing that file, taking any change with Undo, levels, and which stages a Run runs.
import { slugId, type StageConfig } from './testing';

export const LEVELS = ['smoke', 'regression', 'staging'] as const;
export type Level = typeof LEVELS[number];
export const isLevel = (value: unknown): value is Level => typeof value === 'string' && (LEVELS as readonly string[]).includes(value);

export interface SuiteStage extends StageConfig {
  level: Level;
  optIn?: boolean; // never in Run or auto-run unless she turns it on
  note?: string; // why it is opt-in, or what blocks it
}

export interface RepoSuite {
  stages: SuiteStage[];
  keepGoing: boolean; // run later stages after a failed one
  autoRun: boolean; // run after a Claude turn that changed files
}

export const PETAL_DIR = '.petal';
export const SUITE_PATH = `${PETAL_DIR}/suite.json`;
export const CRITERIA_PATH = `${PETAL_DIR}/criteria.md`;
export const LEGACY_SUITES_DIR = `${PETAL_DIR}/suites`; // one file per task, before suites were per repo

// The file in the main checkout, as agents are told it: an absolute path when the checkout is known.
export const inHome = (home: string | null, rel: string): string => (home ? `${home.replace(/\/+$/, '')}/${rel}` : rel);

export const isTaskId = (id: unknown): id is string => typeof id === 'string' && /^[\w-]{1,64}$/.test(id);

export const MAX_SUITE_STAGES = 20;
export const SUITE_FILE_BYTES = 16 * 1024;
export const STAGE_NAME_CHARS = 60;
export const STAGE_COMMAND_CHARS = 2000;
export const STAGE_NOTE_CHARS = 300;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const oneLine = (text: unknown, cap: number): string | null => {
  const value = typeof text === 'string' ? text.trim() : '';
  return value && value.length <= cap && !/[\r\n\0]/.test(value) ? value : null;
};

export type SuiteParse = { suite: RepoSuite } | { problem: string };

// { "stages": [{ "name", "command", "level", "optIn"?, "note"? }], "keepGoing"?, "autoRun"? } or just the list.
// A stage with no level is regression, so older task files still read. Ids come from the names.
export function parseSuite(raw: unknown): SuiteParse {
  const body = Array.isArray(raw) ? { stages: raw } : raw;
  if (!isRecord(body) || !Array.isArray(body.stages)) return { problem: 'it should have a "stages" list' };
  if (!body.stages.length) return { problem: 'it has no stages' };
  if (body.stages.length > MAX_SUITE_STAGES) return { problem: `it has more than ${MAX_SUITE_STAGES} stages` };
  const stages: SuiteStage[] = [];
  for (const [i, item] of body.stages.entries()) {
    const where = `stage ${i + 1}`;
    if (!isRecord(item)) return { problem: `${where} should be a name and a command` };
    const name = oneLine(item.name, STAGE_NAME_CHARS);
    if (!name) return { problem: `${where} needs a one-line name of ${STAGE_NAME_CHARS} characters or fewer` };
    const command = oneLine(item.command, STAGE_COMMAND_CHARS);
    if (!command) return { problem: `${where} needs a one-line command` };
    if (item.level !== undefined && !isLevel(item.level)) return { problem: `${where} has a level that isn’t smoke, regression or staging` };
    const note = item.note === undefined ? null : oneLine(item.note, STAGE_NOTE_CHARS);
    if (item.note !== undefined && !note) return { problem: `${where} needs a one-line note of ${STAGE_NOTE_CHARS} characters or fewer` };
    stages.push({
      id: slugId(name, stages.map((s) => s.id)), name, command, level: isLevel(item.level) ? item.level : 'regression',
      ...(item.optIn === true ? { optIn: true } : {}), ...(note ? { note } : {}),
    });
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

const stageJson = ({ name, command, level, optIn, note }: SuiteStage) => ({ name, command, level, ...(optIn ? { optIn: true } : {}), ...(note ? { note } : {}) });

// The file as Petal writes it, so Claude sees and edits the same shape.
export const suiteText = (suite: RepoSuite): string =>
  `${JSON.stringify({ stages: suite.stages.map(stageJson), keepGoing: suite.keepGoing, autoRun: suite.autoRun }, null, 2)}\n`;

export const sameSuite = (a: RepoSuite | null, b: RepoSuite | null): boolean => (a && b ? suiteText(a) === suiteText(b) : a === b);

// What Petal remembers about the file, outside the repo: the text last taken, the suite it held, and the last change.
export interface SuiteChange {
  at: number;
  previous: RepoSuite | null; // what Undo puts back
}

export interface SuiteRecord {
  text: string | null; // the file as last taken; null when there was none
  good: RepoSuite | null; // the suite in use
  change: SuiteChange | null;
  problem: string | null; // why the file as it is now was not taken
}

export interface SuiteFileNow { text: string | null; at: number }

// Any session's change is taken, with Undo. A file that doesn't parse keeps the suite in use and says why.
export function takeSuiteFile(record: SuiteRecord | null, file: SuiteFileNow): SuiteRecord | null {
  if (record ? record.text === file.text : file.text === null) return record;
  const base: SuiteRecord = { text: record?.text ?? null, good: record?.good ?? null, change: record?.change ?? null, problem: null };
  let next: RepoSuite | null = null;
  if (file.text !== null) {
    const parsed = parseSuiteText(file.text);
    if ('problem' in parsed) return { ...base, problem: `The suite file can’t be used: ${parsed.problem}.` };
    next = parsed.suite;
  }
  if (!record) return { text: file.text, good: next, change: null, problem: null }; // first sight: taken as it is
  return { text: file.text, good: next, change: sameSuite(base.good, next) ? base.change : { at: file.at, previous: base.good }, problem: null };
}

// After Petal writes the file itself (her edit, a seed, an Undo).
export const writtenRecord = (suite: RepoSuite | null): SuiteRecord => ({ text: suite ? suiteText(suite) : null, good: suite, change: null, problem: null });

// home: the main checkout holding the file. at: the file's last change.
export interface RepoSuiteView { suite: RepoSuite | null; change: SuiteChange | null; problem: string | null; home: string | null; at?: number }
export const NO_SUITE: RepoSuiteView = { suite: null, change: null, problem: null, home: null };

// The suite to send for editing: every stage good, or nothing. No stages removes the suite.
export function checkSuite(raw: unknown): { ok: true; suite: RepoSuite | null } | { ok: false } {
  if (isRecord(raw) && Array.isArray(raw.stages) && !raw.stages.length) return { ok: true, suite: null };
  const parsed = parseSuite(raw);
  return 'suite' in parsed ? { ok: true, suite: parsed.suite } : { ok: false };
}

export const asSuiteStage = (stage: StageConfig): SuiteStage => ({ level: 'regression', ...stage });

export const emptySuite = (stages: StageConfig[] = []): RepoSuite => ({ stages: stages.map(asSuiteStage), keepGoing: false, autoRun: false });

// Stages from b join a by name; a's stage wins, and the list stops at the cap.
export function mergeSuites(a: RepoSuite | null, b: RepoSuite): RepoSuite {
  const stages = [...(a?.stages ?? [])];
  for (const stage of b.stages) {
    if (stages.length >= MAX_SUITE_STAGES) break;
    if (!stages.some((s) => s.name === stage.name)) stages.push({ ...stage, id: slugId(stage.name, stages.map((s) => s.id)) });
  }
  return { stages, keepGoing: a ? a.keepGoing : b.keepGoing, autoRun: a ? a.autoRun : b.autoRun };
}

// Her filter: levels picked (none picked shows every level) and the opt-in stages she turned on.
export interface StageFilter { levels: readonly Level[]; optedIn: readonly string[] }

export const shownStages = (stages: readonly SuiteStage[], levels: readonly Level[]): SuiteStage[] =>
  stages.filter((s) => !levels.length || levels.includes(s.level));

// What Run runs: the shown stages, opt-in ones only when turned on; stageId narrows it to that one stage.
export function stagesToRun(stages: readonly SuiteStage[], filter: StageFilter, stageId: string | null = null): SuiteStage[] {
  return shownStages(stages, filter.levels).filter((s) => (!stageId || s.id === stageId) && (!s.optIn || filter.optedIn.includes(s.id)));
}

// Auto-run never runs an opt-in stage.
export const autoRunStages = (stages: readonly SuiteStage[]): SuiteStage[] => stages.filter((s) => !s.optIn);

// Records tagged with this task; a task's runs and rounds are its own.
export const forTask = <T extends { taskId?: string | null }>(items: readonly T[], id: string | null): T[] =>
  id ? items.filter((item) => item.taskId === id) : [];

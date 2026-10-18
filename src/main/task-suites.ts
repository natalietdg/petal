// Each task's suite file, <repo>/.petal/suites/<taskId>.json: read with a size cap and no symlinks, written atomically
// inside the repo. A change by the task's testing agent is taken on the next read, with Undo; any other change is not.
// The agents' session ids and what Petal took are kept in the testing store, outside the repo.
import fs from 'node:fs';
import path from 'node:path';
import { writeFileDurable } from './atomic-file';
import { ensureSelfIgnore } from './factory-store';
import * as store from './testing-store';
import type { SuiteWrite } from './testing-claude';
import {
  SUITE_FILE_BYTES, isTaskId, suitePath, suiteText, takeSuiteFile, writtenRecord,
  type SuiteFileNow, type SuiteRecord, type SuiteViews, type TaskSuite,
} from '../shared/task-suite';
import type { Task } from '../shared/tasks';

export const suiteFile = (root: string, taskId: string): string => path.join(root, ...suitePath(taskId).split('/'));

// The file now; text null when there is none. Too big, or not a plain file, reads as text that won't parse.
export function readSuiteFile(root: string, taskId: string): SuiteFileNow {
  const file = suiteFile(root, taskId);
  let stat: fs.Stats;
  try {
    if (!fs.lstatSync(path.dirname(file)).isDirectory()) return { text: null, at: 0 };
    stat = fs.lstatSync(file);
  } catch {
    return { text: null, at: 0 };
  }
  if (!stat.isFile() || stat.size > SUITE_FILE_BYTES) return { text: `<${stat.isFile() ? 'over 16 KB' : 'not a plain file'}>`, at: stat.mtimeMs };
  try {
    return { text: fs.readFileSync(file, 'utf8'), at: stat.mtimeMs };
  } catch {
    return { text: null, at: 0 };
  }
}

// The session whose log last wrote this task's file.
const lastWriter = (writes: readonly SuiteWrite[], taskId: string): string | null =>
  writes.filter((w) => w.taskId === taskId).sort((a, b) => b.at - a.at)[0]?.sessionId ?? null;

const MAX_AGENTS = 20; // per task, newest kept

export const agentsOf = (root: string, taskId: string): string[] => store.load(root).agents?.[taskId] ?? [];

// The task a testing agent session works for; null for any other session.
export function agentTaskOf(root: string, sessionId: string | null | undefined): string | null {
  if (!sessionId) return null;
  const agents = store.load(root).agents ?? {};
  return Object.keys(agents).find((taskId) => agents[taskId]?.includes(sessionId)) ?? null;
}

export function rememberAgent(root: string, taskId: string, sessionId: string): void {
  const data = store.load(root);
  const kept = [...(data.agents?.[taskId] ?? []).filter((id) => id !== sessionId), sessionId].slice(-MAX_AGENTS);
  store.save({ ...data, agents: { ...(data.agents ?? {}), [taskId]: kept } });
}

// Takes the testing agents' changes to the tasks' files and returns each task's suite. Writes the store only when something changed.
export function syncSuites(root: string, tasks: readonly Task[], writes: readonly SuiteWrite[] = []): SuiteViews {
  const data = store.load(root);
  const records: Record<string, SuiteRecord> = { ...(data.suites ?? {}) };
  let changed = false;
  const views: SuiteViews = {};
  for (const task of tasks) {
    if (!isTaskId(task.id)) continue;
    const before = records[task.id] ?? null;
    const after = takeSuiteFile(before, readSuiteFile(root, task.id), lastWriter(writes, task.id), data.agents?.[task.id] ?? []);
    if (after && JSON.stringify(after) !== JSON.stringify(before)) { records[task.id] = after; changed = true; }
    if (after) views[task.id] = { suite: after.good, change: after.change, problem: after.problem };
  }
  if (changed) store.save({ ...data, suites: records });
  return views;
}

// Her edit, a seed or an Undo: the file is written (or removed for no suite) and remembered as taken.
export function writeSuite(root: string, taskId: string, suite: TaskSuite | null): void {
  if (!isTaskId(taskId)) throw new Error('That task id can’t name a file.');
  const file = suiteFile(root, taskId);
  if (suite) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    ensureSelfIgnore(path.join(root, '.petal'), root);
    writeFileDurable(file, suiteText(suite), undefined, { within: root });
  } else {
    fs.rmSync(file, { force: true });
  }
  const data = store.load(root);
  store.save({ ...data, suites: { ...(data.suites ?? {}), [taskId]: writtenRecord(suite) } });
}

// Puts back the suite from before the last outside change; false when there is nothing to undo.
export function undoSuiteChange(root: string, taskId: string): boolean {
  const change = store.load(root).suites?.[taskId]?.change;
  if (!change) return false;
  writeSuite(root, taskId, change.previous);
  return true;
}

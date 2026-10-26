// The repo's criteria file, <main checkout>/.petal/criteria.md: scenarios, manual cases and bugs, written by any Claude
// session and read by Petal. Older per-task files (.petal/criteria/<taskId>.md, .petal/test-criteria.md) are imported
// once, each line tagged with its task's AB# ticket, and left as they are.
import fs from 'node:fs';
import path from 'node:path';
import { writeFileDurable } from './atomic-file';
import { loadTasks } from './tasks-store';
import * as store from './testing-store';
import { preparePetalDir, suiteHome } from './repo-suite-store';
import { CRITERIA_PATH, isTaskId } from '../shared/repo-suite';
import {
  CRITERIA_CAP, CRITERIA_DIR, CRITERIA_SKELETON, LEGACY_CRITERIA_PATH, SECTIONS, addCriteriaItems, parseCriteria, setManualResult, setScenarioStatuses, ticketInText,
  type Criteria, type CriteriaItem, type CriteriaSection, type ManualStatus,
} from '../shared/test-loop';
import type { Task } from '../shared/tasks';

const FILES_CAP = 500; // older task files read at most

export const criteriaFile = (root: string): string => path.join(suiteHome(root), ...CRITERIA_PATH.split('/'));

// The repo's file, made with the skeleton (and .petal/ kept out of git) when missing.
export function prepareCriteria(root: string): void {
  const home = suiteHome(root);
  preparePetalDir(home);
  const file = criteriaFile(root);
  if (!fs.existsSync(file)) writeFileDurable(file, CRITERIA_SKELETON, undefined, { within: home });
}

// A test loop or suite draft was started here at some point: the repo has a criteria file, or an older one.
export const loopPrepared = (root: string): boolean => fs.existsSync(criteriaFile(root)) || legacyCriteriaFiles(root).length > 0;

// The first CRITERIA_CAP bytes of a plain file; null for none, a link, or a folder.
function readCapped(file: string): { text: string; truncated: boolean } | null {
  let fd: number;
  try {
    if (!fs.lstatSync(file).isFile()) return null;
    fd = fs.openSync(file, 'r');
  } catch {
    return null;
  }
  try {
    const size = fs.fstatSync(fd).size;
    const buffer = Buffer.alloc(Math.min(size, CRITERIA_CAP));
    const read = fs.readSync(fd, buffer, 0, buffer.length, 0);
    return { text: buffer.toString('utf8', 0, read), truncated: size > CRITERIA_CAP };
  } finally {
    fs.closeSync(fd);
  }
}

// Each older criteria file, in the main checkout and this checkout, with the task its name gives (null for the shared one).
export function legacyCriteriaFiles(root: string): { file: string; taskId: string | null }[] {
  return [...new Set([suiteHome(root), root])].flatMap((dir) => {
    const shared = path.join(dir, ...LEGACY_CRITERIA_PATH.split('/'));
    const own = path.join(dir, ...CRITERIA_DIR.split('/'));
    let names: string[] = [];
    try { names = fs.readdirSync(own); } catch { /* no task files */ }
    const files = names.filter((n) => n.endsWith('.md') && isTaskId(n.slice(0, -3))).sort().slice(0, FILES_CAP).map((n) => ({ file: path.join(own, n), taskId: n.slice(0, -3) }));
    return [...(fs.existsSync(shared) ? [{ file: shared, taskId: null }] : []), ...files];
  });
}

// An older line as the repo file keeps it: its task's AB# id as its ticket, no task part.
export function importedItem(item: CriteriaItem, taskId: string | null, tasks: readonly Task[]): CriteriaItem {
  const task = tasks.find((t) => t.id === (item.taskId ?? taskId));
  return { ...item, taskId: null, ticket: item.ticket ?? (task ? ticketInText(task.title) : null) };
}

// Older files not imported yet: their items join the repo file by name, each section's own. A file too big to read whole
// is left for later rather than half-imported.
export function importLegacyCriteria(root: string, tasks: readonly Task[]): void {
  const home = suiteHome(root);
  const done = new Set(store.load(home).imported ?? []);
  const fresh = legacyCriteriaFiles(root).filter(({ file }) => !done.has(file));
  if (!fresh.length) return;
  const add: Record<CriteriaSection, CriteriaItem[]> = { scenarios: [], manual: [], bugs: [] };
  for (const { file, taskId } of fresh) {
    const old = readCapped(file);
    if (old?.truncated) continue;
    if (old) {
      const parsed = parseCriteria(old.text);
      for (const section of SECTIONS) add[section].push(...parsed[section].map((item) => importedItem(item, taskId, tasks)));
    }
    done.add(file);
  }
  const target = criteriaFile(root);
  const existing = readCapped(target);
  if (existing?.truncated) return;
  if (SECTIONS.some((s) => add[s].length)) {
    preparePetalDir(home);
    const next = addCriteriaItems(existing?.text ?? null, add);
    if (next !== existing?.text) writeFileDurable(target, next, undefined, { within: home });
  }
  store.save({ ...store.load(home), imported: [...done] });
}

// The repo's criteria; null when it has no criteria file.
export function readCriteria(root: string, tasks: readonly Task[] = loadTasks(root).tasks): Criteria | null {
  try { importLegacyCriteria(root, tasks); } catch (error) { console.warn('[petal] older criteria not imported:', (error as Error).message); }
  const file = readCapped(criteriaFile(root));
  return file ? parseCriteria(file.text, file.truncated) : null;
}

// Her tick on a manual case, written back into the file; null when done, else why not.
export function saveManualResult(root: string, name: string, status: ManualStatus, result: string): string | null {
  const file = readCapped(criteriaFile(root));
  if (!file) return 'The repo has no criteria file yet.';
  if (file.truncated) return 'The criteria file is too long for Petal to write back safely.';
  const next = setManualResult(file.text, name, status, result);
  if (next === null) return 'That manual case is gone. It may have been edited in another session.';
  writeFileDurable(criteriaFile(root), next, undefined, { within: suiteHome(root) });
  return null;
}

// A scenario run's results written back as [pass] or [fail]; nothing when the file is gone or too long.
export function saveScenarioStatuses(root: string, statuses: Readonly<Record<string, 'pass' | 'fail'>>): void {
  const file = readCapped(criteriaFile(root));
  if (!file || file.truncated || !Object.keys(statuses).length) return;
  const next = setScenarioStatuses(file.text, statuses);
  if (next !== file.text) writeFileDurable(criteriaFile(root), next, undefined, { within: suiteHome(root) });
}

// The repo's criteria file, ~/.petal/repos/<repoKey>/criteria.md beside its suite: scenarios, manual cases and bugs,
// written by any Claude session and read by Petal. Older files among the copies of a checkout's old .petal/ (per-task
// criteria/<taskId>.md, test-criteria.md, a worktree's own criteria.md) are merged in once, tagged with their AB# ticket.
import fs from 'node:fs';
import path from 'node:path';
import { writeFileDurable } from './atomic-file';
import { loadTasks } from './tasks-store';
import * as store from './testing-store';
import { repoDir } from './petal-home';
import { prepareSuiteDir, suiteDir, suiteHome, wasImported, type LegacyFile } from './repo-suite-store';
import { CRITERIA_NAME, isTaskId } from '../shared/repo-suite';
import {
  CRITERIA_CAP, CRITERIA_DIR, CRITERIA_SKELETON, LEGACY_CRITERIA_PATH, SECTIONS, addCriteriaItems, parseCriteria, setManualResult, setScenarioStatuses, ticketInText,
  type Criteria, type CriteriaItem, type CriteriaSection, type ManualStatus,
} from '../shared/test-loop';
import type { Task } from '../shared/tasks';

const FILES_CAP = 500; // older task files read at most

export const criteriaFile = (root: string): string => path.join(suiteDir(suiteHome(root)), CRITERIA_NAME);

// The repo's file, made with the skeleton when missing.
export function prepareCriteria(root: string): void {
  const dir = prepareSuiteDir(suiteHome(root));
  const file = criteriaFile(root);
  if (!fs.existsSync(file)) writeFileDurable(file, CRITERIA_SKELETON, undefined, { within: dir });
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

const inPetal = (rel: string): string[] => rel.split('/').slice(1); // ".petal/x/y" as it sits in the repo's Petal folder

// Each older criteria file, with the task its name gives (null for a shared one): a worktree's own criteria.md, then
// test-criteria.md and per-task files copied from the main checkout and this checkout.
export function legacyCriteriaFiles(root: string): LegacyFile[] {
  const home = suiteHome(root);
  const ownFile = path.join(repoDir(root), CRITERIA_NAME);
  const own = root !== home && fs.existsSync(ownFile) ? [{ file: ownFile, original: path.join(root, '.petal', CRITERIA_NAME), taskId: null }] : [];
  return [...own, ...[...new Set([home, root])].flatMap((checkout) => {
    const dir = repoDir(checkout);
    const shared = path.join(dir, ...inPetal(LEGACY_CRITERIA_PATH));
    const sharedFrom = path.join(checkout, ...LEGACY_CRITERIA_PATH.split('/'));
    const ownDir = path.join(dir, ...inPetal(CRITERIA_DIR));
    let names: string[] = [];
    try { names = fs.readdirSync(ownDir); } catch { /* no task files */ }
    const files = names.filter((n) => n.endsWith('.md') && isTaskId(n.slice(0, -3))).sort().slice(0, FILES_CAP)
      .map((n) => ({ file: path.join(ownDir, n), original: path.join(checkout, ...CRITERIA_DIR.split('/'), n), taskId: n.slice(0, -3) }));
    return [...(fs.existsSync(shared) ? [{ file: shared, original: sharedFrom, taskId: null }] : []), ...files];
  })];
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
  const fresh = legacyCriteriaFiles(root).filter((f) => !wasImported(done, f));
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
    const dir = prepareSuiteDir(home);
    const next = addCriteriaItems(existing?.text ?? null, add);
    if (next !== existing?.text) writeFileDurable(target, next, undefined, { within: dir });
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
  writeFileDurable(criteriaFile(root), next, undefined, { within: suiteDir(suiteHome(root)) });
  return null;
}

// A scenario run's results written back as [pass] or [fail]; nothing when the file is gone or too long.
export function saveScenarioStatuses(root: string, statuses: Readonly<Record<string, 'pass' | 'fail'>>): void {
  const file = readCapped(criteriaFile(root));
  if (!file || file.truncated || !Object.keys(statuses).length) return;
  const next = setScenarioStatuses(file.text, statuses);
  if (next !== file.text) writeFileDurable(criteriaFile(root), next, undefined, { within: suiteDir(suiteHome(root)) });
}

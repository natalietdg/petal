// Each task's criteria file, <repo>/.petal/criteria/<taskId>.md, kept by its testing agent; Petal makes it and reads it.
// The old shared .petal/test-criteria.md is still read: its lines tagged with a task move to that task's file once.
import fs from 'node:fs';
import path from 'node:path';
import { writeFileDurable } from './atomic-file';
import { ensureSelfIgnore } from './factory-store';
import { loadTasks } from './tasks-store';
import { isTaskId } from '../shared/task-suite';
import {
  CRITERIA_CAP, CRITERIA_DIR, CRITERIA_SKELETON, addCriteriaLines, criteriaPath, mergeCriteria, ownedBy, parseCriteria, splitLegacyCriteria,
  type Criteria,
} from '../shared/test-loop';
import type { Task } from '../shared/tasks';

const FILES_CAP = 500; // task files read at most

export const criteriaFile = (root: string, taskId: string | null): string => path.join(root, ...criteriaPath(taskId).split('/'));
const criteriaDir = (root: string): string => path.join(root, ...CRITERIA_DIR.split('/'));

// The task's own file, made with the skeleton (and .petal/ kept out of git) before its loop starts.
export function prepareLoop(root: string, taskId: string | null): void {
  const file = criteriaFile(root, taskId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  ensureSelfIgnore(path.join(root, '.petal'), root);
  if (!fs.existsSync(file)) writeFileDurable(file, CRITERIA_SKELETON, undefined, { within: root });
}

// A test loop was started here at some point: the old shared file or any task's file exists.
export const loopPrepared = (root: string): boolean => fs.existsSync(criteriaFile(root, null)) || fs.existsSync(criteriaDir(root));

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

// The old shared file's tagged lines, moved to their tasks' files; the task files are written before the old one shrinks.
export function migrateCriteria(root: string): void {
  const legacy = readCapped(criteriaFile(root, null));
  if (!legacy || legacy.truncated) return; // a file too big to read whole is left alone
  const { keep, moved } = splitLegacyCriteria(legacy.text);
  const taskIds = Object.keys(moved);
  if (!taskIds.length) return;
  fs.mkdirSync(criteriaDir(root), { recursive: true });
  for (const taskId of taskIds) {
    const file = criteriaFile(root, taskId);
    const existing = readCapped(file);
    if (existing?.truncated) continue; // its lines stay in the old file rather than be lost
    writeFileDurable(file, addCriteriaLines(existing?.text ?? null, moved[taskId]), undefined, { within: root });
  }
  const left = taskIds.filter((id) => readCapped(criteriaFile(root, id))?.truncated);
  if (left.length) return; // retried next read; nothing is dropped
  writeFileDurable(criteriaFile(root, null), keep, undefined, { within: root });
}

// Every task's criteria in one list, each item tagged with its task; null when no criteria file exists.
// Untagged lines left in the old file belong to the project's only task, else to no task.
export function readCriteria(root: string, tasks: readonly Task[] = loadTasks(root).tasks): Criteria | null {
  try { migrateCriteria(root); } catch (error) { console.warn('[petal] criteria not moved to per-task files:', (error as Error).message); }
  const found: Criteria[] = [];
  const legacy = readCapped(criteriaFile(root, null));
  if (legacy) {
    const parsed = parseCriteria(legacy.text, legacy.truncated);
    found.push(tasks.length === 1 ? ownedBy(parsed, tasks[0].id, { untaggedOnly: true }) : parsed);
  }
  let names: string[] = [];
  try { names = fs.readdirSync(criteriaDir(root)); } catch { /* no task files yet */ }
  for (const name of names.filter((n) => n.endsWith('.md')).slice(0, FILES_CAP)) {
    const taskId = name.slice(0, -3);
    if (!isTaskId(taskId)) continue;
    const own = readCapped(path.join(criteriaDir(root), name));
    if (own) found.push(ownedBy(parseCriteria(own.text, own.truncated), taskId));
  }
  return found.length ? mergeCriteria(found) : null;
}

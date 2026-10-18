// A repo's PRDs and tasks at <repo>/.petal/tasks.json; a version 1 file reads as having no PRDs and is written back as 2. The folder ignores itself in git; writes are atomic and stay inside the repo.
// A file that doesn't parse is hers to fix: it is reported and never saved over.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { writeFileDurable } from './atomic-file';
import { ensureSelfIgnore } from './factory-store';
import { validateTaskFile, type Prd, type Task, type TaskData, type TaskFile } from '../shared/tasks';

export const tasksFile = (repo: string): string => path.join(repo, '.petal', 'tasks.json');

export interface TaskList extends TaskData {
  problem: string | null;
}

export function loadTasks(repo: string): TaskList {
  const file = tasksFile(repo);
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { tasks: [], prds: [], problem: null };
    return { tasks: [], prds: [], problem: `Couldn’t read ${file}.` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { tasks: [], prds: [], problem: `${file} isn’t valid JSON. Fix or delete it; Petal won’t replace it.` };
  }
  const check = validateTaskFile(raw);
  return check.ok ? { tasks: check.tasks, prds: check.prds, problem: null } : { tasks: [], prds: [], problem: `${file}: ${check.problem} Fix or delete it; Petal won’t replace it.` };
}

function saveTasks(repo: string, { tasks, prds }: TaskData): void {
  const file = tasksFile(repo);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  ensureSelfIgnore(path.dirname(file), repo);
  writeFileDurable(file, `${JSON.stringify({ version: 2, prds, tasks } satisfies TaskFile, null, 2)}\n`, undefined, { within: repo });
}

// Reads, applies `change`, writes. `change` returns null to leave the file alone; PRDs it doesn't return are kept.
export function updateTasks<T extends { tasks: Task[]; prds?: Prd[] }>(repo: string, change: (tasks: Task[], data: TaskData) => T | null): T | null {
  const { tasks, prds, problem } = loadTasks(repo);
  if (problem) throw new Error(problem);
  const result = change(tasks, { tasks, prds });
  if (result) saveTasks(repo, { tasks: result.tasks, prds: result.prds ?? prds });
  return result;
}

export const newTaskId = (): string => `t-${crypto.randomUUID().slice(0, 8)}`;
export const newPrdId = (): string => `p-${crypto.randomUUID().slice(0, 8)}`;

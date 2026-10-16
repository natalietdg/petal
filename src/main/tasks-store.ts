// A repo's task list at <repo>/.petal/tasks.json. The folder ignores itself in git; writes are atomic and stay inside the repo.
// A file that doesn't parse is hers to fix: it is reported and never saved over.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { writeFileDurable } from './atomic-file';
import { ensureSelfIgnore } from './factory-store';
import { validateTaskFile, type Task, type TaskFile } from '../shared/tasks';

export const tasksFile = (repo: string): string => path.join(repo, '.petal', 'tasks.json');

export interface TaskList {
  tasks: Task[];
  problem: string | null;
}

export function loadTasks(repo: string): TaskList {
  const file = tasksFile(repo);
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { tasks: [], problem: null };
    return { tasks: [], problem: `Couldn’t read ${file}.` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { tasks: [], problem: `${file} isn’t valid JSON. Fix or delete it; Petal won’t replace it.` };
  }
  const check = validateTaskFile(raw);
  return check.ok ? { tasks: check.tasks, problem: null } : { tasks: [], problem: `${file}: ${check.problem} Fix or delete it; Petal won’t replace it.` };
}

function saveTasks(repo: string, tasks: Task[]): void {
  const file = tasksFile(repo);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  ensureSelfIgnore(path.dirname(file), repo);
  writeFileDurable(file, `${JSON.stringify({ version: 1, tasks } satisfies TaskFile, null, 2)}\n`, undefined, { within: repo });
}

// Reads, applies `change`, writes. `change` returns null to leave the file alone.
export function updateTasks<T extends { tasks: Task[] }>(repo: string, change: (tasks: Task[]) => T | null): T | null {
  const { tasks, problem } = loadTasks(repo);
  if (problem) throw new Error(problem);
  const result = change(tasks);
  if (result) saveTasks(repo, result.tasks);
  return result;
}

export const newTaskId = (): string => `t-${crypto.randomUUID().slice(0, 8)}`;

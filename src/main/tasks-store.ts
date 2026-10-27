// A repo's PRDs and tasks at ~/.petal/repos/<repoKey>/tasks.json, keyed by the checkout as before; never in the repo.
// A version 1 file reads as having no PRDs and is written back as 2. Writes are atomic and stay inside that folder.
// A file that doesn't parse is hers to fix: it is reported and never saved over.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { writeFileDurable } from './atomic-file';
import { prepareRepoDir, repoDir } from './petal-home';
import { validateTaskFile, type Prd, type Task, type TaskData, type TaskFile } from '../shared/tasks';

export const tasksFile = (repo: string): string => path.join(repoDir(repo), 'tasks.json');

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
  const dir = prepareRepoDir(repo);
  writeFileDurable(tasksFile(repo), `${JSON.stringify({ version: 2, prds, tasks } satisfies TaskFile, null, 2)}\n`, undefined, { within: dir });
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

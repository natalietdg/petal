// Testing's link to the Board's tasks: which task a run or round belongs to, and what the scope switch needs.
import { loadTasks } from './tasks-store';
import { taskAt } from '../shared/test-scope';
import type { Prd, Task } from '../shared/tasks';

// The task id the session held at `at`; null when it held none or the task file can't be read.
export const taskIdAt = (root: string, sessionId: string | null | undefined, at: number, tasks: readonly Task[] = loadTasks(root).tasks): string | null =>
  taskAt(tasks, sessionId, at)?.id ?? null;

// The project's tasks and PRDs and the task the session holds now, for the Testing tab's scope switch.
export function scopeFacts(root: string, sessionId: string | null): { tasks: Task[]; prds: Prd[]; sessionTaskId: string | null } {
  const { tasks, prds } = loadTasks(root);
  return { tasks, prds, sessionTaskId: taskIdAt(root, sessionId, Date.now(), tasks) };
}

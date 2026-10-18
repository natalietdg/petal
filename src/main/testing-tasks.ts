// Testing's link to the Board's tasks: which task a run or round belongs to, and what the scope switch needs.
import { loadTasks } from './tasks-store';
import { agentTaskOf } from './task-suites';
import { taskAt } from '../shared/test-scope';
import type { Prd, Task } from '../shared/tasks';

// The task id the session held at `at`, or the task it is the testing agent for; null when neither.
export const taskIdAt = (root: string, sessionId: string | null | undefined, at: number, tasks: readonly Task[] = loadTasks(root).tasks): string | null =>
  taskAt(tasks, sessionId, at)?.id ?? agentTaskOf(root, sessionId);

// The project's tasks and PRDs and the task the session holds now, for the Testing tab's scope switch.
export function scopeFacts(root: string, sessionId: string | null): { tasks: Task[]; prds: Prd[]; sessionTaskId: string | null } {
  const { tasks, prds } = loadTasks(root);
  return { tasks, prds, sessionTaskId: taskIdAt(root, sessionId, Date.now(), tasks) };
}

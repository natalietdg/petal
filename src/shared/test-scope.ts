// Testing scoped to a task, its PRD, or the whole project. Runs, loop criteria and distillation carry the taskId
// of the session's task when they started; untagged records (older ones too) show only under Whole project.
import type { Task } from './tasks';

export type TestScope = 'task' | 'prd' | 'project';
export const SCOPE_WORDS: Record<TestScope, string> = { task: 'This task', prd: 'PRD', project: 'Whole project' };

// The task a session held at `at`: given to it by then and not finished before; the latest such one.
export function taskAt(tasks: readonly Task[], sessionId: string | null | undefined, at: number): Task | null {
  if (!sessionId) return null;
  const held = tasks.filter((t) => t.owner?.sessionId === sessionId && t.claimedAt !== null && t.claimedAt <= at && (t.doneAt === null || at <= t.doneAt));
  return held.sort((a, b) => (b.claimedAt ?? 0) - (a.claimedAt ?? 0))[0] ?? null;
}

// The task's PRD; a subtask's comes from its task.
export const prdOf = (tasks: readonly Task[], task: Task | null): string | null =>
  task ? (task.parentId ? tasks.find((t) => t.id === task.parentId)?.prdId ?? null : task.prdId) : null;

export const defaultScope = (taskId: string | null): TestScope => (taskId ? 'task' : 'project');

// The task ids a scope shows; null shows everything. A task brings its subtasks; a PRD brings all of its tasks.
export function scopeTaskIds(scope: TestScope, taskId: string | null, tasks: readonly Task[]): Set<string> | null {
  if (scope === 'project') return null;
  const task = tasks.find((t) => t.id === taskId) ?? null;
  if (!task) return new Set();
  if (scope === 'task') return new Set([task.id, ...tasks.filter((t) => t.parentId === task.id).map((t) => t.id)]);
  const prdId = prdOf(tasks, task);
  if (!prdId) return new Set();
  return new Set(tasks.filter((t) => prdOf(tasks, t) === prdId).map((t) => t.id));
}

export const inScope = (taskId: string | null | undefined, ids: Set<string> | null): boolean => ids === null || (Boolean(taskId) && ids.has(taskId as string));

export const scoped = <T extends { taskId?: string | null }>(items: readonly T[], ids: Set<string> | null): T[] =>
  ids === null ? [...items] : items.filter((item) => inScope(item.taskId, ids));

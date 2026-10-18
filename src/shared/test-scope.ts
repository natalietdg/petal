// Which task a run, loop line or distillation round belongs to: the task its session held when it started.
// Untagged records (older ones too) belong to no task.
import type { Task } from './tasks';

// The task a session held at `at`: given to it by then and not finished before; the latest such one.
export function taskAt(tasks: readonly Task[], sessionId: string | null | undefined, at: number): Task | null {
  if (!sessionId) return null;
  const held = tasks.filter((t) => t.owner?.sessionId === sessionId && t.claimedAt !== null && t.claimedAt <= at && (t.doneAt === null || at <= t.doneAt));
  return held.sort((a, b) => (b.claimedAt ?? 0) - (a.claimedAt ?? 0))[0] ?? null;
}

// The task's PRD; a subtask's comes from its task.
export const prdOf = (tasks: readonly Task[], task: Task | null): string | null =>
  task ? (task.parentId ? tasks.find((t) => t.id === task.parentId)?.prdId ?? null : task.prdId) : null;

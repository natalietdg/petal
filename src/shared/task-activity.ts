// Recent activity for the Testing tab's pickers: newest first, ties keep their old order, no timestamp sorts last. Pure.
import type { TaskGroup, TaskTree } from './task-groups';
import type { Task } from './tasks';
import type { PipelineRun } from './testing';

type Stamp = number | null | undefined;

// The newest of the given times; null when none is set.
export function latest(...stamps: readonly Stamp[]): number | null {
  let best: number | null = null;
  for (const at of stamps) if (typeof at === 'number' && at > 0 && (best === null || at > best)) best = at;
  return best;
}

// Newest first; a stable sort, so equal times keep the given order and missing ones go last.
export function byRecent<T>(items: readonly T[], at: (item: T) => number | null): T[] {
  return items.map((item, i) => ({ item, i, at: at(item) }))
    .sort((a, b) => (a.at === b.at ? a.i - b.i : a.at === null ? 1 : b.at === null ? -1 : b.at - a.at))
    .map((entry) => entry.item);
}

// Each task id's newest run start.
export function lastRunAt(runs: readonly PipelineRun[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const run of runs) if (run.taskId && run.startedAt > (out.get(run.taskId) ?? 0)) out.set(run.taskId, run.startedAt);
  return out;
}

// A task's own activity: made, given, finished, its latest run.
export function taskActivity(runs: readonly PipelineRun[]): (task: Task) => number | null {
  const runAt = lastRunAt(runs);
  return (task) => latest(task.createdAt, task.claimedAt, task.doneAt, runAt.get(task.id));
}

const treeActivity = (tree: TaskTree, at: (task: Task) => number | null): number | null => latest(at(tree.task), ...tree.subtasks.map(at));

// Tasks newest first inside each group, subtasks still under their task; groups by their newest task, empty ones last.
export function groupsByActivity(groups: readonly TaskGroup[], at: (task: Task) => number | null): TaskGroup[] {
  const sorted = groups.map((group) => ({
    prd: group.prd,
    tasks: byRecent(group.tasks.map((tree) => ({ task: tree.task, subtasks: byRecent(tree.subtasks, at) })), (tree) => treeActivity(tree, at)),
  }));
  return byRecent(sorted, (group) => latest(...group.tasks.map((tree) => treeActivity(tree, at))));
}

// What Testing tidies away: agent records and saved loops of tasks that are gone, and the tasks it made for a session
// that closed long ago and never got a suite or a run. Pure: facts in, what to remove out.
import type { Task } from './tasks';

export const AUTO_TASK_DAYS = 30;
const DAY_MS = 86_400_000;

export interface PruneFacts {
  tasks: readonly Task[];
  autoTasks: readonly string[]; // tasks Testing made for a session
  recordTasks: readonly string[]; // task ids with agent records or a saved loop
  suiteTasks: ReadonlySet<string>; // tasks with a suite file or record
  runTasks: ReadonlySet<string>; // tasks with at least one run
  liveTasks: ReadonlySet<string>; // tasks whose saved loop or draft has an agent session open
  openSessions: ReadonlySet<string>;
  now: number;
}

export interface PrunePlan { tasks: string[]; records: string[]; autoTasks: string[] } // autoTasks: the list kept

// An auto task goes when its session is closed, it is older than 30 days, has no suite, no runs, no live agent and no subtasks.
export function prunePlan({ tasks, autoTasks, recordTasks, suiteTasks, runTasks, liveTasks, openSessions, now }: PruneFacts): PrunePlan {
  const auto = new Set(autoTasks);
  const stale = tasks.filter((t) => auto.has(t.id)
    && !(t.owner && openSessions.has(t.owner.sessionId))
    && now - t.createdAt > AUTO_TASK_DAYS * DAY_MS
    && !suiteTasks.has(t.id) && !runTasks.has(t.id) && !liveTasks.has(t.id)
    && !tasks.some((sub) => sub.parentId === t.id));
  const gone = new Set(stale.map((t) => t.id));
  const kept = new Set(tasks.filter((t) => !gone.has(t.id)).map((t) => t.id));
  return {
    tasks: [...gone],
    records: [...new Set(recordTasks)].filter((id) => !kept.has(id)),
    autoTasks: autoTasks.filter((id) => kept.has(id)),
  };
}

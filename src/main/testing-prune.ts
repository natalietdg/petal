// Tidies a project's Testing records at most once an hour: see shared/testing-prune.ts for the rule.
import fs from 'node:fs';
import * as store from './testing-store';
import * as coord from './coord';
import { loadTasks, updateTasks } from './tasks-store';
import { suiteFile, testingData } from './task-suites';
import { prunePlan } from '../shared/testing-prune';
import { removeTask } from '../shared/tasks';

const PRUNE_EVERY_MS = 60 * 60 * 1000;
const lastPruned = new Map<string, number>(); // root -> when it was last tidied

const without = <T>(map: Record<string, T> | undefined, ids: ReadonlySet<string>): Record<string, T> | undefined =>
  (map ? Object.fromEntries(Object.entries(map).filter(([id]) => !ids.has(id))) : map);

// Nothing is pruned while the tasks file can't be read, so a broken file never wipes records.
export function pruneProject(root: string, openSessions: ReadonlySet<string>, now = Date.now()): void {
  if (now - (lastPruned.get(root) ?? -Infinity) < PRUNE_EVERY_MS) return;
  lastPruned.set(root, now);
  const { tasks, problem } = loadTasks(root);
  if (problem) return;
  const data = testingData(root);
  const hasOpenAgent = (loop: { testerSessionId: string | null; fixerSessionId: string | null }) => [loop.testerSessionId, loop.fixerSessionId].some((id) => id !== null && openSessions.has(id));
  const plan = prunePlan({
    tasks, autoTasks: data.autoTasks ?? [], recordTasks: [...Object.keys(data.agents ?? {}), ...Object.keys(data.loops ?? {})],
    suiteTasks: new Set(tasks.map((t) => t.id).filter((id) => data.suites?.[id] || fs.existsSync(suiteFile(root, id)))),
    runTasks: new Set(data.runs.flatMap((r) => (r.taskId ? [r.taskId] : []))),
    liveTasks: new Set(Object.entries(data.loops ?? {}).filter(([, loop]) => loop.stoppedAt === null && hasOpenAgent(loop)).map(([id]) => id)), openSessions, now,
  });
  if (plan.tasks.length) {
    updateTasks(root, (current) => {
      const left = plan.tasks.reduce((list, id) => (list.some((t) => t.id === id) ? removeTask(list, id) : list), current);
      return left.length === current.length ? null : { tasks: left };
    });
    void coord.refresh(); // the Board sees it now
  }
  const records = new Set(plan.records);
  const sameAuto = JSON.stringify(plan.autoTasks) === JSON.stringify(data.autoTasks ?? []);
  if (!records.size && sameAuto) return;
  store.save({ ...data, agents: without(data.agents, records), loops: without(data.loops, records), testAgents: data.testAgents?.filter((a) => !records.has(a.taskId)), autoTasks: plan.autoTasks });
}

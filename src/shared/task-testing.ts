// The Testing tab is organised by task: which task or PRD it shows, and a PRD's overview of its tasks' suites. Pure.
import { groupTasks } from './task-groups';
import { forTask, suiteFor, type SuiteViews } from './task-suite';
import { openBugs, type Criteria } from './test-loop';
import type { PipelineRun } from './testing';
import type { Task, TaskData } from './tasks';

export type TestTarget = { kind: 'task'; id: string } | { kind: 'prd'; id: string };

export const targetValue = (target: TestTarget): string => `${target.kind}:${target.id}`;
export function parseTarget(value: string): TestTarget | null {
  const match = /^(task|prd):(.+)$/.exec(value);
  return match ? { kind: match[1] as TestTarget['kind'], id: match[2] as string } : null;
}

// Picker order: each PRD's tasks then the ungrouped ones, a subtask right after its task.
export function tasksInOrder(data: TaskData): Task[] {
  return groupTasks(data).flatMap((g) => g.tasks.flatMap((tree) => [tree.task, ...tree.subtasks]));
}

// The session's task; else the first unfinished task, else the first; null with no tasks.
export function defaultTarget(data: TaskData, sessionTaskId: string | null): TestTarget | null {
  const ordered = tasksInOrder(data);
  const task = ordered.find((t) => t.id === sessionTaskId) ?? ordered.find((t) => t.status !== 'done') ?? ordered[0];
  return task ? { kind: 'task', id: task.id } : null;
}

// Keeps her pick while it still exists; otherwise the default.
export function keepTarget(current: TestTarget | null, data: TaskData, sessionTaskId: string | null): TestTarget | null {
  const exists = current && (current.kind === 'task' ? data.tasks.some((t) => t.id === current.id) : data.prds.some((p) => p.id === current.id));
  return exists ? current : defaultTarget(data, sessionTaskId);
}

export interface OverviewRow {
  task: Task;
  subtask: boolean;
  stages: number; // 0: no suite
  borrowed: boolean; // a subtask running its parent's suite
  last: PipelineRun | null;
  passRate: number | null; // finished runs that passed, of its last RATE_RUNS
  openBugs: number;
}

const RATE_RUNS = 20;

// One row per task and subtask in the PRD, in picker order. Runs are newest first.
export function prdOverview(data: TaskData, prdId: string, suites: SuiteViews, runs: readonly PipelineRun[], criteria: Criteria | null): OverviewRow[] {
  const group = groupTasks(data).find((g) => g.prd?.id === prdId);
  if (!group) return [];
  return group.tasks.flatMap((tree) => [tree.task, ...tree.subtasks]).map((task) => {
    const own = forTask(runs, task.id);
    const finished = own.filter((r) => r.state !== 'running').slice(0, RATE_RUNS);
    const runsWith = suiteFor(data.tasks, suites, task.id);
    return {
      task,
      subtask: task.parentId !== null,
      stages: runsWith?.suite.stages.length ?? 0,
      borrowed: Boolean(runsWith && runsWith.owner.id !== task.id),
      last: own[0] ?? null,
      passRate: finished.length ? finished.filter((r) => r.state === 'passed').length / finished.length : null,
      openBugs: criteria ? openBugs({ ...criteria, bugs: forTask(criteria.bugs, task.id) }) : 0,
    };
  });
}

// ---- The task picker for a tab outside any project: recent projects' tasks, grouped by PRD.
export interface ProjectTasks extends TaskData { root: string; name: string; suited: readonly string[] }
export interface PickTask { id: string; title: string; subtask: boolean; suite: boolean }
export interface PickGroup { root: string; project: string; prd: string | null; tasks: PickTask[] }

// Projects in the order given, each PRD then No PRD, a subtask right after its task; empty groups left out.
export function pickGroups(projects: readonly ProjectTasks[]): PickGroup[] {
  return projects.flatMap((p) => groupTasks(p).filter((g) => g.tasks.length).map((g) => ({
    root: p.root, project: p.name, prd: g.prd?.title ?? null,
    tasks: g.tasks.flatMap((tree) => [tree.task, ...tree.subtasks]).map((t) => ({ id: t.id, title: t.title, subtask: t.parentId !== null, suite: p.suited.includes(t.id) })),
  })));
}

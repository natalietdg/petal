// The Testing tab is organised by task: which task or PRD it shows, and a PRD's overview of its tasks' suites. Pure.
import { byRecent, latest } from './task-activity';
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

// ---- The session picker for a tab outside any project: her Claude sessions in a repo, each opening its task's suite.
export type PickStatus = 'busy' | 'idle' | 'closed';
export interface SessionCandidate { sessionId: string; root: string | null; status: PickStatus; at?: number | null } // at: its latest activity
export interface PickAgent { name: string; status: PickStatus; count: number } // agents of one name and status, folded
export interface PickSession { sessionId: string; name: string; root: string; project: string; status: PickStatus; suite: boolean; agents: PickAgent[] }
export interface AgentSession { root: string; sessionId: string; taskId: string; name: string } // one of a task's agent sessions

// Newest activity first, live and recent mixed; one outside a repo is left out, one listed twice keeps its first entry and newest time.
export function listedSessions<T extends SessionCandidate>(live: readonly T[], recent: readonly T[], max: number): (T & { root: string })[] {
  const seen = new Map<string, T & { root: string }>();
  for (const s of [...live, ...recent]) {
    if (!s.root) continue;
    const first = seen.get(s.sessionId);
    seen.set(s.sessionId, first ? { ...first, at: latest(first.at, s.at) } : { ...s, root: s.root });
  }
  return byRecent([...seen.values()], (s) => latest(s.at)).slice(0, max);
}

// Agent sessions leave the list; each shows on the row of the session owning its task, with its status, and moves that row up to its newest activity.
export function foldAgents<T extends SessionCandidate & { root: string; taskId: string | null }>(rows: readonly T[], agents: readonly AgentSession[], max: number): (T & { agents: PickAgent[] })[] {
  const isAgent = new Set(agents.map((a) => `${a.root}\0${a.sessionId}`));
  const rowOf = new Map(rows.map((r) => [`${r.root}\0${r.sessionId}`, r]));
  const owners = rows.filter((r) => !isAgent.has(`${r.root}\0${r.sessionId}`)).map((r) => {
    const mine = agents.filter((a) => r.taskId !== null && a.root === r.root && a.taskId === r.taskId).map((a) => ({ agent: a, row: rowOf.get(`${a.root}\0${a.sessionId}`) }));
    const folded: PickAgent[] = [];
    for (const { agent, row } of mine) {
      const status = row?.status ?? 'closed';
      const same = folded.find((f) => f.name === agent.name && f.status === status);
      if (same) same.count += 1;
      else folded.push({ name: agent.name, status, count: 1 });
    }
    return { ...r, at: latest(r.at, ...mine.map((m) => m.row?.at)), agents: folded };
  });
  return byRecent(owners, (s) => latest(s.at)).slice(0, max);
}

// The picked session, only when the picker listed it; the renderer never names a folder.
export const listedSession = <T extends { sessionId: string }>(listed: readonly T[], sessionId: unknown): T | null =>
  (typeof sessionId === 'string' && listed.find((s) => s.sessionId === sessionId)) || null;

// The task a session owns: its unfinished one given most recently, else its newest finished one.
export function ownedTask(tasks: readonly Task[], sessionId: string): Task | null {
  const owned = tasks.filter((t) => t.owner?.sessionId === sessionId).sort((a, b) => (b.claimedAt ?? 0) - (a.claimedAt ?? 0));
  return owned.find((t) => t.status !== 'done') ?? owned[0] ?? null;
}

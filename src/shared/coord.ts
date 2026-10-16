// What the Board and the reader strip know about every live session beyond its replies: repo, branch, task, file clashes.
import type { Clash } from './file-clash';
import type { Task, TaskOwner, TaskStatus } from './tasks';

export interface CoordTask {
  id: string;
  title: string;
  status: TaskStatus;
  doneAt: number | null;
  doneBy: string | null;
}

export interface CoordSession {
  sessionId: string;
  name: string;
  root: string | null; // git toplevel
  repo: string | null; // its folder name
  branch: string | null;
  task: CoordTask | null;
  clashes: Clash[];
}

export interface CoordView {
  sessions: CoordSession[];
}

export const EMPTY_COORD: CoordView = { sessions: [] };

// The Tasks section: the active tab's project and its list.
export interface TasksView {
  repo: string | null; // null: the active tab isn't in a git repo (or has no session)
  name: string | null;
  branch: string | null;
  tasks: Task[];
  problem: string | null;
}

export type TaskOp =
  | { kind: 'add'; title: string; notes: string }
  | { kind: 'edit'; id: string; title: string; notes: string }
  | { kind: 'move'; id: string; to: number }
  | { kind: 'delete'; id: string }
  | { kind: 'assign'; id: string; toTabId: string; reassign?: boolean }
  | { kind: 'release'; id: string };

export type TaskChangeResult = TasksView & { confirm?: string; brief?: string; owner?: TaskOwner };

// A card's task: its newest unfinished one, else the one it finished last.
export function sessionTask(tasks: readonly Task[], sessionId: string): CoordTask | null {
  const owned = tasks.filter((t) => t.owner?.sessionId === sessionId);
  const open = owned.filter((t) => t.status !== 'done').sort((a, b) => (b.claimedAt ?? 0) - (a.claimedAt ?? 0));
  const done = owned.filter((t) => t.status === 'done').sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
  const task = open[0] ?? done[0];
  return task ? { id: task.id, title: task.title, status: task.status, doneAt: task.doneAt, doneBy: task.doneBy?.name ?? null } : null;
}

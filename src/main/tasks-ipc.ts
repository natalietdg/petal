// IPC for the Board's Tasks, Activity and coordination. The renderer names tabs, never folders: each tab's repo is found here.
import path from 'node:path';
import { handle } from './ipc';
import { repoBranch, repoRoot } from './repo-label';
import { loadTasks, newTaskId, updateTasks } from './tasks-store';
import { listActivity, recordActivity } from './activity-feed';
import * as coord from './coord';
import { addTask, assignTask, editTask, moveTask, releaseTask, removeTask, taskBrief, type Task, type TaskOwner } from '../shared/tasks';
import type { TaskChangeResult, TaskOp, TasksView } from '../shared/coord';
import type { TabSessions } from './tab-session';

interface TabProject {
  root: string | null;
  sessionId: string | null;
  cwd: string | null;
}

export function registerTasksIpc({ sessions }: { sessions: TabSessions }): void {
  const projectOf = (contentsId: number, tabId: string): TabProject => {
    const session = sessions.get(`${contentsId}:${tabId}`)?.feed.session;
    const cwd = session?.cwd ?? null;
    return { root: repoRoot(cwd), sessionId: session?.sessionId ?? null, cwd };
  };

  const viewOf = (project: TabProject, tasks?: Task[]): TasksView => {
    if (!project.root) return { repo: null, name: null, branch: null, tasks: [], problem: null };
    const list = tasks ? { tasks, problem: null } : loadTasks(project.root);
    return { repo: project.root, name: path.basename(project.root), branch: repoBranch(project.cwd), ...list };
  };

  handle('tasks:get', (event, { tabId }) => viewOf(projectOf(event.sender.id, tabId)));

  handle('tasks:change', async (event, { tabId, op }) => {
    const project = projectOf(event.sender.id, tabId);
    const root = project.root;
    if (!root) throw new Error('Open a Claude session in a git repo to keep tasks for it.');
    const result = changeTasks(root, op as TaskOp, (toTabId) => {
      const target = projectOf(event.sender.id, toTabId);
      if (!target.sessionId) throw new Error('That tab has no Claude session to give it to.');
      if (target.root !== root) throw new Error('That session works in another repo.');
      return { sessionId: target.sessionId, name: coord.sessionName(target.sessionId, target.cwd), branch: repoBranch(target.cwd) };
    });
    await coord.refresh(); // cards and the other windows see it now, not on the next tick
    return { ...viewOf(project, result.tasks), ...result.extra };
  });

  handle('coord:get', () => coord.current());
  handle('activity:list', () => listActivity());
}

type Changed = { tasks: Task[]; extra: Partial<TaskChangeResult> };

function changeTasks(root: string, op: TaskOp, ownerOf: (tabId: string) => TaskOwner): Changed {
  const now = Date.now();
  const repo = path.basename(root);
  let extra: Partial<TaskChangeResult> = {};
  const saved = updateTasks(root, (tasks): { tasks: Task[] } | null => {
    switch (op.kind) {
      case 'add': return { tasks: addTask(tasks, op, newTaskId(), now) };
      case 'edit': return { tasks: editTask(tasks, op.id, op) };
      case 'move': return { tasks: moveTask(tasks, op.id, op.to) };
      case 'delete': return { tasks: removeTask(tasks, op.id) };
      case 'release': return { tasks: releaseTask(tasks, op.id) };
      case 'assign': {
        const owner = ownerOf(op.toTabId);
        const result = assignTask(tasks, op.id, owner, now, { reassign: op.reassign === true });
        if ('confirm' in result) {
          extra = { confirm: result.confirm, owner: result.owner };
          return null; // nothing changes until she says yes
        }
        extra = { brief: taskBrief(result.task), owner };
        recordActivity({
          kind: 'task', at: now, sessionId: owner.sessionId, sessionName: owner.name, branch: owner.branch, repo,
          text: `Gave “${result.task.title}” to ${owner.name}`,
        });
        return result;
      }
      default: throw new Error('Unknown task change.');
    }
  });
  return { tasks: saved?.tasks ?? loadTasks(root).tasks, extra };
}

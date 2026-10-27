// What every Testing IPC area shares: which project and task a call is about, resolved the same way for each.
import { claudeFolderAllowed } from './claude-folder';
import { projectRootOf } from './testing-project';
import { findAgent } from './test-agents';
import { loadTasks } from './tasks-store';
import type { Task } from '../shared/tasks';
import type { LoopNotice } from '../shared/loop-signals';
import type { SuiteSeed, TestAgent } from '../shared/testing';
import type { OpenTab, TabSession, TabSessions } from './tab-session';

export const BRIEF_CAP = 12000;
export const FOLDERS_OFF = 'Petal isn’t reading your folders yet.';
export const NO_PROJECT = 'No project in this tab. Open one first.';
export const NOT_AN_AGENT = 'That isn’t one of this project’s agents.';

type Note = { note: string };
export type RootFor = (session: TabSession | undefined, picked: unknown) => Promise<string | null>;

export interface TestingIpcContext {
  sessions: TabSessions;
  openTab: OpenTab;
  // The tab's project, or the one she picked.
  rootOf: (contentsId: number, tabId: unknown, picked: unknown) => Promise<string | null>;
  // The project, for the calls that act on it but not its tasks.
  rootTarget: (contentsId: number, tabId: unknown, picked: unknown) => Promise<{ root: string } | Note>;
  // The project, for the calls that act on the repo's suite and criteria.
  projectTarget: (contentsId: number, tabId: unknown, picked: unknown) => Promise<{ root: string; tasks: Task[] } | Note>;
  // The project and one of its tasks, for the calls that act on a task's suite.
  taskTarget: (contentsId: number, tabId: unknown, picked: unknown, taskId: unknown) => Promise<{ root: string; task: Task; tasks: Task[] } | Note>;
  projectSeed: (root: string) => SuiteSeed | null;
  lockClaudeDir: () => string | null;
  notify: (notice: LoopNotice, contentsId: number | null) => boolean;
}

export const sessionFor = (sessions: TabSessions, contentsId: number, tabId: unknown): TabSession | undefined =>
  [...sessions.values()].find((s) => s.contentsId === contentsId && s.tabId === tabId);

export function makeTargets(sessions: TabSessions, rootFor: RootFor): Pick<TestingIpcContext, 'rootOf' | 'rootTarget' | 'projectTarget' | 'taskTarget'> {
  const rootOf = (contentsId: number, tabId: unknown, picked: unknown) => rootFor(sessionFor(sessions, contentsId, tabId), picked);
  const rootTarget = async (contentsId: number, tabId: unknown, picked: unknown): Promise<{ root: string } | Note> => {
    if (!claudeFolderAllowed()) return { note: FOLDERS_OFF };
    const root = await rootOf(contentsId, tabId, picked);
    return root ? { root } : { note: NO_PROJECT };
  };
  const projectTarget = async (contentsId: number, tabId: unknown, picked: unknown): Promise<{ root: string; tasks: Task[] } | Note> => {
    const target = await rootTarget(contentsId, tabId, picked);
    return 'note' in target ? target : { root: target.root, tasks: loadTasks(target.root).tasks };
  };
  const taskTarget = async (contentsId: number, tabId: unknown, picked: unknown, taskId: unknown): Promise<{ root: string; task: Task; tasks: Task[] } | Note> => {
    const target = await rootTarget(contentsId, tabId, picked);
    if ('note' in target) return target;
    const { tasks, problem } = loadTasks(target.root);
    const task = tasks.find((t) => t.id === taskId);
    return problem ? { note: problem } : task ? { root: target.root, task, tasks } : { note: 'That task is gone. It may have been deleted in another window.' };
  };
  return { rootOf, rootTarget, projectTarget, taskTarget };
}

// One of the project's agents, by session id only; root must be a repo root Petal reads.
export function agentAt(root: unknown, sessionId: unknown): { root: string; agent: TestAgent } | Note {
  if (!claudeFolderAllowed()) return { note: FOLDERS_OFF };
  const agent = typeof root === 'string' && projectRootOf(root) === root ? findAgent(root, sessionId) : null;
  return agent && typeof root === 'string' ? { root, agent } : { note: NOT_AN_AGENT };
}

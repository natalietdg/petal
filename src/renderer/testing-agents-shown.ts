// What Testing shows: its context, and reads of the shown task's loop or draft from this window's copy.
import * as tabs from './tabs';
import { keyOf, isStopping, type AgentLoop } from './testing-agents-loops';
import { latestLoop, type LoopProgress } from '../shared/loop-line';
import { loopStatus, type CriteriaItem, type LoopStatus } from '../shared/test-loop';
import { queueDone } from '../shared/bug-queue';
import { agentOf } from '../shared/agent-loop';
import { agentName, type AgentNames, type AgentRole } from '../shared/agent-names';
import type { RepoSuite } from '../shared/repo-suite';
import { awaitingReview } from '../shared/suite-draft';
import type { StackItem, SuiteRun } from '../shared/testing';
import type { Prd, Task } from '../shared/tasks';
import type { Reply } from '../shared/types';

export interface AgentContext {
  root: () => string | null;
  picked: () => string | null;
  tabId: () => string | null; // the tab Testing was opened from
  task: () => Task | null;
  prd: () => Prd | null; // the shown task's
  scenarios: () => CriteriaItem[]; // the repo's
  suite: () => RepoSuite | null;
  suiteDir: () => string | null; // the suite's folder in Petal, holding the repo's suite and criteria
  stack: () => StackItem[];
  names: () => AgentNames;
  taskRuns: () => SuiteRun[];
  redraw: () => void; // draws only while Testing is open
  renamed: () => Promise<void>; // reload after a name changed
  say: (text: string) => void; // the loop panel's note
  open: () => void; // shows Testing
}

// The line under each lane's chat box, shared by every piece that reports back to her.
export type LaneNotes = Partial<Record<AgentRole, string>>;

export interface LoopFactsShown { record: AgentLoop | null; progress: LoopProgress | null; status: LoopStatus; stopping: boolean }

export type Shown = ReturnType<typeof createShown>;

export function createShown(ctx: AgentContext, loops: ReadonlyMap<string, AgentLoop>) {
  const key = (): string | null => { const root = ctx.root(); const task = ctx.task(); return root && task ? keyOf(root, task.id) : null; };
  const record = (): AgentLoop | null => loops.get(key() ?? '') ?? null; // the shown task's loop or draft
  const shownLoop = (): AgentLoop | null => { const r = record(); return r?.kind === 'loop' ? r : null; };
  const drafting = (): AgentLoop | null => { const r = record(); return r?.kind === 'draft' && !r.stoppedAt && r.tester ? r : null; };
  const nameOf = (role: AgentRole, names: AgentNames = ctx.names()): string => agentName(names, role);

  // An agent's replies, newest first: its terminal's live feed when it runs here, else what its log said.
  function repliesOf(r: AgentLoop | null, role: AgentRole): readonly Reply[] {
    const agent = r ? agentOf(r, role) : null;
    const live = agent?.hostTabId ? tabs.get(agent.hostTabId)?.update : null;
    if (live && live.sessionId === agent?.sessionId) return live.replies;
    return r?.replies[role] ?? [];
  }

  // Scenarios first: the shown task's [todo] scenarios waiting on her, once its testing agent sits idle on them.
  function awaiting(): CriteriaItem[] {
    const r = record();
    if (!r?.tester || r.stoppedAt || (r.tester.state !== 'idle' && r.tester.state !== 'ended')) return [];
    return awaitingReview(ctx.scenarios(), { stopped: false, approved: r.approvedScenarios ?? [], busy: false, asking: false });
  }

  // The testing agent's Loop line drives the status; the loop is done only once the queue is empty too.
  function facts(): LoopFactsShown {
    const r = shownLoop();
    const progress = latestLoop(repliesOf(r, 'tester'), r?.startedAt ?? 0);
    const startedAt = r?.tester ? r.startedAt : null; // a bug fix agent alone hasn't started the test loop
    const live = r?.tester?.state === 'working' || r?.tester?.state === 'idle' || r?.tester?.state === 'asking';
    let status = loopStatus({ progress, live, startedAt, stoppedAt: r?.stoppedAt ?? null, now: Date.now() });
    if (r && !r.stoppedAt && status === 'done' && !queueDone(r.queue, progress?.phase ?? null)) status = 'running'; // fixes still in flight
    return { record: r, progress, status, stopping: Boolean(r && isStopping(r)) };
  }

  return { record, shownLoop, drafting, nameOf, repliesOf, awaiting, facts };
}

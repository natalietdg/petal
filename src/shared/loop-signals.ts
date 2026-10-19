// What each agent's lane says (Needs you first) and the moments worth a notification, pure.
import { activeBugs, queueCounts, type QueuedBug } from './bug-queue';
import type { AgentRole } from './agent-names';
import type { AgentState, StoredLoop } from './testing';

// ---- What a lane says.
export const NEEDS_YOU = 'Needs you';

export interface LaneFacts {
  role: AgentRole;
  kind: StoredLoop['kind'];
  state: AgentState | null; // null before Petal started this agent for the task
  stopped: boolean;
  testerLine: string | null; // the testing agent's Loop line in words, "Fixing · round 2/5"
  fixing: string | null; // the bug the bug fix agent is on
  draftEnded?: boolean; // the drafting agent stopped with no suite
  scenariosReady?: boolean; // the testing agent's [todo] scenarios wait on her review
}

export const SCENARIOS_READY = 'Scenarios ready';
export const ENDED_WORD = 'Ended · resumes on message';

// A prompt on the agent's screen (a permission, a question) outranks busy or idle: it waits on her.
export function laneWord(f: LaneFacts): string {
  if (!f.state) return 'Not started';
  if (f.state === 'closed') return 'Closed';
  if (f.stopped) return 'Stopped';
  if (f.state === 'asking') return NEEDS_YOU;
  if (f.state === 'starting') return 'Starting';
  const working = f.state === 'working';
  if (f.kind === 'draft') return working ? 'Drawing up the suite' : f.scenariosReady ? SCENARIOS_READY : f.draftEnded ? 'Stopped without a suite' : f.state === 'ended' ? ENDED_WORD : 'Idle';
  if (f.state === 'ended') return ENDED_WORD;
  if (f.role === 'tester') return f.scenariosReady ? SCENARIOS_READY : f.testerLine ?? (working ? 'Working' : 'Idle');
  return f.fixing ? `Fixing ${f.fixing}` : working ? 'Working' : 'Idle, waiting for bugs';
}

// ---- Notifications: only edges, so one prompt or one fix is one notice.
export interface LoopNotice { title: string; body: string; tabId: string | null }

// Agents waiting on her now that weren't at the last look.
export const newlyWaiting = (before: ReadonlySet<string>, now: ReadonlySet<string>): string[] => [...now].filter((id) => !before.has(id));

// Bugs that reached Awaiting verify in this step.
export const fixesLanded = (before: readonly QueuedBug[], after: readonly QueuedBug[]): QueuedBug[] =>
  after.filter((bug) => bug.state === 'verify' && before.find((b) => b.key === bug.key)?.state !== 'verify');

export const needsNotice = (name: string, tabId: string | null): LoopNotice => ({ title: `${name} needs you`, body: 'It is waiting on a prompt in its terminal.', tabId });

export const fixNotice = (bug: QueuedBug, fixer: string, tabId: string | null): LoopNotice => ({ title: `${fixer} fixed a bug`, body: `${bug.name} · awaiting verify`, tabId });

export function finishNotice(queue: readonly QueuedBug[], tabId: string | null): LoopNotice {
  const verified = queueCounts(queue).verified;
  const open = activeBugs(queue).length;
  return { title: 'Test loop finished', body: `${verified} verified · ${open} still open`, tabId };
}

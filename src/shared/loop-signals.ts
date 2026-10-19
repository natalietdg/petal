// A task's loop across windows and out of sight, pure: which window steps it, the loops a window can step from what was
// saved, what each agent's lane says (Needs you first), and the moments worth a notification.
import { activeBugs, queueCounts, type QueuedBug } from './bug-queue';
import type { AgentRole } from './agent-names';
import type { SavedLoop } from './testing';

// ---- One owner per loop: only that window steps the queue and saves it.
export interface OwnerFacts {
  open: (windowId: number) => boolean; // the window still exists
  hasAgents: (windowId: number) => boolean; // one of the loop's agent sessions is open in it
}

// The recorded owner while it is open and holds an agent tab, or nobody else does; else the asking window if it holds
// one; null when no open window can step it.
export function loopOwner(current: number | null, asking: number, facts: OwnerFacts): number | null {
  if (current !== null && facts.open(current) && (facts.hasAgents(current) || !facts.hasAgents(asking))) return current;
  return facts.hasAgents(asking) ? asking : null;
}

// A save is taken from the owner, or from any window while no open window owns the loop.
export const takesSave = (owner: number | null, asking: number): boolean => owner === null || owner === asking;

// One of the loop's agents is among these session ids.
export const hasAgentIn = (loop: Pick<SavedLoop, 'tester' | 'fixer'>, sessions: ReadonlySet<string>): boolean =>
  [loop.tester, loop.fixer].some((agent) => agent !== null && sessions.has(agent.sessionId));

// The running loops a window can step: from the saved loops and its open sessions alone, since tabs aren't restored.
export const runningHere = (loops: Record<string, SavedLoop>, open: ReadonlySet<string>): [string, SavedLoop][] =>
  Object.entries(loops).filter(([, loop]) => loop.kind === 'loop' && loop.stoppedAt === null && hasAgentIn(loop, open));

// ---- What a lane says.
export const NEEDS_YOU = 'Needs you';

export interface LaneFacts {
  role: AgentRole;
  kind: SavedLoop['kind'];
  started: boolean; // Petal started this agent for the task
  stopped: boolean;
  tab: { busy: boolean; asking: boolean } | null; // its tab in this window; null when not open here
  starting: boolean; // the loop started under two minutes ago
  testerLine: string | null; // the testing agent's Loop line in words, "Fixing · round 2/5"
  fixing: string | null; // the bug the bug fix agent is on
  draftEnded?: boolean; // the drafting agent stopped with no suite
  scenariosReady?: boolean; // the testing agent's [todo] scenarios wait on her review
}

export const SCENARIOS_READY = 'Scenarios ready';

// A prompt on the agent's screen (a permission, a question) outranks busy or idle: it waits on her.
export function laneWord(f: LaneFacts): string {
  if (!f.started) return 'Not started';
  if (f.stopped) return 'Stopped';
  if (!f.tab) return f.starting ? 'Starting in its tab' : 'Its tab isn’t open here';
  if (f.tab.asking) return NEEDS_YOU;
  if (f.kind === 'draft') return f.tab.busy ? 'Drawing up the suite' : f.scenariosReady ? SCENARIOS_READY : f.draftEnded ? 'Stopped without a suite' : 'Idle';
  if (f.role === 'tester') return f.scenariosReady ? SCENARIOS_READY : f.testerLine ?? (f.tab.busy ? 'Working' : 'Idle');
  return f.fixing ? `Fixing ${f.fixing}` : f.tab.busy ? 'Working' : 'Idle, waiting for bugs';
}

// ---- Notifications: only edges, so one prompt or one fix is one notice.
export interface LoopNotice { title: string; body: string; tabId: string | null }

// Agents waiting on her now that weren't at the last look.
export const newlyWaiting = (before: ReadonlySet<string>, now: ReadonlySet<string>): string[] => [...now].filter((id) => !before.has(id));

// Bugs that reached Awaiting verify in this step.
export const fixesLanded = (before: readonly QueuedBug[], after: readonly QueuedBug[]): QueuedBug[] =>
  after.filter((bug) => bug.state === 'verify' && before.find((b) => b.key === bug.key)?.state !== 'verify');

export const needsNotice = (name: string, tabId: string | null): LoopNotice => ({ title: `${name} needs you`, body: 'It is waiting on a prompt in its tab.', tabId });

export const fixNotice = (bug: QueuedBug, fixer: string, tabId: string | null): LoopNotice => ({ title: `${fixer} fixed a bug`, body: `${bug.name} · awaiting verify`, tabId });

export function finishNotice(queue: readonly QueuedBug[], tabId: string | null): LoopNotice {
  const verified = queueCounts(queue).verified;
  const open = activeBugs(queue).length;
  return { title: 'Test loop finished', body: `${verified} verified · ${open} still open`, tabId };
}

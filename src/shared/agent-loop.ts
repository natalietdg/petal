// A task's saved loop, pure: one queue step with Petal's events, the check on a loop the renderer saves, lanes rebuilt
// from agent records saved before loops were, and the tokens of the loop's last round.
import { BUG_STATES, BUG_STATE_WORDS, stepQueue, type QueuedBug, type QueueMessage } from './bug-queue';
import type { AgentAction } from './agent-actions';
import type { AgentRole } from './agent-names';
import type { CriteriaItem } from './test-loop';
import type { AgentRecord, LoopAgent, LoopEvent, PipelineRun, SavedLoop } from './testing';

export const EVENTS_KEPT = 100; // per agent
export const QUEUE_KEPT = 200;
const TEXT_MAX = 500;
const ID_MAX = 128;
const FAILURE_CHARS = 1500;

export const noEvents = (): Record<AgentRole, LoopEvent[]> => ({ tester: [], fixer: [] });

export const agentOf = (loop: SavedLoop, role: AgentRole): LoopAgent | null => (role === 'tester' ? loop.tester : loop.fixer);

export const withEvent = (events: Record<AgentRole, LoopEvent[]>, role: AgentRole, text: string, at: number): Record<AgentRole, LoopEvent[]> =>
  ({ ...events, [role]: [...events[role], { at, text }].slice(-EVENTS_KEPT) });

// The failure to hand the fixer: the test's output from the task's newest run that has it.
export function failureText(runs: readonly PipelineRun[], bug: QueuedBug): string {
  const [file, name] = (bug.test ?? '').split('::');
  for (const run of runs) {
    for (const stage of run.stages) {
      const test = stage.tests.find((t) => t.status === 'failed' && (!file || t.file.endsWith(file) || file.endsWith(t.file)) && (!name || t.name.includes(name)));
      if (test?.failure) return `Failure output:\n${test.failure.slice(0, FAILURE_CHARS)}`;
    }
  }
  return 'Run the test to see the failure.';
}

export interface LoopInputs {
  bugs: readonly CriteriaItem[]; // this task's bug lines
  runs: readonly PipelineRun[]; // this task's runs, newest first
  testerRound: number;
  fixerBusy: boolean;
  fixesDone: readonly { name: string; at: number }[];
  now: number;
}

export interface LoopStep { queue: QueuedBug[]; events: Record<AgentRole, LoopEvent[]>; send: QueueMessage[] }

// One queue step: bugs join and move, each move is noted in the lane it concerns, and the handoffs to send come back.
export function stepLoop(loop: Pick<SavedLoop, 'queue' | 'events'>, inputs: LoopInputs, names: { tester: string; fixer: string }): LoopStep {
  const result = stepQueue(loop.queue, inputs, { ...names, failure: (bug) => failureText(inputs.runs, bug) });
  let events = loop.events;
  for (const move of result.moves) {
    const to = BUG_STATE_WORDS[move.to].toLowerCase();
    if (move.to === 'fixing') events = withEvent(events, 'fixer', `${names.tester} → ${names.fixer} · ${move.name}`, inputs.now);
    else if (move.to === 'verify') events = withEvent(events, 'tester', `${names.fixer} → ${names.tester} · verify ${move.name}`, inputs.now);
    else events = withEvent(events, move.to === 'verified' ? 'fixer' : 'tester', `Bug ${move.from ? `${BUG_STATE_WORDS[move.from].toLowerCase()} → ` : 'filed · '}${to} · ${move.name}`, inputs.now);
  }
  return { queue: result.queue, events, send: result.send };
}

// A handoff that didn't reach its tab: its bug goes back so the next step sends it again.
export const unsent = (queue: readonly QueuedBug[], message: QueueMessage): QueuedBug[] =>
  queue.map((b) => (b.key !== message.key ? b : message.to === 'fixer' ? { ...b, state: 'open', asked: false } : { ...b, asked: false }));

// The saved copy replaces this window's only when this window has none or it is from a newer start.
export const takesSaved = (local: Pick<SavedLoop, 'startedAt'> | null, saved: Pick<SavedLoop, 'startedAt'>): boolean => !local || saved.startedAt > local.startedAt;

// The saved loop, else one rebuilt from the newest agent records: a tester then a fixer was a loop, a lone tester a draft.
export function loopFromAgents(saved: SavedLoop | undefined, agents: readonly AgentRecord[]): SavedLoop | null {
  if (saved) return saved;
  const last = agents.at(-1);
  const before = agents.at(-2);
  const base = { startedAt: 0, stoppedAt: null, queue: [], events: noEvents() };
  if (last?.role === 'fixer' && before?.role === 'tester') return { ...base, kind: 'loop', tester: { tabId: null, sessionId: before.sessionId }, fixer: { tabId: null, sessionId: last.sessionId } };
  if (last?.role === 'tester') return { ...base, kind: 'draft', tester: { tabId: null, sessionId: last.sessionId }, fixer: null };
  return null;
}

// ---- The check on a loop the renderer sends to be saved: shapes, sizes, and nothing else kept.
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isText = (v: unknown, max = TEXT_MAX): v is string => typeof v === 'string' && v.length <= max;

function cleanAgent(v: unknown): LoopAgent | null {
  if (!isObject(v) || !isText(v.sessionId, ID_MAX) || !v.sessionId || !(v.tabId === null || isText(v.tabId, ID_MAX))) return null;
  return { tabId: v.tabId, sessionId: v.sessionId };
}

function cleanBug(v: unknown): QueuedBug | null {
  if (!isObject(v) || !isText(v.key) || !isText(v.name) || !(v.test === null || isText(v.test)) || !BUG_STATES.includes(v.state as QueuedBug['state'])) return null;
  if (!isTime(v.since) || !isTime(v.testerRound) || typeof v.asked !== 'boolean' || typeof v.rechecked !== 'boolean') return null;
  return { key: v.key, name: v.name, test: v.test, state: v.state as QueuedBug['state'], since: v.since, asked: v.asked, testerRound: v.testerRound, rechecked: v.rechecked };
}

const cleanEvents = (v: unknown): LoopEvent[] => (Array.isArray(v) ? v : [])
  .flatMap((e) => (isObject(e) && isTime(e.at) && isText(e.text) ? [{ at: e.at, text: e.text }] : [])).slice(-EVENTS_KEPT);

export function cleanSavedLoop(v: unknown): SavedLoop | null {
  if (!isObject(v) || (v.kind !== 'loop' && v.kind !== 'draft') || !isTime(v.startedAt) || !(v.stoppedAt === null || isTime(v.stoppedAt))) return null;
  const tester = cleanAgent(v.tester);
  const fixer = v.fixer === null ? null : cleanAgent(v.fixer);
  if (!tester || (v.kind === 'loop') !== (fixer !== null) || !Array.isArray(v.queue) || !isObject(v.events)) return null;
  const queue = v.queue.map(cleanBug);
  if (queue.some((b) => b === null)) return null;
  return {
    kind: v.kind, tester, fixer, startedAt: v.startedAt, stoppedAt: v.stoppedAt,
    queue: (queue as QueuedBug[]).slice(-QUEUE_KEPT), events: { tester: cleanEvents(v.events.tester), fixer: cleanEvents(v.events.fixer) },
  };
}

// ---- Tokens: the loop's last finished round for both agents, else the round under way; the estimate's unit.
export interface RoundTokens { round: number | null; done: boolean; tokens: number }

export function roundTokens(tester: readonly AgentAction[], fixer: readonly AgentAction[], startedAt: number): RoundTokens {
  const mine = (actions: readonly AgentAction[]) => actions.filter((a) => a.at >= startedAt);
  const starts = new Map<number, number>(); // round -> its first tester action
  for (const a of mine(tester)) if (a.round !== null && (!starts.has(a.round) || a.at < (starts.get(a.round) as number))) starts.set(a.round, a.at);
  const rounds = [...starts.keys()].sort((a, b) => a - b);
  const sum = (from: number, to: number) => [...mine(tester), ...mine(fixer)].filter((a) => a.at >= from && a.at < to).reduce((n, a) => n + a.tokens, 0);
  if (!rounds.length) return { round: null, done: false, tokens: sum(startedAt, Infinity) };
  const current = rounds[rounds.length - 1];
  if (rounds.length === 1) return { round: current, done: false, tokens: sum(startedAt, Infinity) };
  const last = rounds[rounds.length - 2];
  return { round: last, done: true, tokens: sum(rounds.length === 2 ? startedAt : (starts.get(last) as number), starts.get(current) as number) };
}

// "Round 2", "Round 1 so far", "So far": the label next to the round's tokens.
export const roundLabel = (r: RoundTokens): string => (r.round === null ? 'So far' : r.done ? `Round ${r.round}` : `Round ${r.round} so far`);

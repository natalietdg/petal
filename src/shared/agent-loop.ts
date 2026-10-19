// A task's loop and its agents, pure: one queue step with Petal's events, the agent registry's rules (one per role per
// task, found by session id only), the migration of records saved before main owned agents, and round tokens.
import { BUG_STATES, BUG_STATE_WORDS, SENT_FAILURE_CAP, stepQueue, type QueuedBug, type QueueMessage, type RunResult, type SentBug, type SentFrom } from './bug-queue';
import type { AgentAction } from './agent-actions';
import type { AgentRole } from './agent-names';
import { ITEMS_CAP, NAME_CAP, type CriteriaItem } from './test-loop';
import type { AgentRecord, AgentState, AgentView, LoopEvent, LoopView, PipelineRun, ProjectTesting, StoredLoop, TestAgent } from './testing';

export const EVENTS_KEPT = 100; // per agent
export const QUEUE_KEPT = 200;
const TEXT_MAX = 500;
const ID_MAX = 128;
const FAILURE_CHARS = 1500;

export const noEvents = (): Record<AgentRole, LoopEvent[]> => ({ tester: [], fixer: [] });

export const ROLES: readonly AgentRole[] = ['tester', 'fixer'];
export const READY_SETTLE_MS = 1500; // claude needs a moment after its session appears before it reads typed input

export const agentOf = (loop: LoopView, role: AgentRole): AgentView | null => (role === 'tester' ? loop.tester : loop.fixer);

export const sessionOf = (loop: StoredLoop, role: AgentRole): string | null => (role === 'tester' ? loop.testerSessionId : loop.fixerSessionId);

export const withEvent = (events: Record<AgentRole, LoopEvent[]>, role: AgentRole, text: string, at: number): Record<AgentRole, LoopEvent[]> =>
  ({ ...events, [role]: [...events[role], { at, text }].slice(-EVENTS_KEPT) });

const sameFile = (a: string, b: string): boolean => a.endsWith(b) || b.endsWith(a);

// The failure to hand the fixer: what she sent, else the test's output from the task's newest run that has it.
export function failureText(runs: readonly PipelineRun[], bug: QueuedBug): string {
  if (bug.sent) return bug.sent.failure;
  const [file, name] = (bug.test ?? '').split('::');
  for (const run of runs) {
    for (const stage of run.stages) {
      const test = stage.tests.find((t) => t.status === 'failed' && (!file || t.file.endsWith(file) || file.endsWith(t.file)) && (!name || t.name.includes(name)));
      if (test?.failure) return `Failure output:\n${test.failure.slice(0, FAILURE_CHARS)}`;
    }
  }
  return 'Run the test to see the failure.';
}

// A sent bug's result in the task's newest run since it entered its state: its test, else its whole stage.
export function rerunOf(runs: readonly PipelineRun[], bug: QueuedBug): RunResult {
  if (!bug.sent) return null;
  const [file, name] = (bug.test ?? '').split('::');
  for (const run of runs) {
    if (run.startedAt < bug.since) continue;
    for (const stage of run.stages) {
      const status = bug.test ? stage.tests.find((t) => t.name === name && sameFile(t.file, file ?? ''))?.status : stage.name === bug.sent.stage ? stage.status : undefined;
      if (status === 'passed' || status === 'failed') return status;
    }
  }
  return null;
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
export function stepLoop(loop: Pick<StoredLoop, 'queue' | 'events'>, inputs: LoopInputs, names: { tester: string; fixer: string }): LoopStep {
  const result = stepQueue(loop.queue, { ...inputs, rerun: (bug) => rerunOf(inputs.runs, bug) }, { ...names, failure: (bug) => failureText(inputs.runs, bug) });
  let events = loop.events;
  for (const move of result.moves) {
    const to = BUG_STATE_WORDS[move.to].toLowerCase();
    if (move.to === 'fixing') events = withEvent(events, 'fixer', `${names.tester} → ${names.fixer} · ${move.name}`, inputs.now);
    else if (move.to === 'verify') events = withEvent(events, 'tester', `${names.fixer} → ${names.tester} · verify ${move.name}`, inputs.now);
    else events = withEvent(events, move.to === 'verified' ? 'fixer' : 'tester', `Bug ${move.from ? `${BUG_STATE_WORDS[move.from].toLowerCase()} → ` : 'filed · '}${to} · ${move.name}`, inputs.now);
  }
  return { queue: result.queue, events, send: result.send };
}

// A handoff that didn't reach its agent: its bug goes back so the next step sends it again.
export const unsent = (queue: readonly QueuedBug[], message: Pick<QueueMessage, 'key' | 'to'>): QueuedBug[] =>
  queue.map((b) => (b.key !== message.key ? b : message.to === 'fixer' ? { ...b, state: 'open', asked: false } : { ...b, asked: false }));

// An agent resumed after its claude died mid-handoff: what was in flight to it is sent again.
export function inFlightAgain(queue: readonly QueuedBug[], role: AgentRole): QueuedBug[] {
  const inFlight = (b: QueuedBug) => (role === 'fixer' ? b.state === 'fixing' : b.state === 'verify' && b.asked);
  return queue.reduce<QueuedBug[]>((next, b) => (inFlight(b) ? unsent(next, { key: b.key, to: role }) : next), [...queue]);
}

// The saved loop, else one rebuilt from the newest agent records: a tester then a fixer was a loop, a lone tester a draft.
export function loopFromAgents(saved: StoredLoop | undefined, agents: readonly AgentRecord[]): StoredLoop | null {
  if (saved) return saved;
  const last = agents.at(-1);
  const before = agents.at(-2);
  const base = { startedAt: 0, stoppedAt: null, queue: [], events: noEvents() };
  if (last?.role === 'fixer' && before?.role === 'tester') return { ...base, kind: 'loop', testerSessionId: before.sessionId, fixerSessionId: last.sessionId };
  if (last?.role === 'tester') return { ...base, kind: 'draft', testerSessionId: last.sessionId, fixerSessionId: null };
  return null;
}

// ---- The check on a loop read from disk: shapes, sizes, and nothing else kept. The shape from before main owned
// agents ({ tester: { tabId, sessionId } }) is still read; its tab id is dropped.
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isText = (v: unknown, max = TEXT_MAX): v is string => typeof v === 'string' && v.length <= max;
const isSessionId = (v: unknown): v is string => isText(v, ID_MAX) && v.length > 0;

export const isLegacyLoop = (v: unknown): boolean => isObject(v) && ('tester' in v || 'fixer' in v);

// A session id from either shape: the new field, else the old { tabId, sessionId } entry. undefined when malformed.
function cleanSession(v: Record<string, unknown>, role: AgentRole): string | null | undefined {
  const field = role === 'tester' ? 'testerSessionId' : 'fixerSessionId';
  const value = field in v ? v[field] : isObject(v[role]) ? (v[role] as Record<string, unknown>).sessionId : v[role];
  if (value === null || value === undefined) return null;
  return isSessionId(value) ? value : undefined;
}

const cleanSent = (v: unknown): SentFrom | null => (isObject(v) && isText(v.stage) && isText(v.failure, SENT_FAILURE_CAP) ? { stage: v.stage, failure: v.failure } : null);

// A bug she sent from a failed run: a name, its test or null, and what she sent.
export function cleanSentBug(v: unknown): SentBug | null {
  if (!isObject(v) || !isText(v.name) || !v.name.trim() || !(v.test === null || isText(v.test))) return null;
  const sent = cleanSent(v.sent);
  return sent ? { name: v.name, test: v.test, sent } : null;
}

function cleanBug(v: unknown): QueuedBug | null {
  if (!isObject(v) || !isText(v.key) || !isText(v.name) || !(v.test === null || isText(v.test)) || !BUG_STATES.includes(v.state as QueuedBug['state'])) return null;
  if (!isTime(v.since) || !isTime(v.testerRound) || typeof v.asked !== 'boolean' || typeof v.rechecked !== 'boolean') return null;
  const sent = cleanSent(v.sent);
  return { key: v.key, name: v.name, test: v.test, state: v.state as QueuedBug['state'], since: v.since, asked: v.asked, testerRound: v.testerRound, rechecked: v.rechecked, ...(sent ? { sent } : {}) };
}

const cleanEvents = (v: unknown): LoopEvent[] => (Array.isArray(v) ? v : [])
  .flatMap((e) => (isObject(e) && isTime(e.at) && isText(e.text) ? [{ at: e.at, text: e.text }] : [])).slice(-EVENTS_KEPT);

// Approved scenario names, as the criteria file caps them.
const cleanNames = (v: unknown[]): string[] => v.filter((n): n is string => typeof n === 'string' && n.length > 0).map((n) => n.slice(0, NAME_CAP)).slice(0, ITEMS_CAP);

export function cleanStoredLoop(v: unknown): StoredLoop | null {
  if (!isObject(v) || (v.kind !== 'loop' && v.kind !== 'draft') || !isTime(v.startedAt) || !(v.stoppedAt === null || isTime(v.stoppedAt))) return null;
  const tester = cleanSession(v, 'tester');
  const fixer = cleanSession(v, 'fixer');
  if (tester === undefined || fixer === undefined) return null;
  if ((v.kind === 'loop' ? !fixer : !tester || fixer) || !Array.isArray(v.queue) || !isObject(v.events)) return null;
  const queue = v.queue.map(cleanBug);
  if (queue.some((b) => b === null)) return null;
  return {
    kind: v.kind, testerSessionId: tester, fixerSessionId: fixer, startedAt: v.startedAt, stoppedAt: v.stoppedAt,
    queue: (queue as QueuedBug[]).slice(-QUEUE_KEPT), events: { tester: cleanEvents(v.events.tester), fixer: cleanEvents(v.events.fixer) },
    ...(Array.isArray(v.approvedScenarios) ? { approvedScenarios: cleanNames(v.approvedScenarios) } : {}),
  };
}

// ---- The agent registry's rules. One open agent per role per task; an agent is only ever found by its session id.
export const CLOSED_KEPT = 40; // closed agents kept per project; the agents ledger still names every one for the lock
export const CLOSED_EVENT = 'Closed';

export const openAgent = (agents: readonly TestAgent[], taskId: string, role: AgentRole): TestAgent | null =>
  agents.find((a) => a.taskId === taskId && a.role === role && a.closedAt === null) ?? null;

export const agentBySession = (agents: readonly TestAgent[], sessionId: string | null | undefined): TestAgent | null =>
  (sessionId ? agents.find((a) => a.sessionId === sessionId) ?? null : null);

// The task's open agent in that role is kept; only when there is none does the new one join.
export function claimRole(agents: readonly TestAgent[], fresh: TestAgent): { agents: TestAgent[]; agent: TestAgent; created: boolean } {
  const open = openAgent(agents, fresh.taskId, fresh.role);
  if (open) return { agents: [...agents], agent: open, created: false };
  return { agents: [...agents, { ...fresh, closedAt: null }], agent: { ...fresh, closedAt: null }, created: true };
}

// A new loop around a bug fix agent. A draft whose testing agent is still open hands it over as the loop's tester.
export function loopForFixer(prior: StoredLoop | undefined, agents: readonly TestAgent[], taskId: string, fixerSessionId: string, now: number): StoredLoop {
  const tester = openAgent(agents, taskId, 'tester');
  const draft = prior?.kind === 'draft' && tester && prior.testerSessionId === tester.sessionId ? prior : null;
  return {
    kind: 'loop', testerSessionId: draft?.testerSessionId ?? null, fixerSessionId, startedAt: now, stoppedAt: null, queue: [], events: draft?.events ?? noEvents(),
    ...(draft?.approvedScenarios ? { approvedScenarios: draft.approvedScenarios } : {}),
  };
}

// Closed agents beyond the cap are dropped, oldest first; open ones always stay.
export function closeAgents(agents: readonly TestAgent[], sessionIds: readonly string[], now: number): TestAgent[] {
  const closed = agents.map((a) => (sessionIds.includes(a.sessionId) && a.closedAt === null ? { ...a, closedAt: now } : a));
  const drop = closed.filter((a) => a.closedAt !== null).sort((a, b) => (a.closedAt as number) - (b.closedAt as number)).slice(0, -CLOSED_KEPT);
  return closed.filter((a) => !drop.includes(a));
}

export interface TerminalFacts { contentsId: number; tabId: string; sessionId: string | null; busy: boolean }

// The terminal running this agent: one whose claude reports its session. A tab id alone never matches, since ids
// restart and a reload reuses them.
export const terminalOf = <T extends TerminalFacts>(open: Iterable<T>, sessionId: string): T | null => {
  for (const terminal of open) if (terminal.sessionId === sessionId) return terminal;
  return null;
};

export interface StateFacts { running: { busy: boolean } | null; asking: boolean; starting: boolean }

export function agentState(agent: Pick<TestAgent, 'closedAt'>, f: StateFacts): AgentState {
  if (agent.closedAt !== null) return 'closed';
  if (f.running) return f.asking ? 'asking' : f.running.busy ? 'working' : 'idle';
  return f.starting ? 'starting' : 'ended';
}

// When an agent with no claude running comes back: never once closed, at launch while its loop runs, else on a message.
export type ResumeWhen = 'never' | 'at-launch' | 'on-message';
export function resumeWhen(agent: TestAgent, loop: StoredLoop | null | undefined): ResumeWhen {
  if (agent.closedAt !== null) return 'never';
  const running = loop?.kind === 'loop' && loop.stoppedAt === null && sessionOf(loop, agent.role) === agent.sessionId;
  return running ? 'at-launch' : 'on-message';
}

// ---- Migration, once per project: each saved loop's sessions become ended agents (closed when Close agents ended
// them), loops keep session ids only, and every other agent record stays in the ledger as retired, for the lock.
// Null when there is nothing to migrate. A loop an older Petal saved afterwards is folded in the same way.
export function migrateTesting(data: ProjectTesting, now: number): ProjectTesting | null {
  const raw = (data.loops ?? {}) as Record<string, unknown>;
  if (data.testAgents ? !Object.values(raw).some(isLegacyLoop) : !Object.keys(raw).length && !Object.keys(data.agents ?? {}).length) return null;
  let agents = [...(data.testAgents ?? [])];
  const loops: Record<string, StoredLoop> = {};
  const tasks = new Set([...Object.keys(raw), ...(data.testAgents ? [] : Object.keys(data.agents ?? {}))]);
  for (const taskId of tasks) {
    const loop = taskId in raw ? cleanStoredLoop(raw[taskId]) : loopFromAgents(undefined, data.agents?.[taskId] ?? []);
    if (!loop) continue;
    loops[taskId] = loop;
    for (const role of ROLES) {
      const sessionId = sessionOf(loop, role);
      if (!sessionId || agentBySession(agents, sessionId)) continue;
      const replaced = openAgent(agents, taskId, role); // the loop's session wins over an older open one
      if (replaced) agents = closeAgents(agents, [replaced.sessionId], now);
      const closedAt = loop.events[role].at(-1)?.text === CLOSED_EVENT ? loop.events[role].at(-1)?.at ?? now : null;
      agents.push({ sessionId, taskId, role, cwd: data.root, startedAt: loop.startedAt, closedAt });
    }
  }
  return { ...data, testAgents: agents, loops };
}

// ---- Tokens: the loop's last finished round for both agents, else the round under way; the estimate's unit.
export interface RoundTokens { round: number | null; done: boolean; tokens: number; cached: number }

type Spent = { tokens: number; cached: number };

// Both agents' actions since the loop started, and the round each tester round began.
function roundStarts(tester: readonly AgentAction[], fixer: readonly AgentAction[], startedAt: number): { rounds: number[]; starts: Map<number, number>; sum: (from: number, to: number) => Spent } {
  const mine = (actions: readonly AgentAction[]) => actions.filter((a) => a.at >= startedAt);
  const starts = new Map<number, number>(); // round -> its first tester action
  for (const a of mine(tester)) if (a.round !== null && (!starts.has(a.round) || a.at < (starts.get(a.round) as number))) starts.set(a.round, a.at);
  const both = [...mine(tester), ...mine(fixer)];
  const sum = (from: number, to: number): Spent => both.filter((a) => a.at >= from && a.at < to)
    .reduce((n, a) => ({ tokens: n.tokens + a.tokens, cached: n.cached + (a.cached ?? 0) }), { tokens: 0, cached: 0 });
  return { rounds: [...starts.keys()].sort((a, b) => a - b), starts, sum };
}

export function roundTokens(tester: readonly AgentAction[], fixer: readonly AgentAction[], startedAt: number): RoundTokens {
  const { rounds, starts, sum } = roundStarts(tester, fixer, startedAt);
  if (!rounds.length) return { round: null, done: false, ...sum(startedAt, Infinity) };
  const current = rounds[rounds.length - 1];
  if (rounds.length === 1) return { round: current, done: false, ...sum(startedAt, Infinity) };
  const last = rounds[rounds.length - 2];
  return { round: last, done: true, ...sum(rounds.length === 2 ? startedAt : (starts.get(last) as number), starts.get(current) as number) };
}

// Each finished round's tokens for both agents, oldest first; once the loop is over its last round counts as finished too.
export function finishedRounds(tester: readonly AgentAction[], fixer: readonly AgentAction[], startedAt: number, over: boolean): number[] {
  const { rounds, starts, sum } = roundStarts(tester, fixer, startedAt);
  const ends = over ? rounds.length : rounds.length - 1;
  return rounds.slice(0, Math.max(0, ends)).map((round, i) => {
    const from = i === 0 ? startedAt : (starts.get(round) as number);
    const next = rounds[i + 1];
    return sum(from, next === undefined ? Infinity : (starts.get(next) as number)).tokens;
  });
}

// "Round 2", "Round 1 so far", "So far": the label next to the round's tokens.
export const roundLabel = (r: RoundTokens): string => (r.round === null ? 'So far' : r.done ? `Round ${r.round}` : `Round ${r.round} so far`);

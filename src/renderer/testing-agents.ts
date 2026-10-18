// A task's test loop as two agents at once: the testing agent and the bug fix agent, each in its own tab Petal started.
// On every refresh Petal steps the bug queue between them and sends each handoff through the reply box's paste path.
import * as tabs from './tabs';
import * as composer from './composer';
import { isIpcError } from './dom';
import { agentsPanel, type LaneModel, type PetalEvent } from './testing-agents-view';
import { latestLoop, phaseWord, type LoopProgress } from '../shared/loop-line';
import { buildFixerBrief, buildLoopBrief, isActive, loopStatus, stopAll, type Criteria, type LoopStatus } from '../shared/test-loop';
import { BUG_STATE_WORDS, fixLines, queueDone, stepQueue, type QueuedBug, type QueueMessage } from '../shared/bug-queue';
import { agentName, type AgentNames, type AgentRole } from '../shared/agent-names';
import { estimateRoundTokens, totalTokens } from '../shared/token-usage';
import { forTask, type TaskSuite } from '../shared/task-suite';
import type { AgentAction } from '../shared/agent-actions';
import { chatTurns, routeMessage } from '../shared/agent-chat';
import type { AgentStart } from '../shared/ipc';
import type { PipelineRun, StackItem } from '../shared/testing';
import type { Task } from '../shared/tasks';

export interface AgentLoop {
  taskId: string;
  tester: AgentStart;
  fixer: AgentStart;
  startedAt: number;
  stoppedAt: number | null;
  stopping: boolean;
  queue: QueuedBug[];
  events: Record<AgentRole, PetalEvent[]>;
  actions: Record<AgentRole, AgentAction[]>;
  tokens: Record<AgentRole, number | null>;
  sending: boolean;
}

export interface AgentContext {
  root: () => string | null;
  picked: () => string | null;
  tabId: () => string | null; // the tab Testing was opened from
  task: () => Task | null;
  suite: () => TaskSuite | null;
  stack: () => StackItem[];
  names: () => AgentNames;
  criteria: () => Criteria | null;
  taskRuns: () => PipelineRun[];
  redraw: () => void;
  renamed: () => Promise<void>; // reload after a name changed
  say: (text: string) => void; // the loop panel's note
}

const ROLES: AgentRole[] = ['tester', 'fixer'];
const FAILURE_CHARS = 1500;
const EVENTS_KEPT = 100;

export function createAgents(ctx: AgentContext) {
  const loops = new Map<string, AgentLoop>(); // `${root}:${taskId}` -> its loop, this window only
  const element = document.createElement('div');
  element.className = 'tst-agentsbox';
  let renaming: AgentRole | null = null;
  const logOpen = new Set<AgentRole>();
  const logShown: Partial<Record<AgentRole, number>> = {};
  const view: Partial<Record<AgentRole, 'chat' | 'actions'>> = {};
  const drafts: Partial<Record<AgentRole, string>> = {};
  const notes: Partial<Record<AgentRole, string>> = {};

  const key = (): string | null => (ctx.root() && ctx.task() ? `${ctx.root()}:${ctx.task()?.id}` : null);
  const record = (): AgentLoop | null => loops.get(key() ?? '') ?? null;
  const tabOf = (agent: AgentStart | undefined): string | null => {
    if (!agent) return null;
    const matches = tabs.ids().filter((id) => tabs.get(id)?.update?.sessionId === agent.sessionId);
    const bySession = matches.find((id) => tabs.get(id)?.update?.state === 'live') ?? matches[0]; // a live one first
    return bySession ?? (agent.tabId && tabs.get(agent.tabId) ? agent.tabId : null);
  };
  const updateOf = (agent: AgentStart | undefined) => { const id = tabOf(agent); return id ? tabs.get(id)?.update ?? null : null; };
  const nameOf = (role: AgentRole): string => agentName(ctx.names(), role);

  // The testing agent's Loop line drives the status; the loop is done only once the queue is empty too.
  function facts(): { record: AgentLoop | null; testerTab: string | null; progress: LoopProgress | null; status: LoopStatus } {
    const r = record();
    const testerTab = tabOf(r?.tester);
    const progress = latestLoop(updateOf(r?.tester)?.replies ?? [], r?.startedAt ?? 0);
    let status = loopStatus({ progress, live: testerTab ? tabs.get(testerTab)?.update?.state === 'live' : false, startedAt: r?.startedAt ?? null, stoppedAt: r?.stoppedAt ?? null, now: Date.now() });
    if (r && !r.stoppedAt && status === 'done' && !queueDone(r.queue, progress?.phase ?? null)) status = 'running'; // fixes still in flight
    return { record: r, testerTab, progress, status };
  }

  const note = (r: AgentLoop, role: AgentRole, text: string) => { r.events[role] = [...r.events[role], { at: Date.now(), text }].slice(-EVENTS_KEPT); };

  // The failure to hand the fixer: the test's output from the task's newest run that has it.
  function failureOf(bug: QueuedBug): string {
    const [file, name] = (bug.test ?? '').split('::');
    for (const run of ctx.taskRuns()) {
      for (const stage of run.stages) {
        const test = stage.tests.find((t) => t.status === 'failed' && (!file || t.file.endsWith(file) || file.endsWith(t.file)) && (!name || t.name.includes(name)));
        if (test?.failure) return `Failure output:\n${test.failure.slice(0, FAILURE_CHARS)}`;
      }
    }
    return 'Run the test to see the failure.';
  }

  async function deliver(r: AgentLoop, message: QueueMessage): Promise<boolean> {
    const id = tabOf(message.to === 'tester' ? r.tester : r.fixer);
    const tab = id ? tabs.get(id) : null;
    return tab ? composer.pasteToClaude(tab, composer.stripControls(message.text).trim()) : false;
  }

  // One queue step: new bugs join, fixes move to verify, and each handoff is sent once. A send that fails is tried again.
  async function step(): Promise<void> {
    const r = record();
    const task = ctx.task();
    if (!r || !task || r.stoppedAt || r.sending) return;
    const { progress } = facts();
    const fixer = updateOf(r.fixer);
    const before = r.queue;
    const result = stepQueue(r.queue, {
      bugs: forTask(ctx.criteria()?.bugs ?? [], task.id), testerRound: progress?.round ?? 0, fixerBusy: Boolean(fixer?.busy),
      fixesDone: fixLines(fixer?.replies ?? [], r.startedAt), now: Date.now(),
    }, { tester: nameOf('tester'), fixer: nameOf('fixer'), failure: failureOf });
    r.queue = result.queue;
    for (const move of result.moves) {
      const to = BUG_STATE_WORDS[move.to].toLowerCase();
      if (move.to === 'fixing') note(r, 'fixer', `${nameOf('tester')} → ${nameOf('fixer')} · ${move.name}`);
      else if (move.to === 'verify') note(r, 'tester', `${nameOf('fixer')} → ${nameOf('tester')} · verify ${move.name}`);
      else note(r, move.to === 'verified' ? 'fixer' : 'tester', `Bug ${move.from ? `${BUG_STATE_WORDS[move.from].toLowerCase()} → ` : 'filed · '}${to} · ${move.name}`);
    }
    if (!result.send.length) { if (before !== r.queue) ctx.redraw(); return; }
    r.sending = true;
    try {
      for (const message of result.send) {
        if (await deliver(r, message)) continue;
        r.queue = r.queue.map((b) => (b.key !== message.key ? b : message.to === 'fixer' ? { ...b, state: 'open', asked: false } : { ...b, asked: false }));
      }
    } finally {
      r.sending = false;
    }
    ctx.redraw();
  }

  async function refreshLogs(): Promise<void> {
    const r = record();
    const from = ctx.tabId();
    if (!r || !from) return;
    for (const role of ROLES) {
      const reply = await window.pastel.testing.agentLog({ tabId: from, root: ctx.picked(), sessionId: r[role].sessionId });
      if (isIpcError(reply) || 'note' in reply) continue;
      r.actions[role] = reply.actions;
      r.tokens[role] = totalTokens(reply.tokens);
    }
  }

  function briefs(focus: string, rounds: number): { tester: string; fixer: string } | null {
    const task = ctx.task();
    const suite = ctx.suite();
    if (!task || !suite) return null;
    const names = { tester: nameOf('tester'), fixer: nameOf('fixer') };
    return {
      tester: buildLoopBrief({ focus, rounds, stages: suite.stages, stack: ctx.stack(), taskId: task.id, agent: true, names }),
      fixer: buildFixerBrief({ taskId: task.id, taskTitle: task.title, stages: suite.stages, names }),
    };
  }

  // Before Start: tokens per round, from the two briefs and the size of the task's last run output.
  function estimate(): number | null {
    const b = briefs('', 5);
    if (!b) return null;
    const last = ctx.taskRuns()[0];
    const output = last ? last.stages.reduce((n, s) => n + s.output.length + s.tests.reduce((m, t) => m + t.name.length + (t.failure?.length ?? 0), 0), 0) : 0;
    return estimateRoundTokens({ briefChars: [b.tester.length, b.fixer.length], suiteOutputChars: output });
  }

  async function start(focus: string, rounds: number): Promise<void> {
    const from = ctx.tabId();
    const task = ctx.task();
    const k = key();
    const b = briefs(focus, rounds);
    if (!from || !task || !k || !b || isActive(facts().status)) return;
    const reply = await window.pastel.testing.loopStart({ tabId: from, root: ctx.picked(), taskId: task.id, testerBrief: b.tester, fixerBrief: b.fixer });
    if (isIpcError(reply) || 'note' in reply) { ctx.say(isIpcError(reply) ? `Couldn’t start the loop: ${reply.error}` : reply.note); return; }
    const r: AgentLoop = {
      taskId: task.id, tester: reply.tester, fixer: reply.fixer, startedAt: Date.now(), stoppedAt: null, stopping: false, queue: [],
      events: { tester: [], fixer: [] }, actions: { tester: [], fixer: [] }, tokens: { tester: 0, fixer: 0 }, sending: false,
    };
    note(r, 'tester', `Started ${nameOf('tester')} in a new tab`);
    note(r, 'fixer', `Started ${nameOf('fixer')} in a new tab`);
    loops.set(k, r);
    ctx.say(reply.tester.tabId && reply.fixer.tabId ? `${nameOf('tester')} and ${nameOf('fixer')} are starting in two new tabs.` : 'Couldn’t open both tabs. Close the loop and try again.');
  }

  // Stop halts both: Esc to each, then the stop message once each is idle.
  async function stop(): Promise<void> {
    const r = record();
    if (!r || r.stopping) return;
    r.stopping = true;
    ctx.say('Interrupting both agents, then asking them to stop and summarise.');
    ctx.redraw();
    const open = [r.tester, r.fixer].map(tabOf).filter((id): id is string => id !== null);
    await stopAll(open.map((id) => ({
      sendEsc: () => window.pastel.answerPrompt(id, { kind: 'menu', step: { cancel: true } }),
      isIdle: () => !tabs.get(id)?.update?.busy,
      send: async (text: string) => { const tab = tabs.get(id); return tab ? composer.pasteToClaude(tab, text) : false; },
      sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    })));
    r.stopping = false;
    r.stoppedAt = Date.now();
    for (const role of ROLES) note(r, role, 'Stopped');
    ctx.say('Asked both agents to stop. Their summaries show in their tabs.');
    ctx.redraw();
  }

  function laneStatus(role: AgentRole, r: AgentLoop | null, progress: LoopProgress | null): string {
    if (!r) return 'Not started';
    if (r.stoppedAt) return 'Stopped';
    const update = updateOf(r[role]);
    if (!update) return 'Starting in its tab';
    if (role === 'tester') return progress ? `${phaseWord(progress.phase)} · round ${progress.round}/${progress.total}` : update.busy ? 'Working' : 'Idle';
    const fixing = r.queue.find((b) => b.state === 'fixing');
    return fixing ? `Fixing ${fixing.name}` : update.busy ? 'Working' : 'Idle, waiting for bugs';
  }

  // Her message to one agent, through the reply box's paste path; refused while that agent is asking something.
  async function send(role: AgentRole, text: string): Promise<void> {
    const r = record();
    const route = routeMessage(role, r, (sessionId) => { const id = tabOf({ sessionId, tabId: null }); const tab = id ? tabs.get(id) : null; return tab ? composer.claudeIsAsking(tab) : false; }, text);
    if ('note' in route) { notes[role] = route.note; draw(); return; }
    const id = tabOf(r?.[role]);
    const tab = id ? tabs.get(id) : null;
    const sent = tab ? await composer.pasteToClaude(tab, composer.stripControls(text).trim()) : false;
    if (sent && r) { drafts[role] = ''; note(r, role, `You → ${nameOf(role)}: ${text.trim().slice(0, 80)}`); }
    notes[role] = sent ? `Sent to ${nameOf(role)}.` : 'Couldn’t reach that tab. Try again.';
    (document.activeElement as HTMLElement | null)?.blur();
    draw();
  }

  function draw(): void {
    const typing = element.contains(document.activeElement) && (renaming !== null || document.activeElement instanceof HTMLTextAreaElement);
    if (typing) return; // her typing survives the refresh
    const task = ctx.task();
    element.hidden = !task || !ctx.suite();
    if (element.hidden) return;
    const r = record();
    const { progress } = facts();
    const lanes: LaneModel[] = ROLES.map((role) => ({
      role, name: nameOf(role), tabId: r ? tabOf(r[role]) : null, status: laneStatus(role, r, progress), busy: Boolean(r && !r.stoppedAt && updateOf(r[role])?.busy),
      tokens: r ? r.tokens[role] : null, actions: r?.actions[role] ?? [], events: r?.events[role] ?? [],
      turns: r ? chatTurns(updateOf(r[role])?.replies ?? [], r.startedAt) : [], startedAt: r?.startedAt ?? 0, note: notes[role] ?? '',
    }));
    element.replaceChildren(agentsPanel({ lanes, queue: r?.queue ?? [], estimate: r ? null : estimate(), started: Boolean(r), renaming, logOpen, logShown, view, drafts }, {
      rename: (role) => { renaming = role; draw(); },
      saveName: (role, name) => void saveName(role, name),
      openTab: (id) => tabs.activate(id),
      toggleLog: (role) => { if (!logOpen.delete(role)) logOpen.add(role); draw(); },
      showOlder: (role) => { logShown[role] = (logShown[role] ?? 20) + 20; draw(); },
      setView: (role, next) => { view[role] = next; if (next === 'actions') logOpen.add(role); draw(); },
      draft: (role, text) => { drafts[role] = text; },
      send: (role, text) => void send(role, text),
    }));
  }

  async function saveName(role: AgentRole, name: string): Promise<void> {
    const from = ctx.tabId();
    if (!from) return;
    const reply = await window.pastel.testing.setAgentName({ tabId: from, root: ctx.picked(), role, name });
    if (isIpcError(reply) || 'note' in reply) { ctx.say(isIpcError(reply) ? reply.error : reply.note); return; }
    renaming = null;
    await ctx.renamed();
  }

  return { element, record, facts, step, refreshLogs, start, stop, draw, testerTab: () => facts().testerTab, state: () => ({ queue: record()?.queue ?? [], renaming, notes: { ...notes }, lanes: ROLES.map((role) => ({ role, name: nameOf(role), status: laneStatus(role, record(), facts().progress) })) }) };
}

export type Agents = ReturnType<typeof createAgents>;

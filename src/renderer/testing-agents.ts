// A task's test loop as two agents at once: the testing agent and the bug fix agent, each in its own tab Petal started.
// A timer steps every running loop's bug queue whether Testing is open or not, and sends each handoff through the reply
// box's paste path. The queue and Petal's events are saved next to the agent records, so lanes come back after a reload.
// With two windows on one task only the owner main names steps and saves; the other mirrors the saved loop. An agent
// waiting on a prompt reads Needs you and badges the dock's Testing button; that, a fix landing and a loop ending notify.
import * as tabs from './tabs';
import * as composer from './composer';
import * as historyReply from './history-reply';
import { isIpcError } from './dom';
import { agentsPanel, type AgentsModel, type LaneModel } from './testing-agents-view';
import { isTerminal, latestLoop, phaseWord, type LoopProgress } from '../shared/loop-line';
import { buildFixerBrief, buildLoopBrief, buildSentFixerBrief, isActive, loopStatus, stopAll, type LoopStatus } from '../shared/test-loop';
import { activeBugs, addSent, fixLines, queueDone, type SentBug } from '../shared/bug-queue';
import { finishNotice, fixesLanded, fixNotice, laneWord, needsNotice, newlyWaiting, NEEDS_YOU, type LoopNotice } from '../shared/loop-signals';
import { agentOf, finishedRounds, noEvents, roundLabel, roundTokens, stepLoop, takesSaved, unsent, withEvent } from '../shared/agent-loop';
import { agentName, type AgentNames, type AgentRole } from '../shared/agent-names';
import { NO_TOKENS, cachedTokens, estimateRoundTokens, roundEstimate, totalTokens, type RoundEstimate, type TokenUsage } from '../shared/token-usage';
import { OUTSIDE_AGENT, type TaskSuite } from '../shared/task-suite';
import { askAgainText, draftEnded, suiteProblemText } from '../shared/suite-draft';
import type { AgentAction } from '../shared/agent-actions';
import { agentTab, chatTurns, laneReach, reopenNote, reopenStalledNote, routeMessage, type LaneReach } from '../shared/agent-chat';
import type { AddedBug, LoopAgent, LoopFacts, PipelineRun, SavedLoop, StackItem } from '../shared/testing';
import type { Task } from '../shared/tasks';
import type { QueueMessage } from '../shared/bug-queue';

export interface AgentLoop extends SavedLoop {
  root: string;
  taskId: string;
  actions: Record<AgentRole, AgentAction[]>;
  tokens: Record<AgentRole, TokenUsage | null>;
  sending: boolean;
  stopping: boolean;
  inputs: Pick<LoopFacts, 'bugs' | 'runs' | 'names'> | null; // from main's last tick; null until then
}

export interface AgentContext {
  root: () => string | null;
  picked: () => string | null;
  tabId: () => string | null; // the tab Testing was opened from
  task: () => Task | null;
  suite: () => TaskSuite | null;
  stack: () => StackItem[];
  names: () => AgentNames;
  taskRuns: () => PipelineRun[];
  redraw: () => void; // draws only while Testing is open
  renamed: () => Promise<void>; // reload after a name changed
  say: (text: string) => void; // the loop panel's note
}

const ROLES: AgentRole[] = ['tester', 'fixer'];
const TICK_MS = 1500; // a running loop's queue steps this often, Testing open or not
const FIND_EVERY = 10; // with nothing running, ask main for loops every 10th tick (after a reload)
const STARTING_MS = 120_000; // a lane with no tab here reads as starting this long

const keyOf = (root: string, taskId: string): string => `${root}:${taskId}`;
const isRunning = (r: AgentLoop): boolean => r.kind === 'loop' && !r.stoppedAt;
const toSaved = ({ kind, tester, fixer, startedAt, stoppedAt, queue, events }: AgentLoop): SavedLoop => ({ kind, tester, fixer, startedAt, stoppedAt, queue, events });
const fromSaved = (root: string, taskId: string, saved: SavedLoop): AgentLoop => ({
  ...saved, root, taskId, actions: { tester: [], fixer: [] }, tokens: { tester: null, fixer: null }, sending: false, stopping: false, inputs: null,
});

export function createAgents(ctx: AgentContext) {
  const loops = new Map<string, AgentLoop>(); // `${root}:${taskId}` -> its loop or draft, this window's copy
  const owned = new Set<string>(); // loops this window steps, as main last said; their saved copy was taken once
  const elsewhere = new Set<string>(); // loops another window steps; this window mirrors their saved copy
  let waiting = new Set<string>(); // agent sessions with a prompt on screen here, at the last tick
  const element = document.createElement('div');
  element.className = 'tst-agentsbox';
  let renaming: AgentRole | null = null;
  const logOpen = new Set<AgentRole>();
  const logShown: Partial<Record<AgentRole, number>> = {};
  const view: Partial<Record<AgentRole, 'chat' | 'actions'>> = {};
  const drafts: Partial<Record<AgentRole, string>> = {};
  const notes: Partial<Record<AgentRole, string>> = {};
  const reopened = new Map<string, number>(); // agent sessionId -> when she asked to reopen it here
  let closeAsking = false;
  let closing = false;
  const closedLoops = new Set<string>(); // root, task and start of a loop once Close agents finished; its tabs close a moment later

  const key = (): string | null => { const root = ctx.root(); const task = ctx.task(); return root && task ? keyOf(root, task.id) : null; };
  const record = (): AgentLoop | null => loops.get(key() ?? '') ?? null; // the shown task's loop or draft
  const shownLoop = (): AgentLoop | null => { const r = record(); return r?.kind === 'loop' ? r : null; };
  const tabOf = (agent: LoopAgent | null | undefined): string | null =>
    agentTab(agent, tabs.ids().map((id) => { const update = tabs.get(id)?.update; return { id, sessionId: update?.sessionId ?? null, live: update?.state === 'live' }; }));
  const isStarting = (r: AgentLoop | null): boolean => Boolean(r && !r.stoppedAt && Date.now() - r.startedAt < STARTING_MS); // its Claude may not have reported its session yet
  // Starting, and its tab is still opening: not opened yet, or open with no session reported. A closed one reads as gone.
  // The saved id only rules a tab out here; it never makes one the agent's.
  const opening = (r: AgentLoop | null, agent: LoopAgent | null): boolean => {
    if (!isStarting(r) || !agent) return false;
    const tab = agent.tabId ? tabs.get(agent.tabId) : null;
    return agent.tabId === null || Boolean(tab && !tab.update?.sessionId);
  };
  const askedAt = new Map<string, number>(); // `${root}:${taskId}` -> when Petal last pasted a follow-up to its drafting agent
  const pastedProblems = new Set<string>(); // `${key}:${problem}` pasted back once each
  const drafting = (): AgentLoop | null => { const r = record(); return r?.kind === 'draft' && !r.stoppedAt && r.tester ? r : null; };
  // The shown task's draft: its testing agent's tab, and whether it ended with no suite.
  function draft(): { tabId: string | null; ended: boolean } | null {
    const r = drafting();
    if (!r?.tester) return null;
    const id = tabOf(r.tester);
    const screen = screenOf(r.tester);
    const since = Math.max(r.startedAt, askedAt.get(keyOf(r.root, r.taskId)) ?? 0);
    const replies = updateOf(r.tester)?.replies ?? [];
    const ended = draftEnded({
      suite: Boolean(ctx.suite()),
      tab: id ? 'open' : opening(r, r.tester) ? 'starting' : 'gone',
      busy: Boolean(screen?.busy), asking: Boolean(screen?.asking),
      worked: replies.some((reply) => Date.parse(reply.timestamp ?? '') >= since),
    });
    return { tabId: id, ended };
  }

  // A follow-up to the drafting agent through the reply box's paste path; worked counts again from now.
  async function pasteToDrafter(r: AgentLoop, text: string, event: string): Promise<boolean> {
    const id = tabOf(r.tester);
    const tab = id ? tabs.get(id) : null;
    const sent = tab ? await composer.pasteToClaude(tab, text) : false;
    if (!sent) return false;
    askedAt.set(keyOf(r.root, r.taskId), Date.now());
    note(r, 'tester', event);
    persist(r);
    return true;
  }

  // Ask again: the drafting agent's open tab gets a follow-up; 'start' when there is none to reuse.
  async function askAgain(): Promise<'pasted' | 'start' | 'failed'> {
    const r = drafting();
    const task = ctx.task();
    if (!r || !task || !tabOf(r.tester)) return 'start';
    return (await pasteToDrafter(r, askAgainText(task.id), `You → ${nameOf('tester')} · asked again for the suite`)) ? 'pasted' : 'failed';
  }

  // After each refresh: a suite file the drafting agent wrote but Petal couldn't use goes back to it once, with a fix request.
  async function checkDraft(problem: string | null): Promise<void> {
    const r = drafting();
    const task = ctx.task();
    if (!r || !task || !problem || problem === OUTSIDE_AGENT || !tabOf(r.tester)) return;
    const k = `${keyOf(r.root, r.taskId)}:${problem}`;
    if (pastedProblems.has(k) || updateOf(r.tester)?.busy) return;
    pastedProblems.add(k);
    if (!(await pasteToDrafter(r, suiteProblemText(task.id, problem), `Petal → ${nameOf('tester')} · the suite file can’t be used`))) pastedProblems.delete(k);
    else ctx.redraw();
  }
  const updateOf = (agent: LoopAgent | null | undefined) => { const id = tabOf(agent); return id ? tabs.get(id)?.update ?? null : null; };
  const nameOf = (role: AgentRole, names: AgentNames = ctx.names()): string => agentName(names, role);
  // Its bug fix agent can take bugs: running, and its tab is open here or still starting.
  const fixerLive = (r: AgentLoop): boolean => isRunning(r) && r.fixer !== null && (tabOf(r.fixer) !== null || isStarting(r));

  // The testing agent's Loop line drives the status; the loop is done only once the queue is empty too.
  function facts(): { record: AgentLoop | null; testerTab: string | null; progress: LoopProgress | null; status: LoopStatus } {
    const r = shownLoop();
    const testerTab = tabOf(r?.tester);
    const progress = latestLoop(updateOf(r?.tester)?.replies ?? [], r?.startedAt ?? 0);
    const startedAt = r?.tester ? r.startedAt : null; // a bug fix agent alone hasn't started the test loop
    let status = loopStatus({ progress, live: testerTab ? tabs.get(testerTab)?.update?.state === 'live' : false, startedAt, stoppedAt: r?.stoppedAt ?? null, now: Date.now() });
    if (r && !r.stoppedAt && status === 'done' && !queueDone(r.queue, progress?.phase ?? null)) status = 'running'; // fixes still in flight
    return { record: r, testerTab, progress, status };
  }

  const note = (r: AgentLoop, role: AgentRole, text: string) => { r.events = withEvent(r.events, role, text, Date.now()); };
  const persist = (r: AgentLoop): void => { void window.pastel.testing.loops({ save: { root: r.root, taskId: r.taskId, loop: toSaved(r) } }); };

  // A saved loop this window lacks, or one from a newer start, becomes this window's copy; true when it did.
  function adopt(root: string, taskId: string, saved: SavedLoop): boolean {
    const k = keyOf(root, taskId);
    if (!takesSaved(loops.get(k) ?? null, saved)) return false;
    loops.set(k, fromSaved(root, taskId, saved));
    return true;
  }

  // Testing's refresh hands over the project's saved loops, so lanes rebuild on open.
  function adoptAll(root: string, saved: Record<string, SavedLoop>): void {
    let changed = false;
    for (const [taskId, loop] of Object.entries(saved)) changed = adopt(root, taskId, loop) || changed;
    if (changed) ctx.redraw();
  }

  async function deliver(r: AgentLoop, message: QueueMessage): Promise<boolean> {
    const id = tabOf(message.to === 'tester' ? r.tester : r.fixer);
    const tab = id ? tabs.get(id) : null;
    return tab ? composer.pasteToClaude(tab, composer.stripControls(message.text).trim()) : false;
  }

  // One queue step: new bugs join, fixes move to verify, and each handoff is sent once. A send that fails is tried again.
  // A loop whose testing agent ended it, with no bug in flight, stops stepping.
  async function step(r: AgentLoop): Promise<void> {
    if (!r.inputs || !isRunning(r) || r.sending || !r.fixer) return;
    const progress = latestLoop(updateOf(r.tester)?.replies ?? [], r.startedAt);
    if (progress && isTerminal(progress.phase) && !activeBugs(r.queue).length) {
      r.stoppedAt = Date.now();
      persist(r);
      notify(finishNotice(r.queue, tabOf(r.tester)));
      ctx.redraw();
      return;
    }
    const names = { tester: nameOf('tester', r.inputs.names), fixer: nameOf('fixer', r.inputs.names) };
    const fixer = updateOf(r.fixer);
    const before = JSON.stringify([r.queue, r.events]);
    const queueBefore = r.queue;
    // With no testing agent yet, criteria lines wait for it; only the bugs she sent move.
    const result = stepLoop(r, {
      bugs: r.tester ? r.inputs.bugs : [], runs: r.inputs.runs, testerRound: progress?.round ?? 0,
      fixerBusy: Boolean(fixer?.busy), fixesDone: fixLines(fixer?.replies ?? [], r.startedAt), now: Date.now(),
    }, names);
    r.queue = result.queue;
    r.events = result.events;
    r.sending = true;
    try {
      for (const message of result.send) if (!(await deliver(r, message))) r.queue = unsent(r.queue, message);
    } finally {
      r.sending = false;
    }
    if (JSON.stringify([r.queue, r.events]) === before) return;
    for (const bug of fixesLanded(queueBefore, r.queue)) notify(fixNotice(bug, names.fixer, tabOf(r.fixer)));
    persist(r);
    ctx.redraw();
  }

  // The saved copy becomes this window's, keeping what only this window reads (logs, tokens); true when it changed.
  function takeSaved(r: AgentLoop, saved: SavedLoop): boolean {
    const before = JSON.stringify(toSaved(r));
    Object.assign(r, saved);
    return JSON.stringify(toSaved(r)) !== before;
  }

  // Bugs sent from another window join this owner's queue, once each.
  function mergeAdded(r: AgentLoop, added: readonly AddedBug[]): void {
    for (const { bug, at } of added) {
      const result = addSent(r.queue, bug, at);
      if (!result.added) continue;
      r.queue = result.queue;
      note(r, 'fixer', `You → ${nameOf('fixer', r.inputs?.names)} · ${bug.name}`);
    }
  }

  const notify = (notice: LoopNotice): void => { void window.pastel.testing.notify(notice); };

  // Agents with a prompt on screen in this window, across every loop and live draft: the lane word, the dock badge,
  // and one notification per new prompt.
  function scanWaiting(): void {
    const now = new Map<string, { name: string; tabId: string }>();
    for (const r of loops.values()) {
      if (r.stoppedAt) continue;
      for (const role of ROLES) {
        const agent = agentOf(r, role);
        const id = tabOf(agent);
        const tab = id ? tabs.get(id) : null;
        if (agent && id && tab && composer.claudeIsAsking(tab)) now.set(agent.sessionId, { name: nameOf(role, r.inputs?.names), tabId: id });
      }
    }
    for (const sessionId of newlyWaiting(waiting, new Set(now.keys()))) {
      const agent = now.get(sessionId);
      if (agent) notify(needsNotice(agent.name, agent.tabId));
    }
    const changed = now.size !== waiting.size || [...now.keys()].some((id) => !waiting.has(id));
    waiting = new Set(now.keys());
    if (changed) { badge(now.size); ctx.redraw(); }
  }

  // The dock's Testing button: a dot while any agent waits on her.
  function badge(count: number): void {
    const button = document.getElementById('testing-button');
    if (!button) return;
    let dot = button.querySelector<HTMLElement>('.dock-badge');
    if (!dot) {
      dot = document.createElement('span');
      dot.className = 'dock-badge';
      dot.setAttribute('aria-hidden', 'true');
      button.append(dot);
    }
    dot.hidden = count === 0;
    button.dataset.needsYou = String(count);
    button.dataset.title ??= button.title; // its own tooltip, put back once nobody waits
    button.title = count ? `${count === 1 ? 'An agent needs' : `${count} agents need`} you in its tab` : button.dataset.title;
  }

  // Every tick: Needs you is read from this window's screens; while a loop runs, main lists the loops this window steps
  // or shows. The owner steps each; another window's loop is mirrored from what its owner saved.
  let ticks = 0;
  let ticking = false;
  async function tick(): Promise<void> {
    ticks += 1;
    scanWaiting();
    if (ticking || (![...loops.values()].some(isRunning) && ticks % FIND_EVERY)) return;
    ticking = true;
    try {
      const known = [...loops.values()].filter(isRunning).map((r) => ({ root: r.root, taskId: r.taskId }));
      const reply = await window.pastel.testing.loops({ known });
      if (isIpcError(reply)) return;
      let changed = false;
      for (const f of reply.loops) changed = adopt(f.root, f.taskId, f.loop) || changed;
      for (const f of reply.loops) {
        const k = keyOf(f.root, f.taskId);
        const r = loops.get(k);
        if (!r) continue;
        r.inputs = { bugs: f.bugs, runs: f.runs, names: f.names };
        if (!f.owner) { owned.delete(k); elsewhere.add(k); changed = takeSaved(r, f.loop) || changed; continue; }
        elsewhere.delete(k);
        if (!owned.has(k)) { owned.add(k); changed = takeSaved(r, f.loop) || changed; } // just became the owner: the saved copy is the truth
        if (f.added.length) { mergeAdded(r, f.added); persist(r); changed = true; }
        await step(r);
      }
      if (changed) ctx.redraw();
    } finally {
      ticking = false;
    }
  }
  setInterval(() => void tick(), TICK_MS);
  // A clicked loop notification shows that agent's tab.
  window.pastel.testing.onShowTab(({ tabId }) => { if (tabs.get(tabId)) tabs.activate(tabId); });

  // The shown task's agents: their action logs and tokens, from each session's transcript.
  async function refreshLogs(): Promise<void> {
    const r = record();
    const from = ctx.tabId();
    if (!r || !from) return;
    for (const role of ROLES) {
      const agent = agentOf(r, role);
      if (!agent) continue;
      const reply = await window.pastel.testing.agentLog({ tabId: from, root: ctx.picked(), sessionId: agent.sessionId });
      if (isIpcError(reply) || 'note' in reply) continue;
      r.actions[role] = reply.actions;
      r.tokens[role] = reply.tokens;
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

  // Tokens per round: this task's finished rounds averaged once it has some, else a rough figure from the two briefs
  // and the size of the task's last run output.
  function estimate(status: LoopStatus): RoundEstimate | null {
    const b = briefs('', 5);
    if (!b) return null;
    const last = ctx.taskRuns()[0];
    const output = last ? last.stages.reduce((n, s) => n + s.output.length + s.tests.reduce((m, t) => m + t.name.length + (t.failure?.length ?? 0), 0), 0) : 0;
    const rough = estimateRoundTokens({ briefChars: [b.tester.length, b.fixer.length], suiteOutputChars: output });
    const r = shownLoop();
    const over = Boolean(r?.stoppedAt) || status === 'done' || status === 'stopped';
    return roundEstimate(r ? finishedRounds(r.actions.tester, r.actions.fixer, r.startedAt, over) : [], rough);
  }

  async function start(focus: string, rounds: number): Promise<void> {
    const from = ctx.tabId();
    const task = ctx.task();
    const root = ctx.root();
    const b = briefs(focus, rounds);
    if (!from || !task || !root || !b || isActive(facts().status)) return;
    const shown = shownLoop();
    const joining = shown && fixerLive(shown) && !shown.tester ? shown : null; // her bug fix agent already runs: only the testing agent starts
    const drafter = drafting();
    const reuse = !joining && drafter && tabOf(drafter.tester) ? drafter : null; // the drafting agent's open tab becomes the loop's testing agent
    const reply = await window.pastel.testing.loopStart({ tabId: from, root: ctx.picked(), taskId: task.id, testerBrief: reuse ? null : b.tester, fixerBrief: joining ? null : b.fixer, ...(reuse ? { reuseDraft: true } : {}) });
    if (isIpcError(reply) || 'note' in reply) { ctx.say(isIpcError(reply) ? `Couldn’t start the loop: ${reply.error}` : reply.note); return; }
    if (!reply.tester || !(reply.fixer ?? joining?.fixer)) { ctx.say('Couldn’t start the loop. Try again.'); return; }
    if (reuse && reply.fixer) {
      const testerTab = tabOf(reply.tester);
      const tab = testerTab ? tabs.get(testerTab) : null;
      const sent = tab ? await composer.pasteToClaude(tab, composer.stripControls(b.tester).trim()) : false;
      const r = fromSaved(root, task.id, { kind: 'loop', tester: reply.tester, fixer: reply.fixer, startedAt: Date.now(), stoppedAt: null, queue: [], events: reuse.events });
      r.tokens = { tester: reuse.tokens.tester, fixer: NO_TOKENS };
      note(r, 'tester', sent ? `${nameOf('tester')} moves on to the test loop in its tab` : `Couldn’t paste the loop brief into ${nameOf('tester')}’s tab`);
      note(r, 'fixer', `Started ${nameOf('fixer')} in a new tab`);
      loops.set(keyOf(root, task.id), r);
      persist(r);
      ctx.say(sent ? `${nameOf('tester')} moves on to the test loop in its tab. ${nameOf('fixer')} is starting in a new tab.` : `Couldn’t reach ${nameOf('tester')}’s tab. Stop the loop and try again.`);
      return;
    }
    if (joining) {
      joining.tester = reply.tester;
      joining.tokens.tester = NO_TOKENS;
      note(joining, 'tester', `Started ${nameOf('tester')} in a new tab`);
      persist(joining);
      ctx.say(reply.tester.tabId ? `${nameOf('tester')} is starting in a new tab. ${nameOf('fixer')} keeps fixing.` : 'Couldn’t open a tab for the testing agent. Try again.');
      return;
    }
    if (!reply.fixer) return;
    const r = fromSaved(root, task.id, { kind: 'loop', tester: reply.tester, fixer: reply.fixer, startedAt: Date.now(), stoppedAt: null, queue: [], events: noEvents() });
    r.tokens = { tester: NO_TOKENS, fixer: NO_TOKENS };
    note(r, 'tester', `Started ${nameOf('tester')} in a new tab`);
    note(r, 'fixer', `Started ${nameOf('fixer')} in a new tab`);
    loops.set(keyOf(root, task.id), r);
    owned.add(keyOf(root, task.id)); // main made this window its owner
    elsewhere.delete(keyOf(root, task.id));
    persist(r);
    ctx.say(reply.tester.tabId && reply.fixer.tabId ? `${nameOf('tester')} and ${nameOf('fixer')} are starting in two new tabs.` : 'Couldn’t open both tabs. Close the loop and try again.');
  }

  // Her "Send to bug fix agent": the failure joins the task's bug queue, else the bug fix agent starts on it in a tab she
  // is shown. Its fix waits in "Awaiting verify" until a newer run of that test or stage passes. Returns the note to show.
  async function sendToFixer(bug: SentBug): Promise<string> {
    const from = ctx.tabId();
    const task = ctx.task();
    const root = ctx.root();
    if (!from || !task || !root) return 'Pick a task first.';
    const fixer = nameOf('fixer');
    const shown = shownLoop();
    const k = keyOf(root, task.id);
    if (shown && fixerLive(shown) && owned.has(k)) {
      const { queue, added } = addSent(shown.queue, bug, Date.now());
      if (!added) return `${fixer} already has "${bug.name}" in its queue.`;
      shown.queue = queue;
      note(shown, 'fixer', `You → ${fixer} · ${bug.name}`);
      persist(shown);
      ctx.redraw();
      return `Sent "${bug.name}" to ${fixer}'s queue. Run the suite again once it says done, to verify.`;
    }
    // Not stepped here: main adds it to the saved queue while the bug fix agent is live in any window.
    const queued = await window.pastel.testing.loopAddBug({ tabId: from, root: ctx.picked(), taskId: task.id, bug });
    if (isIpcError(queued)) return `Couldn’t send it: ${queued.error}`;
    if ('note' in queued) return queued.note;
    if (queued.queued) {
      if (!queued.added) return `${fixer} already has "${bug.name}" in its queue.`;
      if (shown) { shown.queue = addSent(shown.queue, bug, Date.now()).queue; ctx.redraw(); } // shown at once; the next tick takes the saved copy
      return `Sent "${bug.name}" to ${fixer}'s queue. Run the suite again once it says done, to verify.`;
    }
    const brief = buildSentFixerBrief({ taskId: task.id, taskTitle: task.title, bugName: bug.name, prompt: bug.sent.failure, names: { tester: nameOf('tester'), fixer } });
    const reply = await window.pastel.testing.loopStart({ tabId: from, root: ctx.picked(), taskId: task.id, fixerBrief: brief, show: true });
    if (isIpcError(reply)) return `Couldn’t start ${fixer}: ${reply.error}`;
    if ('note' in reply) return reply.note;
    if (!reply.fixer?.tabId) return `Couldn’t open a tab for ${fixer}. Try again.`;
    const now = Date.now();
    const keep = shown && isRunning(shown) ? shown : null; // a running loop whose bug fix agent's tab is gone keeps its testing agent
    const r = fromSaved(root, task.id, keep
      ? { ...toSaved(keep), fixer: reply.fixer, queue: keep.queue.map((b) => (b.state === 'fixing' ? { ...b, state: 'open' as const, asked: false } : b)) }
      : { kind: 'loop', tester: null, fixer: reply.fixer, startedAt: now, stoppedAt: null, queue: [], events: noEvents() });
    r.queue = addSent(r.queue, bug, now, 'fixing').queue;
    r.tokens = { tester: keep ? keep.tokens.tester : null, fixer: NO_TOKENS };
    note(r, 'fixer', `Started ${fixer} in a new tab on ${bug.name}`);
    loops.set(k, r);
    owned.add(k); // main made this window its owner
    elsewhere.delete(k);
    persist(r);
    return `Started ${fixer} on "${bug.name}". Run the suite again once it says done, to verify.`;
  }

  // Stop halts both: Esc to each, then the stop message once each is idle.
  async function stop(): Promise<void> {
    const r = shownLoop();
    if (!r || r.stopping) return;
    if (elsewhere.has(keyOf(r.root, r.taskId))) { ctx.say('This loop runs in another window, where its agents’ tabs are. Stop it there.'); return; }
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
    persist(r);
    ctx.say('Asked both agents to stop. Their summaries show in their tabs.');
    ctx.redraw();
  }

  // Its tab here: busy, and whether a prompt on its screen waits on her.
  function screenOf(agent: LoopAgent | null): { busy: boolean; asking: boolean } | null {
    const id = tabOf(agent);
    const tab = id ? tabs.get(id) : null;
    return tab?.update ? { busy: Boolean(tab.update.busy), asking: composer.claudeIsAsking(tab) } : null;
  }

  // The tab Petal opened for an agent, while it still follows that agent's session; never another tab on the same session.
  const ownTab = (agent: LoopAgent | null | undefined): string | null =>
    (agent?.tabId && tabs.get(agent.tabId)?.update?.sessionId === agent.sessionId ? agent.tabId : null);

  // Close agents shows once the loop is over or both agents are idle, while one of their tabs is still open here.
  function closeModel(status: LoopStatus, lanes: readonly LaneModel[]): AgentsModel['close'] {
    const r = shownLoop();
    const agents = r ? [r.tester, r.fixer].filter((a): a is LoopAgent => a !== null) : [];
    if (!r || closedLoops.has(`${keyOf(r.root, r.taskId)}:${r.startedAt}`) || !agents.some((a) => ownTab(a))) return null;
    const over = Boolean(r.stoppedAt) || status === 'done' || status === 'stopped';
    if (!over && lanes.some((l) => l.busy)) return null;
    return { count: agents.length, asking: closeAsking, closing };
  }

  // Each agent's claude goes through the Sessions panel's Close in main, then its tab closes; the loop is marked stopped.
  async function closeAgents(): Promise<void> {
    const r = shownLoop();
    const from = ctx.tabId();
    if (!r || !from || closing) return;
    closeAsking = false;
    closing = true;
    draw();
    const reply = await window.pastel.testing.closeAgents({ tabId: from, root: ctx.picked(), taskId: r.taskId });
    closing = false;
    if (isIpcError(reply) || 'note' in reply) { ctx.say(isIpcError(reply) ? `Couldn’t close the agents: ${reply.error}` : reply.note); draw(); return; }
    for (const result of reply.closed) {
      if (result.outcome === 'running') continue; // its claude didn't exit; the tab stays so nothing is cut off
      const id = ownTab([r.tester, r.fixer].find((a) => a?.sessionId === result.sessionId));
      if (id) tabs.requestClose(id);
    }
    r.stoppedAt = r.stoppedAt ?? Date.now();
    for (const role of ROLES) if (agentOf(r, role)) note(r, role, 'Closed');
    persist(r);
    const stuck = reply.closed.find((c) => c.outcome === 'running');
    if (!stuck) closedLoops.add(`${keyOf(r.root, r.taskId)}:${r.startedAt}`); // the button goes now, not on the next poll
    ctx.say(stuck ? `An agent is still running: ${stuck.note}. Its tab stays open.` : 'Closed the agents and their tabs.');
    ctx.redraw();
  }

  function laneStatus(role: AgentRole, r: AgentLoop | null, progress: LoopProgress | null): string {
    const agent = r ? agentOf(r, role) : null;
    return laneWord({
      role, kind: r?.kind ?? 'loop', started: Boolean(r && agent), stopped: Boolean(r?.stoppedAt), tab: screenOf(agent), starting: isStarting(r),
      testerLine: progress ? `${phaseWord(progress.phase)} · round ${progress.round}/${progress.total}` : null, fixing: r?.queue.find((b) => b.state === 'fixing')?.name ?? null, draftEnded: r?.kind === 'draft' && Boolean(draft()?.ended),
    });
  }

  // Her message to one agent, through the reply box's paste path; refused while that agent is asking something.
  async function send(role: AgentRole, text: string): Promise<void> {
    const r = record();
    const agent = r ? agentOf(r, role) : null;
    const asking = (sessionId: string) => { const id = tabOf({ sessionId, tabId: null }); const tab = id ? tabs.get(id) : null; return tab ? composer.claudeIsAsking(tab) : false; };
    const route = routeMessage(role, agent ? { tester: agent, fixer: agent } : null, asking, text); // only the role's own entry is read
    if ('note' in route) { notes[role] = route.note; draw(); return; }
    const id = tabOf(agent);
    if (!id && r && agent) { await reopen(r, role, agent, text); return; }
    const tab = id ? tabs.get(id) : null;
    const sent = tab ? await composer.pasteToClaude(tab, composer.stripControls(text).trim()) : false;
    if (sent && r) { drafts[role] = ''; note(r, role, `You → ${nameOf(role)}: ${text.trim().slice(0, 80)}`); persist(r); }
    notes[role] = sent ? `Sent to ${nameOf(role)}.` : 'Couldn’t reach that tab. Try again.';
    (document.activeElement as HTMLElement | null)?.blur();
    draw();
  }

  // Its tab is gone (closed, or Petal restarted): History's reply path resumes its session in a new tab and sends her
  // message once Claude is ready there. With no message, Open tab: the new tab is shown.
  async function reopen(r: AgentLoop, role: AgentRole, agent: LoopAgent, text: string | null): Promise<void> {
    const name = nameOf(role);
    reopened.set(agent.sessionId, Date.now());
    notes[role] = reopenNote(name, null, Boolean(text));
    draw();
    const limitAction = `reopen ${name}`;
    const outcome = text ? await historyReply.sendReply(agent.sessionId, text, false, limitAction) : await historyReply.openSession(agent.sessionId, limitAction);
    const problem = 'note' in outcome ? outcome.note || 'Try again.' : 'confirm' in outcome ? outcome.confirm : null;
    if (problem) reopened.delete(agent.sessionId);
    notes[role] = reopenNote(name, problem, Boolean(text));
    if (!problem) {
      note(r, role, text ? `You → ${name}: ${text.trim().slice(0, 80)} · reopened its session` : `Reopened ${name}’s session in a new tab`);
      if (text) drafts[role] = '';
      persist(r);
      const tab = text ? null : historyReply.tabFor(agent.sessionId);
      if (tab) tabs.activate(tab.id);
    }
    (document.activeElement as HTMLElement | null)?.blur();
    draw();
  }

  // Reopening ends when a tab picks the session up, or reads as failed once REOPEN_MS passes without one.
  function reachOf(role: AgentRole, r: AgentLoop | null, agent: LoopAgent | null, tabId: string | null): LaneReach {
    const at = agent ? reopened.get(agent.sessionId) ?? null : null;
    const reach = laneReach(agent, tabId, at, Date.now(), opening(r, agent));
    if (agent && at !== null && reach !== 'reopening') {
      reopened.delete(agent.sessionId);
      if (reach !== 'tab') notes[role] = reopenStalledNote(nameOf(role));
    }
    return reach;
  }

  function draw(): void {
    const typing = element.contains(document.activeElement) && (renaming !== null || document.activeElement instanceof HTMLTextAreaElement);
    if (typing) return; // her typing survives the refresh
    const task = ctx.task();
    const r = record();
    element.hidden = !task || (!ctx.suite() && !r); // a draft's lane shows before the suite exists
    if (element.hidden) return;
    const { progress, status } = facts();
    const roles = ctx.suite() || r?.kind === 'loop' ? ROLES : ROLES.filter((role) => r && agentOf(r, role));
    const lanes: LaneModel[] = roles.map((role) => {
      const agent = r ? agentOf(r, role) : null;
      const status = laneStatus(role, r, progress);
      const tabId = tabOf(agent);
      return {
        role, name: nameOf(role), started: Boolean(agent), tabId, reach: reachOf(role, r, agent, tabId), status, busy: Boolean(r && agent && !r.stoppedAt && updateOf(agent)?.busy), needsYou: status === NEEDS_YOU,
        tokens: agent && r?.tokens[role] ? { total: totalTokens(r.tokens[role]), cached: cachedTokens(r.tokens[role]) } : null, actions: agent ? r?.actions[role] ?? [] : [], events: agent ? r?.events[role] ?? [] : [],
        turns: r && agent ? chatTurns(updateOf(agent)?.replies ?? [], r.startedAt) : [], startedAt: r?.startedAt ?? 0, note: notes[role] ?? '',
      };
    });
    const loop = r?.kind === 'loop' ? r : null;
    const round = loop ? roundTokens(loop.actions.tester, loop.actions.fixer, loop.startedAt) : null;
    const started = lanes.filter((l) => l.started);
    const sum = (pick: (t: { total: number; cached: number }) => number) => started.reduce((n, l) => n + (l.tokens ? pick(l.tokens) : 0), 0);
    element.replaceChildren(agentsPanel({
      lanes, queue: loop?.queue ?? null, estimate: estimate(status), round: round ? { label: roundLabel(round), tokens: round.tokens, cached: round.cached } : null,
      total: started.length ? { total: sum((t) => t.total), cached: sum((t) => t.cached) } : null, renaming, logOpen, logShown, view, drafts,
      close: closeModel(status, lanes),
    }, {
      rename: (role) => { renaming = role; draw(); },
      saveName: (role, name) => void saveName(role, name),
      openTab: (id) => tabs.activate(id),
      reopen: (role) => { const r = record(); const agent = r ? agentOf(r, role) : null; if (r && agent) void reopen(r, role, agent, null); },
      toggleLog: (role) => { if (!logOpen.delete(role)) logOpen.add(role); draw(); },
      showOlder: (role) => { logShown[role] = (logShown[role] ?? 20) + 20; draw(); },
      setView: (role, next) => { view[role] = next; if (next === 'actions') logOpen.add(role); draw(); },
      draft: (role, text) => { drafts[role] = text; },
      send: (role, text) => void send(role, text),
      askClose: (asking) => { closeAsking = asking; draw(); },
      close: () => void closeAgents(),
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

  // For the snapshot harness: what the shown task's lanes say, and forgetting this window's copies as a new window would.
  const state = () => {
    const r = record();
    return { kind: r?.kind ?? null, draft: draft(), queue: r?.queue ?? [], events: r ? r.events : noEvents(), renaming, notes: { ...notes }, lanes: ROLES.map((role) => ({ role, name: nameOf(role), status: laneStatus(role, r, facts().progress) })) };
  };

  return { element, record, facts, refreshLogs, adoptAll, start, stop, sendToFixer, draw, testerTab: () => facts().testerTab, draft, askAgain, checkDraft, state, forget: () => { loops.clear(); owned.clear(); elsewhere.clear(); } };
}

export type Agents = ReturnType<typeof createAgents>;

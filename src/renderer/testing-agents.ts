// A task's test loop as two agents at once: the testing agent and the bug fix agent. Main owns both: it steps the bug
// queue, routes every message by session id and resumes an agent with no claude. This window mirrors main's loops,
// pastes what main asks into the agent terminals it holds, and reports which of them show a prompt. An agent waiting on
// a prompt reads Needs you and badges the dock's Testing button.
import * as tabs from './tabs';
import * as composer from './composer';
import { isIpcError } from './dom';
import { agentsPanel, type AgentsModel, type LaneModel } from './testing-agents-view';
import { latestLoop, phaseWord, type LoopProgress } from '../shared/loop-line';
import { buildFixerBrief, buildLoopBrief, isActive, loopStatus, type CriteriaItem, type LoopStatus } from '../shared/test-loop';
import { queueDone, type SentBug } from '../shared/bug-queue';
import { laneWord, needsNotice, newlyWaiting, NEEDS_YOU, SCENARIOS_READY, type LoopNotice } from '../shared/loop-signals';
import { agentOf, finishedRounds, noEvents, roundLabel, roundTokens } from '../shared/agent-loop';
import { agentName, type AgentNames, type AgentRole } from '../shared/agent-names';
import { cachedTokens, estimateRoundTokens, roundEstimate, totalTokens, type RoundEstimate, type TokenUsage } from '../shared/token-usage';
import { OUTSIDE_AGENT, type TaskSuite } from '../shared/task-suite';
import { askAgainText, awaitingReview, draftEnded, suiteProblemText } from '../shared/suite-draft';
import type { AgentAction } from '../shared/agent-actions';
import { agentTab, chatTurns, laneReach, reopenStalledNote, routeMessage, type LaneReach } from '../shared/agent-chat';
import type { AgentView, LoopFacts, LoopView, PipelineRun, StackItem } from '../shared/testing';
import type { Prd, Task } from '../shared/tasks';

export interface AgentLoop extends LoopView {
  root: string;
  taskId: string;
  actions: Record<AgentRole, AgentAction[]>;
  tokens: Record<AgentRole, TokenUsage | null>;
  stopping: boolean;
  inputs: Pick<LoopFacts, 'names'> | null; // from main's last tick; null until then
}

export interface AgentContext {
  root: () => string | null;
  picked: () => string | null;
  tabId: () => string | null; // the tab Testing was opened from
  task: () => Task | null;
  prd: () => Prd | null; // the shown task's
  scenarios: () => CriteriaItem[]; // the shown task's
  suite: () => TaskSuite | null;
  stack: () => StackItem[];
  names: () => AgentNames;
  taskRuns: () => PipelineRun[];
  redraw: () => void; // draws only while Testing is open
  renamed: () => Promise<void>; // reload after a name changed
  say: (text: string) => void; // the loop panel's note
}

const ROLES: AgentRole[] = ['tester', 'fixer'];
const TICK_MS = 1500; // main's loops are read this often, Testing open or not
const FIND_EVERY = 10; // with nothing at work, ask main for loops every 10th tick

const keyOf = (root: string, taskId: string): string => `${root}:${taskId}`;
const isRunning = (r: AgentLoop): boolean => r.kind === 'loop' && !r.stoppedAt;
const atWork = (r: AgentLoop): boolean => isRunning(r) || [r.tester, r.fixer].some((a) => a && a.state !== 'ended' && a.state !== 'closed');

export function createAgents(ctx: AgentContext) {
  const loops = new Map<string, AgentLoop>(); // `${root}:${taskId}` -> its loop or draft, this window's copy
  const shownViews = new Map<string, string>(); // `${root}:${taskId}` -> main's last view of it, to redraw only on change
  let waiting = new Set<string>(); // agent sessions with a prompt on screen here, at the last tick
  let askingReported = '';
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

  const key = (): string | null => { const root = ctx.root(); const task = ctx.task(); return root && task ? keyOf(root, task.id) : null; };
  const record = (): AgentLoop | null => loops.get(key() ?? '') ?? null; // the shown task's loop or draft
  const shownLoop = (): AgentLoop | null => { const r = record(); return r?.kind === 'loop' ? r : null; };
  const tabOf = (agent: AgentView | null | undefined): string | null =>
    agentTab(agent, tabs.ids().map((id) => { const update = tabs.get(id)?.update; return { id, sessionId: update?.sessionId ?? null, live: update?.state === 'live' }; }));
  const opening = (agent: AgentView | null): boolean => agent?.state === 'starting';
  const busyOf = (agent: AgentView | null): boolean => agent?.state === 'working';
  const askingOf = (agent: AgentView | null): boolean => agent?.state === 'asking';
  const askedAt = new Map<string, number>(); // `${root}:${taskId}` -> when Petal last pasted a follow-up to its drafting agent
  const pastedProblems = new Set<string>(); // `${key}:${problem}` pasted back once each
  const drafting = (): AgentLoop | null => { const r = record(); return r?.kind === 'draft' && !r.stoppedAt && r.tester ? r : null; };
  // The shown task's draft: its testing agent's tab, and whether it ended with no suite.
  function draft(): { tabId: string | null; ended: boolean } | null {
    const r = drafting();
    if (!r?.tester) return null;
    const id = tabOf(r.tester);
    const since = Math.max(r.startedAt, askedAt.get(keyOf(r.root, r.taskId)) ?? 0);
    const replies = updateOf(r.tester)?.replies ?? [];
    const ended = draftEnded({
      suite: Boolean(ctx.suite()),
      tab: id ? 'open' : opening(r.tester) ? 'starting' : 'gone',
      busy: busyOf(r.tester), asking: askingOf(r.tester),
      worked: replies.some((reply) => Date.parse(reply.timestamp ?? '') >= since),
      reviewing: awaiting().length > 0,
    });
    return { tabId: id, ended };
  }

  // Scenarios first: the shown task's [todo] scenarios waiting on her, once its testing agent sits idle on them.
  function awaiting(): CriteriaItem[] {
    const r = record();
    if (!r?.tester || r.stoppedAt || (r.tester.state !== 'idle' && r.tester.state !== 'ended')) return [];
    return awaitingReview(ctx.scenarios(), { stopped: false, approved: r.approvedScenarios ?? [], busy: busyOf(r.tester), asking: askingOf(r.tester) });
  }

  // Looks right: the go-ahead goes into the testing agent's tab, and the names she approved are saved with its loop or draft.
  async function approveScenarios(): Promise<void> {
    const r = record();
    const task = ctx.task();
    const shown = awaiting();
    if (!r || !task || !shown.length) return;
    const reply = await window.pastel.testing.approveScenarios({ root: r.root, taskId: r.taskId, names: shown.map((s) => s.name) });
    notes.tester = isIpcError(reply) ? `Couldn’t send it: ${reply.error}` : 'note' in reply ? reply.note : `Sent. ${nameOf('tester')} is writing the tests.`;
    await tick();
    ctx.redraw();
  }

  // Edit scenarios: the task's criteria file in her editor; Petal reads it again on its next refresh.
  async function editScenarios(): Promise<void> {
    const from = ctx.tabId();
    const task = ctx.task();
    if (!from || !task) return;
    const reply = await window.pastel.testing.openCriteria({ tabId: from, root: ctx.picked(), taskId: task.id });
    notes.tester = isIpcError(reply) ? `Couldn’t open the file: ${reply.error}` : 'note' in reply ? reply.note : 'Opened in your editor. Save it, then come back here.';
    draw();
  }

  // A follow-up to the testing agent, through main (which resumes it if needed); a draft's worked counts again from now.
  async function pasteToTester(r: AgentLoop, text: string, event: string): Promise<boolean> {
    if (!r.tester) return false;
    const reply = await window.pastel.testing.agentSend({ root: r.root, sessionId: r.tester.sessionId, text, event });
    if (isIpcError(reply) || 'note' in reply) return false;
    askedAt.set(keyOf(r.root, r.taskId), Date.now());
    return true;
  }

  // Ask again: the drafting agent gets a follow-up, resumed if it ended; 'start' when there is none.
  async function askAgain(): Promise<'pasted' | 'start' | 'failed'> {
    const r = drafting();
    const task = ctx.task();
    if (!r || !task || !r.tester || r.tester.state === 'closed') return 'start';
    return (await pasteToTester(r, askAgainText(task.id), `You → ${nameOf('tester')} · asked again for the suite`)) ? 'pasted' : 'failed';
  }

  // After each refresh: a suite file the drafting agent wrote but Petal couldn't use goes back to it once, with a fix request.
  async function checkDraft(problem: string | null): Promise<void> {
    const r = drafting();
    const task = ctx.task();
    if (!r || !task || !problem || problem === OUTSIDE_AGENT || !tabOf(r.tester)) return;
    const k = `${keyOf(r.root, r.taskId)}:${problem}`;
    if (pastedProblems.has(k) || updateOf(r.tester)?.busy) return;
    pastedProblems.add(k);
    if (!(await pasteToTester(r, suiteProblemText(task.id, problem), `Petal → ${nameOf('tester')} · the suite file can’t be used`))) pastedProblems.delete(k);
    else ctx.redraw();
  }
  const updateOf = (agent: AgentView | null | undefined) => { const id = tabOf(agent); return id ? tabs.get(id)?.update ?? null : null; };
  const nameOf = (role: AgentRole, names: AgentNames = ctx.names()): string => agentName(names, role);

  // The testing agent's Loop line drives the status; the loop is done only once the queue is empty too.
  function facts(): { record: AgentLoop | null; testerTab: string | null; progress: LoopProgress | null; status: LoopStatus } {
    const r = shownLoop();
    const testerTab = tabOf(r?.tester);
    const progress = latestLoop(updateOf(r?.tester)?.replies ?? [], r?.startedAt ?? 0);
    const startedAt = r?.tester ? r.startedAt : null; // a bug fix agent alone hasn't started the test loop
    const live = r?.tester?.state === 'working' || r?.tester?.state === 'idle' || r?.tester?.state === 'asking';
    let status = loopStatus({ progress, live, startedAt, stoppedAt: r?.stoppedAt ?? null, now: Date.now() });
    if (r && !r.stoppedAt && status === 'done' && !queueDone(r.queue, progress?.phase ?? null)) status = 'running'; // fixes still in flight
    return { record: r, testerTab, progress, status };
  }

  // Main's view of a loop becomes this window's copy, keeping what only this window reads (logs, tokens); true when it changed.
  function adopt(root: string, taskId: string, view: LoopView): boolean {
    const k = keyOf(root, taskId);
    const text = JSON.stringify(view);
    if (shownViews.get(k) === text) return false;
    shownViews.set(k, text);
    const local = loops.get(k);
    loops.set(k, { ...view, root, taskId, actions: local?.actions ?? { tester: [], fixer: [] }, tokens: local?.tokens ?? { tester: null, fixer: null }, stopping: local?.stopping ?? false, inputs: local?.inputs ?? null });
    return true;
  }

  // Testing's refresh hands over the project's loops, so lanes rebuild on open.
  function adoptAll(root: string, views: Record<string, LoopView>): void {
    let changed = false;
    for (const [taskId, view] of Object.entries(views)) changed = adopt(root, taskId, view) || changed;
    if (changed) ctx.redraw();
  }

  const notify = (notice: LoopNotice): void => { void window.pastel.testing.notify(notice); };

  // Agents with a prompt on screen in this window, across every loop and live draft: the lane word, the dock badge,
  // and one notification per new prompt.
  function scanWaiting(): void {
    const now = new Map<string, { name: string; tabId: string }>();
    const askingHere = new Set<string>();
    for (const r of loops.values()) {
      for (const role of ROLES) {
        const agent = agentOf(r, role);
        const id = tabOf(agent);
        const tab = id ? tabs.get(id) : null;
        if (!agent || !id || !tab || !composer.claudeIsAsking(tab)) continue;
        askingHere.add(id);
        if (!r.stoppedAt) now.set(agent.sessionId, { name: nameOf(role, r.inputs?.names), tabId: id });
      }
    }
    const report = [...askingHere].sort().join('\n');
    if (report !== askingReported) { askingReported = report; window.pastel.testing.reportAsking([...askingHere]); } // main pastes nothing into these
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

  // Every tick: Needs you is read from this window's screens, then main's loops are read while one is at work.
  let ticks = 0;
  let ticking = false;
  async function tick(): Promise<void> {
    ticks += 1;
    scanWaiting();
    if (ticking || (ticks > 1 && ![...loops.values()].some(atWork) && ticks % FIND_EVERY)) return;
    ticking = true;
    try {
      const known = [...loops.values()].map((r) => ({ root: r.root, taskId: r.taskId }));
      const reply = await window.pastel.testing.loops({ known });
      if (isIpcError(reply)) return;
      let changed = false;
      for (const f of reply.loops) {
        changed = adopt(f.root, f.taskId, f.loop) || changed;
        const r = loops.get(keyOf(f.root, f.taskId));
        if (r) r.inputs = { names: f.names };
      }
      if (changed) ctx.redraw();
    } finally {
      ticking = false;
    }
  }
  setInterval(() => void tick(), TICK_MS);
  // A clicked loop notification shows that agent's tab.
  window.pastel.testing.onShowTab(({ tabId }) => { if (tabs.get(tabId)) tabs.activate(tabId); });
  // Main's handoffs and her lane messages: pasted through the reply box's path, which refuses while a prompt is on screen.
  window.pastel.testing.onAgentPaste(({ requestId, tabId, text }) => void (async () => {
    const tab = tabs.get(tabId);
    const outcome = !tab ? 'gone' : composer.claudeIsAsking(tab) ? 'asking' : (await composer.pasteToClaude(tab, composer.stripControls(text).trim())) ? 'sent' : 'gone';
    window.pastel.testing.agentPasted({ requestId, outcome });
  })());

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

  // The scenario names she approved for the shown task, carried from its last loop or draft into the next.
  const approvedSoFar = (): string[] | undefined => record()?.approvedScenarios;

  function briefs(focus: string, rounds: number): { tester: string; fixer: string } | null {
    const task = ctx.task();
    const suite = ctx.suite();
    if (!task || !suite) return null;
    const names = { tester: nameOf('tester'), fixer: nameOf('fixer') };
    const review = !approvedSoFar()?.length; // none approved yet: round 1 stops for her review
    return {
      tester: buildLoopBrief({ focus, rounds, stages: suite.stages, stack: ctx.stack(), taskId: task.id, agent: true, names, sources: { notes: task.notes, prd: ctx.prd() }, review }),
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
    const b = briefs(focus, rounds);
    if (!from || !task || !b || isActive(facts().status)) return;
    const shown = shownLoop();
    const joining = shown && isRunning(shown) && shown.fixer && !shown.tester ? shown : null; // her bug fix agent already runs: only the testing agent starts
    const reply = await window.pastel.testing.loopStart({ tabId: from, root: ctx.picked(), taskId: task.id, testerBrief: b.tester, fixerBrief: joining ? null : b.fixer });
    if (isIpcError(reply) || 'note' in reply) { ctx.say(isIpcError(reply) ? `Couldn’t start the loop: ${reply.error}` : reply.note); return; }
    ctx.say(joining ? `${nameOf('tester')} is starting. ${nameOf('fixer')} keeps fixing.` : `${nameOf('tester')} and ${nameOf('fixer')} are starting.`);
    await tick();
  }

  // Her "Send to bug fix agent": the failure joins the task's bug queue, else the bug fix agent starts on it. Its fix
  // waits in "Awaiting verify" until a newer run of that test or stage passes. Returns the note to show.
  async function sendToFixer(bug: SentBug): Promise<string> {
    const from = ctx.tabId();
    const task = ctx.task();
    if (!from || !task) return 'Pick a task first.';
    const fixer = nameOf('fixer');
    const reply = await window.pastel.testing.sendBug({ tabId: from, root: ctx.picked(), taskId: task.id, bug });
    if (isIpcError(reply)) return `Couldn’t send it: ${reply.error}`;
    if ('note' in reply) return reply.note;
    await tick();
    if (reply.outcome === 'already') return `${fixer} already has "${bug.name}" in its queue.`;
    if (reply.outcome === 'started') return `Started ${fixer} on "${bug.name}". Run the suite again once it says done, to verify.`;
    return `Sent "${bug.name}" to ${fixer}'s queue. Run the suite again once it says done, to verify.`;
  }

  // Stop halts both: main stops the queue, then sends Esc to each and the stop message once each is idle.
  async function stop(): Promise<void> {
    const r = shownLoop();
    if (!r || r.stopping) return;
    r.stopping = true;
    ctx.say('Interrupting both agents, then asking them to stop and summarise.');
    ctx.redraw();
    const reply = await window.pastel.testing.loopStop({ root: r.root, taskId: r.taskId });
    r.stopping = false;
    ctx.say(isIpcError(reply) ? `Couldn’t stop the loop: ${reply.error}` : 'note' in reply ? reply.note : 'Asked both agents to stop. Their summaries show in their terminals.');
    await tick();
    ctx.redraw();
  }

  // Close agents shows once the loop is over or both agents are idle, while one of them is still open.
  function closeModel(status: LoopStatus, lanes: readonly LaneModel[]): AgentsModel['close'] {
    const r = shownLoop();
    const agents = r ? [r.tester, r.fixer].filter((a): a is AgentView => a !== null && a.state !== 'closed') : [];
    if (!r || !agents.length) return null;
    const over = Boolean(r.stoppedAt) || status === 'done' || status === 'stopped';
    if (!over && lanes.some((l) => l.busy)) return null;
    return { count: agents.length, asking: closeAsking, closing };
  }

  // Main closes each agent's claude and its terminal, and marks the loop stopped.
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
    const stuck = reply.closed.find((c) => c.outcome === 'running');
    ctx.say(stuck ? `An agent is still running: ${stuck.note}. Its terminal stays open.` : 'Closed the agents and their terminals.');
    await tick();
    ctx.redraw();
  }

  function laneStatus(role: AgentRole, r: AgentLoop | null, progress: LoopProgress | null): string {
    const agent = r ? agentOf(r, role) : null;
    return laneWord({
      role, kind: r?.kind ?? 'loop', state: agent?.state ?? null, stopped: Boolean(r?.stoppedAt),
      testerLine: progress ? `${phaseWord(progress.phase)} · round ${progress.round}/${progress.total}` : null, fixing: r?.queue.find((b) => b.state === 'fixing')?.name ?? null, draftEnded: r?.kind === 'draft' && Boolean(draft()?.ended),
      scenariosReady: role === 'tester' && awaiting().length > 0,
    });
  }

  // Her message to one agent, through main: pasted when its claude is ready, resumed first when none runs it.
  async function send(role: AgentRole, text: string): Promise<void> {
    const r = record();
    const agent = r ? agentOf(r, role) : null;
    const route = routeMessage(role, agent ? { tester: agent, fixer: agent } : null, () => askingOf(agent), text); // only the role's own entry is read
    if ('note' in route || !r || !agent) { notes[role] = 'note' in route ? route.note : ''; draw(); return; }
    const name = nameOf(role);
    const reply = await window.pastel.testing.agentSend({ root: r.root, sessionId: agent.sessionId, text });
    const sent = !isIpcError(reply) && !('note' in reply);
    if (sent) drafts[role] = '';
    if (sent && reply.outcome === 'resuming') reopened.set(agent.sessionId, Date.now());
    notes[role] = isIpcError(reply) ? `Couldn’t send it: ${reply.error}` : 'note' in reply ? reply.note
      : reply.outcome === 'sent' ? `Sent to ${name}.` : reply.outcome === 'resuming' ? `Resuming ${name}’s session. Your message goes once it’s ready.` : `${name} gets it once it’s ready.`;
    (document.activeElement as HTMLElement | null)?.blur();
    await tick();
    draw();
  }

  // Open terminal: main resumes its session with no message.
  async function reopen(role: AgentRole, agent: AgentView): Promise<void> {
    const r = record();
    if (!r) return;
    reopened.set(agent.sessionId, Date.now());
    const reply = await window.pastel.testing.agentOpen({ root: r.root, sessionId: agent.sessionId });
    const problem = isIpcError(reply) ? reply.error : 'note' in reply ? reply.note : null;
    if (problem) reopened.delete(agent.sessionId);
    notes[role] = problem ? `Couldn’t reopen ${nameOf(role)}’s session. ${problem}` : `Resuming ${nameOf(role)}’s session.`;
    await tick();
    draw();
  }

  // Reopening ends when a tab picks the session up, or reads as failed once REOPEN_MS passes without one.
  function reachOf(role: AgentRole, agent: AgentView | null, tabId: string | null): LaneReach {
    const at = agent ? reopened.get(agent.sessionId) ?? null : null;
    const reach = laneReach(agent, tabId, at, Date.now(), opening(agent));
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
        role, name: nameOf(role), started: Boolean(agent), tabId, reach: reachOf(role, agent, tabId), status, busy: Boolean(r && !r.stoppedAt && busyOf(agent)), needsYou: status === NEEDS_YOU,
        tokens: agent && r?.tokens[role] ? { total: totalTokens(r.tokens[role]), cached: cachedTokens(r.tokens[role]) } : null, actions: agent ? r?.actions[role] ?? [] : [], events: agent ? r?.events[role] ?? [] : [],
        turns: r && agent ? chatTurns(updateOf(agent)?.replies ?? [], r.startedAt) : [], startedAt: r?.startedAt ?? 0, note: notes[role] ?? '',
        review: status === SCENARIOS_READY ? { scenarios: awaiting() } : null,
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
      reopen: (role) => { const r = record(); const agent = r ? agentOf(r, role) : null; if (agent) void reopen(role, agent); },
      toggleLog: (role) => { if (!logOpen.delete(role)) logOpen.add(role); draw(); },
      showOlder: (role) => { logShown[role] = (logShown[role] ?? 20) + 20; draw(); },
      setView: (role, next) => { view[role] = next; if (next === 'actions') logOpen.add(role); draw(); },
      draft: (role, text) => { drafts[role] = text; },
      send: (role, text) => void send(role, text),
      askClose: (asking) => { closeAsking = asking; draw(); },
      close: () => void closeAgents(),
      editScenarios: () => void editScenarios(),
      approveScenarios: () => void approveScenarios(),
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
    return { kind: r?.kind ?? null, draft: draft(), awaiting: awaiting().map((s) => s.name), approved: r?.approvedScenarios ?? null, queue: r?.queue ?? [], events: r ? r.events : noEvents(), renaming, notes: { ...notes }, lanes: ROLES.map((role) => ({ role, name: nameOf(role), status: laneStatus(role, r, facts().progress) })) };
  };

  return { element, record, facts, refreshLogs, adoptAll, start, stop, sendToFixer, draw, testerTab: () => facts().testerTab, draft, awaiting, askAgain, checkDraft, state, forget: () => { loops.clear(); shownViews.clear(); } };
}

export type Agents = ReturnType<typeof createAgents>;

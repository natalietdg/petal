// A task's two Testing agents as lanes: mirrors main's loops, pastes what main asks into its agent terminals, reports prompts.
import * as tabs from './tabs';
import * as composer from './composer';
import * as agentTerms from './agent-terms';
import { isIpcError } from './dom';
import { agentsPanel, keepTurnsScroll, type AgentsModel, type LaneModel } from './testing-agents-view';
import { latestLoop, phaseWord, type LoopProgress } from '../shared/loop-line';
import { IDLE_GIVE_UP_MS, buildFixerBrief, buildLoopBrief, isActive, loopStatus, ticketInText, type CriteriaItem, type LoopStatus } from '../shared/test-loop';
import { queueDone, type SentBug } from '../shared/bug-queue';
import { laneWord, needsNotice, newlyWaiting, NEEDS_YOU, type LoopNotice } from '../shared/loop-signals';
import { ROLES, agentOf, finishedRounds, isRunning, noEvents, roundLabel, roundTokens } from '../shared/agent-loop';
import { agentName, type AgentNames, type AgentRole } from '../shared/agent-names';
import { cachedTokens, estimateRoundTokens, roundEstimate, totalTokens, type RoundEstimate, type TokenUsage } from '../shared/token-usage';
import type { RepoSuite } from '../shared/repo-suite';
import { askAgainText, awaitingReview, draftEnded, suiteProblemText } from '../shared/suite-draft';
import type { AgentAction } from '../shared/agent-actions';
import { canMessage, chatPlaceholder, chatTurns, isAnswered, laneTerminal, mountStep, routeMessage, sentNote, terminalNote, withPending, type ChatTurn, type LaneTerminal, type PendingMessage } from '../shared/agent-chat';
import type { AgentView, LoopFacts, LoopView, StackItem, SuiteRun } from '../shared/testing';
import type { Prd, Task } from '../shared/tasks';
import type { Reply } from '../shared/types';

export interface AgentLoop extends LoopView {
  root: string;
  taskId: string;
  actions: Record<AgentRole, AgentAction[]>;
  tokens: Record<AgentRole, TokenUsage | null>;
  replies: Record<AgentRole, Reply[]>; // newest first, from its transcript or live terminal (agent-log)
  stopping: boolean;
  inputs: Pick<LoopFacts, 'names'> | null; // from main's last read; null until then
}

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

const TICK_MS = 1500; // main's loops are read this often, Testing open or not
const FIND_EVERY = 10; // with nothing at work, ask main for loops every 10th tick

const keyOf = (root: string, taskId: string): string => `${root}:${taskId}`;
const atWork = (r: AgentLoop): boolean => isRunning(r) || [r.tester, r.fixer].some((a) => a && a.state !== 'ended' && a.state !== 'closed');
const blank = <T>(make: () => T): Record<AgentRole, T> => ({ tester: make(), fixer: make() });

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
  const askedAt = new Map<string, number>(); // `${root}:${taskId}` -> when Petal last sent a follow-up to its drafting agent
  const pastedProblems = new Set<string>(); // `${key}:${problem}` sent back once each
  let closeAsking = false;
  let closing = false;
  // The lanes' terminals, by agent session: the ones she asked to see, the box each mounts in, and what is in it.
  const termWanted = new Set<string>();
  const termBoxes = new Map<string, HTMLDivElement>();
  const mounted = new Map<string, string>(); // sessionId -> the agent terminal's tab id in its box
  const resumeAsked = new Set<string>(); // sessions Open terminal already asked main to resume
  const pending = new Map<string, PendingMessage[]>(); // sessionId -> her lane messages no reply has answered yet

  const key = (): string | null => { const root = ctx.root(); const task = ctx.task(); return root && task ? keyOf(root, task.id) : null; };
  const record = (): AgentLoop | null => loops.get(key() ?? '') ?? null; // the shown task's loop or draft
  const shownLoop = (): AgentLoop | null => { const r = record(); return r?.kind === 'loop' ? r : null; };
  const nameOf = (role: AgentRole, names: AgentNames = ctx.names()): string => agentName(names, role);
  const drafting = (): AgentLoop | null => { const r = record(); return r?.kind === 'draft' && !r.stoppedAt && r.tester ? r : null; };
  const poppedOut = (agent: AgentView | null): boolean => Boolean(agent?.hostTabId && !agentTerms.isAgent(agent.hostTabId));
  const terminalOf = (agent: AgentView | null): LaneTerminal => laneTerminal(agent, poppedOut(agent));

  // An agent's replies, newest first: its terminal's live feed when it runs here, else what its log said.
  function repliesOf(r: AgentLoop | null, role: AgentRole): readonly Reply[] {
    const agent = r ? agentOf(r, role) : null;
    const live = agent?.hostTabId ? tabs.get(agent.hostTabId)?.update : null;
    if (live && live.sessionId === agent?.sessionId) return live.replies;
    return r?.replies[role] ?? [];
  }

  // The shown task's draft, and whether it ended with no suite.
  function draft(): { ended: boolean } | null {
    const r = drafting();
    if (!r?.tester) return null;
    const since = Math.max(r.startedAt, askedAt.get(keyOf(r.root, r.taskId)) ?? 0);
    const worked = repliesOf(r, 'tester').some((reply) => Date.parse(reply.timestamp ?? '') >= since);
    return { ended: draftEnded({ suite: Boolean(ctx.suite()), state: r.tester.state, worked, reviewing: awaiting().length > 0 }) };
  }

  // Scenarios first: the shown task's [todo] scenarios waiting on her, once its testing agent sits idle on them.
  function awaiting(): CriteriaItem[] {
    const r = record();
    if (!r?.tester || r.stoppedAt || (r.tester.state !== 'idle' && r.tester.state !== 'ended')) return [];
    return awaitingReview(ctx.scenarios(), { stopped: false, approved: r.approvedScenarios ?? [], busy: false, asking: false });
  }

  // Looks right: main sends the go-ahead to the testing agent (resumed if needed) and saves the names she approved.
  async function approveScenarios(): Promise<void> {
    const r = record();
    const shown = awaiting();
    if (!r || !shown.length) return;
    const reply = await window.pastel.testing.approveScenarios({ root: r.root, taskId: r.taskId, names: shown.map((s) => s.name) });
    notes.tester = isIpcError(reply) ? `Couldn’t send it: ${reply.error}` : 'note' in reply ? reply.note : `Sent. ${nameOf('tester')} is writing the tests.`;
    await tick();
    ctx.redraw();
  }

  // Edit scenarios: the repo's criteria file in her editor; Petal reads it again on its next refresh.
  async function editScenarios(): Promise<void> {
    const from = ctx.tabId();
    if (!from) return;
    const reply = await window.pastel.testing.openCriteria({ tabId: from, root: ctx.picked() });
    notes.tester = isIpcError(reply) ? `Couldn’t open the file: ${reply.error}` : 'note' in reply ? reply.note : 'Opened in your editor. Save it, then come back here.';
    ctx.redraw(); // the note shows under the review, in Scenarios & bugs
  }

  // A follow-up to the testing agent, through main (which resumes it if needed); a draft's worked counts again from now.
  async function sendToTester(r: AgentLoop, text: string, event: string): Promise<boolean> {
    if (!r.tester) return false;
    const reply = await window.pastel.testing.agentSend({ root: r.root, sessionId: r.tester.sessionId, text, event });
    if (isIpcError(reply) || 'note' in reply) return false;
    askedAt.set(keyOf(r.root, r.taskId), Date.now());
    return true;
  }

  // Ask again: the drafting agent gets a follow-up, resumed if it ended; 'start' when there is none to ask.
  async function askAgain(): Promise<'pasted' | 'start' | 'failed'> {
    const r = drafting();
    const task = ctx.task();
    if (!r || !task || !r.tester || r.tester.state === 'closed') return 'start';
    return (await sendToTester(r, askAgainText(ctx.suiteDir()), `You → ${nameOf('tester')} · asked again for the suite`)) ? 'pasted' : 'failed';
  }

  // After each refresh: a suite file the drafting agent wrote but Petal couldn't use goes back to it once, with a fix request.
  async function checkDraft(problem: string | null): Promise<void> {
    const r = drafting();
    const task = ctx.task();
    if (!r?.tester || !task || !problem || r.tester.state === 'closed' || r.tester.state === 'working') return;
    const k = `${keyOf(r.root, r.taskId)}:${problem}`;
    if (pastedProblems.has(k)) return;
    pastedProblems.add(k);
    if (!(await sendToTester(r, suiteProblemText(ctx.suiteDir(), problem), `Petal → ${nameOf('tester')} · the suite file can’t be used`))) pastedProblems.delete(k);
    else ctx.redraw();
  }

  // The testing agent's Loop line drives the status; the loop is done only once the queue is empty too.
  function facts(): { record: AgentLoop | null; progress: LoopProgress | null; status: LoopStatus; stopping: boolean } {
    const r = shownLoop();
    const progress = latestLoop(repliesOf(r, 'tester'), r?.startedAt ?? 0);
    const startedAt = r?.tester ? r.startedAt : null; // a bug fix agent alone hasn't started the test loop
    const live = r?.tester?.state === 'working' || r?.tester?.state === 'idle' || r?.tester?.state === 'asking';
    let status = loopStatus({ progress, live, startedAt, stoppedAt: r?.stoppedAt ?? null, now: Date.now() });
    if (r && !r.stoppedAt && status === 'done' && !queueDone(r.queue, progress?.phase ?? null)) status = 'running'; // fixes still in flight
    return { record: r, progress, status, stopping: Boolean(r && isStopping(r)) };
  }

  // Stopping: asked here, or main stopped the loop and an agent is still finishing its turn before its stop message.
  const isStopping = (r: AgentLoop): boolean => r.stopping
    || (r.stoppedAt !== null && Date.now() - r.stoppedAt < IDLE_GIVE_UP_MS && [r.tester, r.fixer].some((a) => a?.state === 'working'));

  // Main's view of a loop becomes this window's copy, keeping what only this window reads (logs, tokens); true when it changed.
  function adopt(root: string, taskId: string, next: LoopView): boolean {
    const k = keyOf(root, taskId);
    const text = JSON.stringify(next);
    if (shownViews.get(k) === text) return false;
    shownViews.set(k, text);
    const local = loops.get(k);
    loops.set(k, { ...next, root, taskId, actions: local?.actions ?? blank(() => []), tokens: local?.tokens ?? blank(() => null), replies: local?.replies ?? blank(() => []), stopping: local?.stopping ?? false, inputs: local?.inputs ?? null });
    return true;
  }

  // A loop main no longer has (its store was replaced or pruned) leaves this window's copy too.
  function drop(k: string): boolean {
    shownViews.delete(k);
    return loops.delete(k);
  }

  // Testing's refresh hands over all of the project's loops, so lanes rebuild on open.
  function adoptAll(root: string, views: Record<string, LoopView>): void {
    let changed = false;
    for (const [taskId, next] of Object.entries(views)) changed = adopt(root, taskId, next) || changed;
    for (const r of [...loops.values()]) if (r.root === root && !(r.taskId in views)) changed = drop(keyOf(r.root, r.taskId)) || changed;
    if (changed) ctx.redraw();
  }

  const notify = (notice: LoopNotice): void => { void window.pastel.testing.notify(notice); };

  // Agents with a prompt on screen in this window, across every loop and draft: main's asking state, the dock badge,
  // and one notification per new prompt. Main says which terminal runs each agent here; nothing else is trusted.
  function scanWaiting(): void {
    const now = new Map<string, { name: string; tabId: string }>();
    const askingHere = new Set<string>();
    for (const r of loops.values()) {
      for (const role of ROLES) {
        const agent = agentOf(r, role);
        const id = agent?.hostTabId ?? null;
        const tab = id ? tabs.get(id) : null;
        if (!agent || !id || !tab || tab.update?.sessionId !== agent.sessionId || !composer.claudeIsAsking(tab)) continue;
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
    button.title = count ? `${count === 1 ? 'An agent needs' : `${count} agents need`} you in its terminal` : button.dataset.title;
  }

  // Every tick: Needs you is read from this window's screens, then main's loops are read while one is at work.
  let ticks = 0;
  async function tick(): Promise<void> {
    ticks += 1;
    scanWaiting();
    if (ticks > 1 && ![...loops.values()].some(atWork) && ticks % FIND_EVERY) return;
    await readLoops();
  }

  // Main's loops into this window's copy; a read asked for mid-read runs right after it.
  let reading = false;
  let readAgain = false;
  async function readLoops(): Promise<void> {
    if (reading) { readAgain = true; return; }
    reading = true;
    try {
      const known = [...loops.values()].map((r) => ({ root: r.root, taskId: r.taskId }));
      const reply = await window.pastel.testing.loops({ known });
      if (isIpcError(reply)) return;
      let changed = false;
      const listed = new Set<string>();
      for (const f of reply.loops) {
        listed.add(keyOf(f.root, f.taskId));
        changed = adopt(f.root, f.taskId, f.loop) || changed;
        const r = loops.get(keyOf(f.root, f.taskId));
        if (r) r.inputs = { names: f.names };
      }
      for (const k of known.map((x) => keyOf(x.root, x.taskId))) if (!listed.has(k)) changed = drop(k) || changed;
      if (changed) ctx.redraw();
    } finally {
      reading = false;
      if (readAgain) { readAgain = false; void readLoops(); }
    }
  }
  setInterval(() => void tick(), TICK_MS);

  // A clicked loop notification: a tab-bar tab is shown; an agent terminal opens in its lane.
  window.pastel.testing.onShowTab(({ tabId }) => {
    if (!tabs.get(tabId)) return;
    if (!agentTerms.isAgent(tabId)) { agentTerms.showTab(tabId); return; }
    const agent = [...loops.values()].flatMap((r) => [r.tester, r.fixer]).find((a) => a?.hostTabId === tabId);
    if (agent) termWanted.add(agent.sessionId);
    ctx.open();
  });
  // Main's handoffs and her lane messages: pasted through the reply box's path, which refuses while a prompt is on screen.
  window.pastel.testing.onAgentPaste(({ requestId, tabId, text }) => void (async () => {
    const tab = tabs.get(tabId);
    const outcome = !tab ? 'gone' : composer.claudeIsAsking(tab) ? 'asking' : (await composer.pasteToClaude(tab, composer.stripControls(text).trim())) ? 'sent' : 'gone';
    window.pastel.testing.agentPasted({ requestId, outcome });
  })());
  // An agent terminal came or went: the lanes follow at once, and main's loops are read now (it may be a loop new here).
  agentTerms.onAgentTabsChanged(() => { ctx.redraw(); void readLoops(); });

  // The shown task's agents: their action logs, tokens and replies, from each session's transcript or live terminal.
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
      r.replies[role] = reply.replies;
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
      tester: buildLoopBrief({ focus, rounds, stages: suite.stages, stack: ctx.stack(), taskId: task.id, agent: true, names, sources: { notes: task.notes, prd: ctx.prd() }, review, suiteDir: ctx.suiteDir(), ticket: ticketInText(task.title) }),
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

  // Start: each role's open agent gets its brief as a message (the drafting agent is reused), else main starts one.
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

  // Stop halts both, from any window: main stops the queue, then sends Esc to each and the stop message once each is idle.
  async function stop(): Promise<void> {
    const r = shownLoop();
    if (!r || r.stopping) return;
    r.stopping = true;
    ctx.say('Interrupting both agents, then asking them to stop and summarise.');
    ctx.redraw();
    const reply = await window.pastel.testing.loopStop({ root: r.root, taskId: r.taskId });
    r.stopping = false;
    ctx.say(isIpcError(reply) ? `Couldn’t stop the loop: ${reply.error}` : 'note' in reply ? reply.note : 'Asked both agents to stop. Their summaries show in their lanes.');
    await tick();
    ctx.redraw();
  }

  // Close agents shows once the loop is over or both agents are idle, while one of them is still open.
  function closeModel(status: LoopStatus, lanes: readonly LaneModel[]): AgentsModel['close'] {
    const r = record();
    const agents = r ? [r.tester, r.fixer].filter((a): a is AgentView => a !== null && a.state !== 'closed') : [];
    if (!r || !agents.length) return null;
    const over = Boolean(r.stoppedAt) || r.kind === 'draft' || status === 'done' || status === 'stopped';
    if (!over && lanes.some((l) => l.busy)) return null;
    return { count: agents.length, asking: closeAsking, closing };
  }

  // Main closes each agent's claude, its terminal and its record, and marks the loop stopped.
  async function closeAgents(): Promise<void> {
    const r = record();
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
  // It shows in the lane at once, Working…, and comes back to the box if main refuses it.
  async function send(role: AgentRole, text: string): Promise<void> {
    const r = record();
    const agent = r ? agentOf(r, role) : null;
    const route = routeMessage(agent, text);
    if ('note' in route || !r) { notes[role] = 'note' in route ? route.note : ''; draw(); return; }
    const message = { text: text.trim(), at: Date.now() };
    const forget = (): void => { pending.set(route.sessionId, (pending.get(route.sessionId) ?? []).filter((m) => m !== message)); };
    pending.set(route.sessionId, [...(pending.get(route.sessionId) ?? []), message]);
    drafts[role] = '';
    notes[role] = '';
    (document.activeElement as HTMLElement | null)?.blur();
    draw();
    const reply = await window.pastel.testing.agentSend({ root: r.root, sessionId: route.sessionId, text });
    if (isIpcError(reply) || 'note' in reply) { forget(); drafts[role] = text; }
    notes[role] = isIpcError(reply) ? `Couldn’t send it: ${reply.error}` : 'note' in reply ? reply.note : sentNote(nameOf(role), reply.outcome);
    await tick();
    draw();
  }

  // An open thread's card from the loop panel: a question to the testing agent, through main like her lane messages.
  async function askTester(prompt: string): Promise<string> {
    const r = shownLoop();
    const route = routeMessage(r?.tester ?? null, prompt);
    if ('note' in route || !r) return 'note' in route ? route.note : '';
    const reply = await window.pastel.testing.agentSend({ root: r.root, sessionId: route.sessionId, text: prompt });
    return isIpcError(reply) ? `Couldn’t send it: ${reply.error}` : 'note' in reply ? reply.note : sentNote(nameOf('tester'), reply.outcome);
  }

  // ---- The lane's terminal: mounted in the lane on Terminal, resumed first when no claude runs it.
  const boxOf = (sessionId: string): HTMLDivElement => {
    let box = termBoxes.get(sessionId);
    if (!box) {
      box = document.createElement('div');
      box.className = 'tst-agent-term';
      termBoxes.set(sessionId, box);
    }
    return box;
  };

  function toggleTerminal(role: AgentRole): void {
    const r = record();
    const agent = r ? agentOf(r, role) : null;
    if (!agent) return;
    if (!termWanted.delete(agent.sessionId)) termWanted.add(agent.sessionId);
    draw();
  }

  function showTerminal(role: AgentRole): void {
    const r = record();
    const agent = r ? agentOf(r, role) : null;
    if (!agent) return;
    termWanted.add(agent.sessionId);
    draw();
    element.querySelector(`.tst-agent-lane.is-${role}`)?.scrollIntoView({ block: 'nearest' });
  }

  // Pop out: the terminal joins the tab bar as a normal tab and is shown there.
  function popOut(role: AgentRole): void {
    const r = record();
    const agent = r ? agentOf(r, role) : null;
    if (!agent?.hostTabId) return;
    termWanted.delete(agent.sessionId);
    mounted.delete(agent.sessionId);
    agentTerms.popOut(agent.hostTabId);
    notes[role] = `${nameOf(role)}’s terminal is in the tab bar now.`;
    ctx.redraw();
  }

  // Back to lane: the popped-out terminal leaves the tab bar and shows in its lane; main counts it as an agent terminal again.
  function popIn(role: AgentRole): void {
    const r = record();
    const agent = r ? agentOf(r, role) : null;
    if (!r || !agent?.hostTabId) return;
    if (!agentTerms.popIn(agent.hostTabId)) {
      notes[role] = `${nameOf(role)}’s terminal is your only tab, so it stays in the tab bar.`;
      draw();
      return;
    }
    delete notes[role];
    termWanted.add(agent.sessionId);
    void window.pastel.testing.agentOpen({ root: r.root, sessionId: agent.sessionId });
    draw();
  }

  function showTab(role: AgentRole): void {
    const r = record();
    const id = r ? agentOf(r, role)?.hostTabId : null;
    if (id) agentTerms.showTab(id);
  }

  // Open terminal on an agent no claude runs: main resumes its session here with no message.
  async function resumeForTerminal(role: AgentRole, r: AgentLoop, agent: AgentView): Promise<void> {
    resumeAsked.add(agent.sessionId);
    const reply = await window.pastel.testing.agentOpen({ root: r.root, sessionId: agent.sessionId });
    const problem = isIpcError(reply) ? reply.error : 'note' in reply ? reply.note : null;
    notes[role] = problem ? `Couldn’t resume ${nameOf(role)}’s session. ${problem}` : `Resuming ${nameOf(role)}’s session. Its terminal shows here once it’s up.`;
    if (problem) termWanted.delete(agent.sessionId);
    await tick();
    draw();
  }

  // After each draw: every lane's box holds the terminal she asked for, and nothing else.
  function syncTerminals(r: AgentLoop | null): void {
    const shown = new Map<string, { role: AgentRole; agent: AgentView }>();
    for (const role of ROLES) { const agent = r ? agentOf(r, role) : null; if (agent) shown.set(agent.sessionId, { role, agent }); }
    for (const [sessionId, tabId] of [...mounted]) {
      if (shown.has(sessionId)) continue;
      agentTerms.unmountAgent(tabId); // another task's lane, now hidden
      mounted.delete(sessionId);
    }
    for (const [sessionId, { role, agent }] of shown) {
      const terminal = terminalOf(agent);
      const was = mounted.get(sessionId);
      if (was && !tabs.get(was)) termWanted.delete(sessionId); // its terminal closed: Terminal resumes it on her next click
      if (terminal !== 'resume') resumeAsked.delete(sessionId);
      const step = mountStep(termWanted.has(sessionId), terminal, agent.hostTabId, mounted.get(sessionId) ?? null);
      if (step.unmount) { agentTerms.unmountAgent(step.unmount); mounted.delete(sessionId); }
      if (step.mount && agentTerms.mountAgent(step.mount, boxOf(sessionId))) mounted.set(sessionId, step.mount);
      if (step.resume && r && !resumeAsked.has(sessionId)) void resumeForTerminal(role, r, agent);
    }
  }

  // The lane's turns: the transcript's, then her messages still waiting for a reply.
  function laneTurns(r: AgentLoop, role: AgentRole, agent: AgentView): ChatTurn[] {
    const turns = chatTurns(repliesOf(r, role), r.startedAt);
    const waiting = (pending.get(agent.sessionId) ?? []).filter((m) => !isAnswered(m, turns, agent.state === 'working'));
    pending.set(agent.sessionId, waiting);
    return withPending(turns, waiting);
  }

  function laneModel(role: AgentRole, r: AgentLoop | null, progress: LoopProgress | null): LaneModel {
    const agent = r ? agentOf(r, role) : null;
    const status = laneStatus(role, r, progress);
    const terminal = terminalOf(agent);
    const termOpen = Boolean(agent && termWanted.has(agent.sessionId) && terminal !== 'none' && terminal !== 'tab-bar');
    return {
      role, name: nameOf(role), started: Boolean(agent), state: agent?.state ?? null, status, busy: Boolean(r && !r.stoppedAt && agent?.state === 'working'), needsYou: status === NEEDS_YOU,
      canSend: canMessage(agent), placeholder: chatPlaceholder(nameOf(role), agent?.state ?? null),
      terminal, termOpen, termBox: agent && termOpen ? boxOf(agent.sessionId) : null, terminalNote: terminalNote(terminal), agentNote: agent?.note ?? null,
      tokens: agent && r?.tokens[role] ? { total: totalTokens(r.tokens[role]), cached: cachedTokens(r.tokens[role]) } : null, actions: agent ? r?.actions[role] ?? [] : [], events: agent ? r?.events[role] ?? [] : [],
      turns: r && agent ? laneTurns(r, role, agent) : [], startedAt: r?.startedAt ?? 0, note: notes[role] ?? '',
    };
  }

  function draw(): void {
    const typing = element.contains(document.activeElement) && (renaming !== null || document.activeElement instanceof HTMLTextAreaElement);
    if (typing) return; // her typing survives the refresh
    const task = ctx.task();
    const r = record();
    element.hidden = !task || (!ctx.suite() && !r); // a draft's lane shows before the suite exists
    if (element.hidden) { syncTerminals(null); return; }
    const { progress, status } = facts();
    const roles = ctx.suite() || r?.kind === 'loop' ? ROLES : ROLES.filter((role) => r && agentOf(r, role));
    const lanes = roles.map((role) => laneModel(role, r, progress));
    const loop = r?.kind === 'loop' ? r : null;
    const round = loop ? roundTokens(loop.actions.tester, loop.actions.fixer, loop.startedAt) : null;
    const started = lanes.filter((l) => l.started);
    const sum = (pick: (t: { total: number; cached: number }) => number) => started.reduce((n, l) => n + (l.tokens ? pick(l.tokens) : 0), 0);
    const restoreScroll = keepTurnsScroll(element);
    element.replaceChildren(agentsPanel({
      lanes, queue: loop?.queue ?? null, estimate: estimate(status), round: round ? { label: roundLabel(round), tokens: round.tokens, cached: round.cached } : null,
      total: started.length ? { total: sum((t) => t.total), cached: sum((t) => t.cached) } : null, renaming, logOpen, logShown, view, drafts,
      close: closeModel(status, lanes),
    }, {
      rename: (role) => { renaming = role; draw(); },
      saveName: (role, name) => void saveName(role, name),
      toggleTerminal,
      showTerminal,
      popOut,
      popIn,
      showTab,
      toggleLog: (role) => { if (!logOpen.delete(role)) logOpen.add(role); draw(); },
      showOlder: (role) => { logShown[role] = (logShown[role] ?? 20) + 20; draw(); },
      setView: (role, next) => { view[role] = next; if (next === 'actions') logOpen.add(role); draw(); },
      draft: (role, text) => { drafts[role] = text; },
      send: (role, text) => void send(role, text),
      askClose: (asking) => { closeAsking = asking; draw(); },
      close: () => void closeAgents(),
    }));
    restoreScroll();
    syncTerminals(r);
  }

  async function saveName(role: AgentRole, name: string): Promise<void> {
    const from = ctx.tabId();
    if (!from) return;
    const reply = await window.pastel.testing.setAgentName({ tabId: from, root: ctx.picked(), role, name });
    if (isIpcError(reply) || 'note' in reply) { ctx.say(isIpcError(reply) ? reply.error : reply.note); return; }
    renaming = null;
    await ctx.renamed();
  }

  // For the snapshot harness: what the shown task's lanes say and hold.
  const state = () => {
    const r = record();
    const progress = facts().progress;
    return {
      kind: r?.kind ?? null, draft: draft(), awaiting: awaiting().map((s) => s.name), approved: r?.approvedScenarios ?? null, queue: r?.queue ?? [], events: r ? r.events : noEvents(), renaming, notes: { ...notes },
      lanes: ROLES.map((role) => {
        const lane = laneModel(role, r, progress);
        const agent = r ? agentOf(r, role) : null;
        return { role, name: lane.name, status: lane.status, state: lane.state, sessionId: agent?.sessionId ?? null, hostTabId: agent?.hostTabId ?? null, terminal: lane.terminal, mounted: agent ? mounted.get(agent.sessionId) ?? null : null, canSend: lane.canSend, placeholder: lane.placeholder, turns: lane.turns.length, lastTurn: lane.turns.at(-1) ?? null };
      }),
    };
  };

  const testerHost = (): string | null => facts().record?.tester?.hostTabId ?? null;

  const testerNote = (): string => notes.tester ?? '';
  return { element, facts, refreshLogs, adoptAll, start, stop, sendToFixer, draw, testerHost, testerReplies: () => repliesOf(shownLoop(), 'tester'), draft, awaiting, editScenarios, approveScenarios, testerNote, askAgain, askTester, checkDraft, showTerminal, state };
}

export type Agents = ReturnType<typeof createAgents>;

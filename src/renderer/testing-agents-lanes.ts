// The lanes panel: each agent's lane model, the Close agents control, renaming, and the draw that ties them to the view.
import { isIpcError } from './dom';
import { agentsPanel, keepTurnsScroll, type AgentsModel, type LaneModel } from './testing-agents-view';
import type { AgentLoop } from './testing-agents-loops';
import type { AgentContext, LaneNotes, Shown } from './testing-agents-shown';
import { terminalOf, type Terminals } from './testing-agents-terminals';
import type { Chat } from './testing-agents-chat';
import { phaseWord, type LoopProgress } from '../shared/loop-line';
import type { LoopStatus } from '../shared/test-loop';
import { laneWord, NEEDS_YOU } from '../shared/loop-signals';
import { ROLES, agentOf, noEvents, roundLabel, roundTokens } from '../shared/agent-loop';
import type { AgentRole } from '../shared/agent-names';
import { cachedTokens, totalTokens, type RoundEstimate } from '../shared/token-usage';
import { canMessage, chatPlaceholder, terminalNote } from '../shared/agent-chat';
import type { AgentView } from '../shared/testing';

export interface LaneParts {
  element: HTMLElement;
  notes: LaneNotes;
  terminals: Terminals;
  chat: Chat;
  draft: () => { ended: boolean } | null;
  estimate: (status: LoopStatus) => RoundEstimate | null;
  tick: () => Promise<void>;
}

export function createLanes(ctx: AgentContext, shown: Shown, { element, notes, terminals, chat, draft, estimate, tick }: LaneParts) {
  let renaming: AgentRole | null = null;
  const logOpen = new Set<AgentRole>();
  const logShown: Partial<Record<AgentRole, number>> = {};
  const view: Partial<Record<AgentRole, 'chat' | 'actions'>> = {};
  let closeAsking = false;
  let closing = false;
  const { nameOf } = shown;

  function laneStatus(role: AgentRole, r: AgentLoop | null, progress: LoopProgress | null): string {
    const agent = r ? agentOf(r, role) : null;
    return laneWord({
      role, kind: r?.kind ?? 'loop', state: agent?.state ?? null, stopped: Boolean(r?.stoppedAt),
      testerLine: progress ? `${phaseWord(progress.phase)} · round ${progress.round}/${progress.total}` : null, fixing: r?.queue.find((b) => b.state === 'fixing')?.name ?? null, draftEnded: r?.kind === 'draft' && Boolean(draft()?.ended),
      scenariosReady: role === 'tester' && shown.awaiting().length > 0,
    });
  }

  function laneModel(role: AgentRole, r: AgentLoop | null, progress: LoopProgress | null): LaneModel {
    const agent = r ? agentOf(r, role) : null;
    const status = laneStatus(role, r, progress);
    const terminal = terminalOf(agent);
    const termOpen = Boolean(agent && terminals.isWanted(agent.sessionId) && terminal !== 'none' && terminal !== 'tab-bar');
    return {
      role, name: nameOf(role), started: Boolean(agent), state: agent?.state ?? null, status, busy: Boolean(r && !r.stoppedAt && agent?.state === 'working'), needsYou: status === NEEDS_YOU,
      canSend: canMessage(agent), placeholder: chatPlaceholder(nameOf(role), agent?.state ?? null),
      terminal, termOpen, termBox: agent && termOpen ? terminals.boxOf(agent.sessionId) : null, terminalNote: terminalNote(terminal), agentNote: agent?.note ?? null,
      tokens: agent && r?.tokens[role] ? { total: totalTokens(r.tokens[role]), cached: cachedTokens(r.tokens[role]) } : null, actions: agent ? r?.actions[role] ?? [] : [], events: agent ? r?.events[role] ?? [] : [],
      turns: r && agent ? chat.turns(r, role, agent) : [], startedAt: r?.startedAt ?? 0, note: notes[role] ?? '',
    };
  }

  // Close agents shows once the loop is over or both agents are idle, while one of them is still open.
  function closeModel(status: LoopStatus, lanes: readonly LaneModel[]): AgentsModel['close'] {
    const r = shown.record();
    const agents = r ? [r.tester, r.fixer].filter((a): a is AgentView => a !== null && a.state !== 'closed') : [];
    if (!r || !agents.length) return null;
    const over = Boolean(r.stoppedAt) || r.kind === 'draft' || status === 'done' || status === 'stopped';
    if (!over && lanes.some((l) => l.busy)) return null;
    return { count: agents.length, asking: closeAsking, closing };
  }

  // Main closes each agent's claude, its terminal and its record, and marks the loop stopped.
  async function closeAgents(): Promise<void> {
    const r = shown.record();
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

  async function saveName(role: AgentRole, name: string): Promise<void> {
    const from = ctx.tabId();
    if (!from) return;
    const reply = await window.pastel.testing.setAgentName({ tabId: from, root: ctx.picked(), role, name });
    if (isIpcError(reply) || 'note' in reply) { ctx.say(isIpcError(reply) ? reply.error : reply.note); return; }
    renaming = null;
    await ctx.renamed();
  }

  function draw(): void {
    const typing = element.contains(document.activeElement) && (renaming !== null || document.activeElement instanceof HTMLTextAreaElement);
    if (typing) return; // her typing survives the refresh
    const task = ctx.task();
    const r = shown.record();
    element.hidden = !task || (!ctx.suite() && !r); // a draft's lane shows before the suite exists
    if (element.hidden) { terminals.sync(null); return; }
    const { progress, status } = shown.facts();
    const roles = ctx.suite() || r?.kind === 'loop' ? ROLES : ROLES.filter((role) => r && agentOf(r, role));
    const lanes = roles.map((role) => laneModel(role, r, progress));
    const loop = r?.kind === 'loop' ? r : null;
    const round = loop ? roundTokens(loop.actions.tester, loop.actions.fixer, loop.startedAt) : null;
    const started = lanes.filter((l) => l.started);
    const sum = (pick: (t: { total: number; cached: number }) => number) => started.reduce((n, l) => n + (l.tokens ? pick(l.tokens) : 0), 0);
    const restoreScroll = keepTurnsScroll(element);
    element.replaceChildren(agentsPanel({
      lanes, queue: loop?.queue ?? null, estimate: estimate(status), round: round ? { label: roundLabel(round), tokens: round.tokens, cached: round.cached } : null,
      total: started.length ? { total: sum((t) => t.total), cached: sum((t) => t.cached) } : null, renaming, logOpen, logShown, view, drafts: chat.drafts,
      close: closeModel(status, lanes),
    }, {
      rename: (role) => { renaming = role; draw(); },
      saveName: (role, name) => void saveName(role, name),
      toggleTerminal: terminals.toggleTerminal,
      showTerminal: terminals.showTerminal,
      popOut: terminals.popOut,
      popIn: terminals.popIn,
      showTab: terminals.showTab,
      toggleLog: (role) => { if (!logOpen.delete(role)) logOpen.add(role); draw(); },
      showOlder: (role) => { logShown[role] = (logShown[role] ?? 20) + 20; draw(); },
      setView: (role, next) => { view[role] = next; if (next === 'actions') logOpen.add(role); draw(); },
      draft: (role, text) => { chat.drafts[role] = text; },
      send: (role, text) => void chat.send(role, text),
      askClose: (asking) => { closeAsking = asking; draw(); },
      close: () => void closeAgents(),
    }));
    restoreScroll();
    terminals.sync(r);
  }

  // For the snapshot harness: what the shown task's lanes say and hold.
  const state = () => {
    const r = shown.record();
    const progress = shown.facts().progress;
    return {
      kind: r?.kind ?? null, draft: draft(), awaiting: shown.awaiting().map((s) => s.name), approved: r?.approvedScenarios ?? null, queue: r?.queue ?? [], events: r ? r.events : noEvents(), renaming, notes: { ...notes },
      lanes: ROLES.map((role) => {
        const lane = laneModel(role, r, progress);
        const agent = r ? agentOf(r, role) : null;
        return { role, name: lane.name, status: lane.status, state: lane.state, sessionId: agent?.sessionId ?? null, hostTabId: agent?.hostTabId ?? null, terminal: lane.terminal, mounted: agent ? terminals.mountedTab(agent.sessionId) : null, canSend: lane.canSend, placeholder: lane.placeholder, turns: lane.turns.length, lastTurn: lane.turns.at(-1) ?? null };
      }),
    };
  };

  return { draw, state };
}

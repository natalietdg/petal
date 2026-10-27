// The lane's terminal: mounted in the lane on Terminal, resumed first when no claude runs it, or popped out to the tab bar.
import * as tabs from './tabs';
import * as agentTerms from './agent-terms';
import { isIpcError } from './dom';
import type { AgentLoop } from './testing-agents-loops';
import type { AgentContext, LaneNotes, Shown } from './testing-agents-shown';
import { ROLES, agentOf } from '../shared/agent-loop';
import type { AgentRole } from '../shared/agent-names';
import { laneTerminal, mountStep, type LaneTerminal } from '../shared/agent-chat';
import type { AgentView } from '../shared/testing';

export interface TerminalHooks {
  element: HTMLElement; // the lanes' panel, scrolled to a shown lane
  notes: LaneNotes;
  draw: () => void;
  tick: () => Promise<void>;
}

const poppedOut = (agent: AgentView | null): boolean => Boolean(agent?.hostTabId && !agentTerms.isAgent(agent.hostTabId));
export const terminalOf = (agent: AgentView | null): LaneTerminal => laneTerminal(agent, poppedOut(agent));

export function createTerminals(ctx: AgentContext, shown: Shown, { element, notes, draw, tick }: TerminalHooks) {
  // By agent session: the terminals she asked to see, the box each mounts in, and what is in it.
  const termWanted = new Set<string>();
  const termBoxes = new Map<string, HTMLDivElement>();
  const mounted = new Map<string, string>(); // sessionId -> the agent terminal's tab id in its box
  const resumeAsked = new Set<string>(); // sessions Open terminal already asked main to resume
  const { nameOf } = shown;
  const shownAgent = (role: AgentRole): AgentView | null => { const r = shown.record(); return r ? agentOf(r, role) : null; };

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
    const agent = shownAgent(role);
    if (!agent) return;
    if (!termWanted.delete(agent.sessionId)) termWanted.add(agent.sessionId);
    draw();
  }

  function showTerminal(role: AgentRole): void {
    const agent = shownAgent(role);
    if (!agent) return;
    termWanted.add(agent.sessionId);
    draw();
    element.querySelector(`.tst-agent-lane.is-${role}`)?.scrollIntoView({ block: 'nearest' });
  }

  // Pop out: the terminal joins the tab bar as a normal tab and is shown there.
  function popOut(role: AgentRole): void {
    const agent = shownAgent(role);
    if (!agent?.hostTabId) return;
    termWanted.delete(agent.sessionId);
    mounted.delete(agent.sessionId);
    agentTerms.popOut(agent.hostTabId);
    notes[role] = `${nameOf(role)}’s terminal is in the tab bar now.`;
    ctx.redraw();
  }

  // Back to lane: the popped-out terminal leaves the tab bar and shows in its lane; main counts it as an agent terminal again.
  function popIn(role: AgentRole): void {
    const r = shown.record();
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
    const id = shownAgent(role)?.hostTabId;
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
  function sync(r: AgentLoop | null): void {
    const lanes = new Map<string, { role: AgentRole; agent: AgentView }>();
    for (const role of ROLES) { const agent = r ? agentOf(r, role) : null; if (agent) lanes.set(agent.sessionId, { role, agent }); }
    for (const [sessionId, tabId] of [...mounted]) {
      if (lanes.has(sessionId)) continue;
      agentTerms.unmountAgent(tabId); // another task's lane, now hidden
      mounted.delete(sessionId);
    }
    for (const [sessionId, { role, agent }] of lanes) {
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

  return {
    boxOf, sync, toggleTerminal, showTerminal, popOut, popIn, showTab,
    want: (sessionId: string): void => { termWanted.add(sessionId); },
    isWanted: (sessionId: string): boolean => termWanted.has(sessionId),
    mountedTab: (sessionId: string): string | null => mounted.get(sessionId) ?? null,
  };
}

export type Terminals = ReturnType<typeof createTerminals>;

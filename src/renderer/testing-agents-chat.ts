// Her lane messages: the draft in each chat box, sending through main, and the turns each lane shows.
import { isIpcError } from './dom';
import type { AgentLoop } from './testing-agents-loops';
import type { LaneNotes, Shown } from './testing-agents-shown';
import { agentOf } from '../shared/agent-loop';
import type { AgentRole } from '../shared/agent-names';
import { chatTurns, isAnswered, routeMessage, sentNote, withPending, type ChatTurn, type PendingMessage } from '../shared/agent-chat';
import type { AgentView } from '../shared/testing';

export interface ChatHooks {
  notes: LaneNotes;
  draw: () => void;
  tick: () => Promise<void>;
}

export function createChat(shown: Shown, { notes, draw, tick }: ChatHooks) {
  const drafts: Partial<Record<AgentRole, string>> = {};
  const pending = new Map<string, PendingMessage[]>(); // sessionId -> her lane messages no reply has answered yet

  // Her message to one agent, through main: pasted when its claude is ready, resumed first when none runs it.
  // It shows in the lane at once, Working…, and comes back to the box if main refuses it.
  async function send(role: AgentRole, text: string): Promise<void> {
    const r = shown.record();
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
    notes[role] = isIpcError(reply) ? `Couldn’t send it: ${reply.error}` : 'note' in reply ? reply.note : sentNote(shown.nameOf(role), reply.outcome);
    await tick();
    draw();
  }

  // The lane's turns: the transcript's, then her messages still waiting for a reply.
  function turns(r: AgentLoop, role: AgentRole, agent: AgentView): ChatTurn[] {
    const transcript = chatTurns(shown.repliesOf(r, role), r.startedAt);
    const waiting = (pending.get(agent.sessionId) ?? []).filter((m) => !isAnswered(m, transcript, agent.state === 'working'));
    pending.set(agent.sessionId, waiting);
    return withPending(transcript, waiting);
  }

  return { drafts, send, turns };
}

export type Chat = ReturnType<typeof createChat>;

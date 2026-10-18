// Chatting with a task's agents from the Testing view: which session a message goes to, and the turns a lane shows. Pure.
import type { AgentRole } from './agent-names';
import type { Reply } from './types';

export const ASKING_NOTE = 'Claude is asking something in the terminal. Answer it there first, then send.';
export const CHAT_TURNS = 4;

export type ChatRoute = { sessionId: string } | { note: string };

// The role's own session; never the other agent's, never while that agent is asking something.
export function routeMessage(role: AgentRole, agents: Record<AgentRole, { sessionId: string }> | null, isAsking: (sessionId: string) => boolean, text: string): ChatRoute {
  if (!text.trim()) return { note: 'Type a message first.' };
  const agent = agents?.[role];
  if (!agent) return { note: 'Start the loop first. Each agent gets its own tab.' };
  if (isAsking(agent.sessionId)) return { note: ASKING_NOTE };
  return { sessionId: agent.sessionId };
}

export interface ChatTurn { id: string; prompt: string; markdown: string; at: number }

// The last few turns, oldest first: her message (or Petal's handoff) and the agent's reply.
export function chatTurns(replies: readonly Reply[], since = 0, count = CHAT_TURNS): ChatTurn[] {
  const turns = replies
    .map((r, i) => ({ id: r.id ?? `turn-${i}`, prompt: r.prompt, markdown: r.markdown, at: Date.parse(r.timestamp ?? '') || 0 }))
    .filter((t) => !since || !t.at || t.at >= since)
    .sort((a, b) => a.at - b.at);
  return turns.slice(-count);
}

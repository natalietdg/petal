// Chatting with a task's agents from the Testing view: which session a message goes to, how it gets there, and the turns
// a lane shows. Pure.
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

export const REOPEN_MS = 60_000; // a reopened session with no tab by then didn't come back

// An agent's tab: an open tab whose Claude reports the agent's session, a live one first. Never the tab id saved when it
// started: ids restart each launch, so after a restart that id can name an unrelated tab.
export function agentTab(agent: { sessionId: string } | null | undefined, open: readonly { id: string; sessionId: string | null; live: boolean }[]): string | null {
  if (!agent) return null;
  const matches = open.filter((t) => t.sessionId === agent.sessionId);
  return (matches.find((t) => t.live) ?? matches[0])?.id ?? null;
}

// How her message reaches an agent: its open tab; else its saved session, reopened in a new tab; nothing before it
// started. starting: it was just started and its Claude hasn't reported its session yet, so it isn't reopened.
export type LaneReach = 'tab' | 'starting' | 'reopen' | 'reopening' | 'none';
export function laneReach(agent: { sessionId: string } | null, tabId: string | null, reopenedAt: number | null, now: number, starting = false): LaneReach {
  if (tabId) return 'tab';
  if (!agent?.sessionId) return 'none';
  if (reopenedAt !== null && now - reopenedAt < REOPEN_MS) return 'reopening';
  return starting ? 'starting' : 'reopen';
}

export const chatPlaceholder = (name: string, reach: LaneReach): string =>
  reach === 'reopen' ? `Message ${name}. Reopens its session` : reach === 'reopening' ? `Reopening ${name}’s session…` : reach === 'starting' ? `${name} is starting…` : `Message ${name}`;

// The lane's note after asking to reopen: on its way, or why not in plain words.
export function reopenNote(name: string, problem: string | null, withMessage: boolean): string {
  if (problem) return `Couldn’t reopen ${name}’s session. ${problem}`;
  return withMessage ? `Reopening ${name}’s session in a new tab. Your message goes once it’s ready.` : `Reopening ${name}’s session in a new tab.`;
}
export const reopenStalledNote = (name: string): string => `Couldn’t reopen ${name}’s session. Its tab never picked it up. Try Open tab again.`;

export interface ChatTurn { id: string; prompt: string; markdown: string; at: number }

// The last few turns, oldest first: her message (or Petal's handoff) and the agent's reply.
export function chatTurns(replies: readonly Reply[], since = 0, count = CHAT_TURNS): ChatTurn[] {
  const turns = replies
    .map((r, i) => ({ id: r.id ?? `turn-${i}`, prompt: r.prompt, markdown: r.markdown, at: Date.parse(r.timestamp ?? '') || 0 }))
    .filter((t) => !since || !t.at || t.at >= since)
    .sort((a, b) => a.at - b.at);
  return turns.slice(-count);
}

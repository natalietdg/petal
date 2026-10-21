// Chatting with a task's agents from the Testing view: whether a message can go, what the lane's box and terminal
// say, and the turns a lane shows. Main owns the agents and finds each only by its session id. Pure.
import type { AgentSendOutcome } from './ipc';
import type { AgentState } from './testing';
import type { Reply } from './types';

export const ASKING_NOTE = 'Claude is asking something in the terminal. Answer it there first, then send.';
export const CLOSED_NOTE = 'That agent was closed. Start a new one.';
export const CHAT_TURNS = 4;

interface LaneAgent { sessionId: string; state: AgentState }

export type ChatRoute = { sessionId: string } | { note: string };

// The agent's own session, whatever runs it now: main resumes an ended one. Never while it is asking her something.
export function routeMessage(agent: LaneAgent | null, text: string): ChatRoute {
  if (!text.trim()) return { note: 'Type a message first.' };
  if (!agent) return { note: 'Start the loop first.' };
  if (agent.state === 'closed') return { note: CLOSED_NOTE };
  if (agent.state === 'asking') return { note: ASKING_NOTE };
  return { sessionId: agent.sessionId };
}

// The box stays on for every agent Petal started and hasn't closed, ended ones included.
export const canMessage = (agent: Pick<LaneAgent, 'state'> | null): boolean => Boolean(agent && agent.state !== 'closed');

export function chatPlaceholder(name: string, state: AgentState | null): string {
  if (!state) return `Start the loop to chat with ${name}`;
  if (state === 'closed') return `${name} is closed`;
  if (state === 'ended') return `Message ${name}. Resumes its session`;
  if (state === 'starting') return `Message ${name}. It goes once ${name} is ready`;
  if (state === 'asking') return `${name} is asking something in its terminal`;
  return `Message ${name}`;
}

// The lane's note once main took her message.
export function sentNote(name: string, outcome: AgentSendOutcome): string {
  if (outcome === 'sent') return `Sent to ${name}.`;
  if (outcome === 'resuming') return `Resuming ${name}’s session. Your message goes once it’s ready.`;
  return `${name} gets it once it’s ready.`;
}

// Where the lane's terminal is. here: an agent terminal in this window, mountable in the lane. tab-bar: popped out
// here. elsewhere: another window runs it. resume: no claude runs it, so showing it resumes it. none: closed or never started.
export type LaneTerminal = 'here' | 'tab-bar' | 'elsewhere' | 'resume' | 'none';
export interface LaneHost { state: AgentState; hostTabId: string | null; hostElsewhere: boolean }

export function laneTerminal(agent: LaneHost | null, poppedOut: boolean): LaneTerminal {
  if (!agent || agent.state === 'closed') return 'none';
  if (agent.hostTabId) return poppedOut ? 'tab-bar' : 'here';
  return agent.hostElsewhere ? 'elsewhere' : 'resume';
}

export function terminalNote(terminal: LaneTerminal): string | null {
  if (terminal === 'elsewhere') return 'Its terminal is open in another Petal window. Messages still reach it.';
  if (terminal === 'tab-bar') return 'Its terminal is in the tab bar.';
  return null;
}

// What the lane does to its terminal now: take one out, put one in, or ask main to resume the agent first.
export interface MountStep { unmount: string | null; mount: string | null; resume: boolean }
export function mountStep(wanted: boolean, terminal: LaneTerminal, hostTabId: string | null, mounted: string | null): MountStep {
  const target = wanted && terminal === 'here' ? hostTabId : null;
  return { unmount: mounted && mounted !== target ? mounted : null, mount: target && target !== mounted ? target : null, resume: wanted && terminal === 'resume' };
}

export interface ChatTurn { id: string; prompt: string; markdown: string; at: number; working?: boolean }

// The last few turns, oldest first: her message (or Petal's handoff) and the agent's reply. Read from its transcript
// when no claude runs it, so a lane is never blank after a restart.
export function chatTurns(replies: readonly Reply[], since = 0, count = CHAT_TURNS): ChatTurn[] {
  const turns = replies
    .map((r, i) => ({ id: r.id ?? `turn-${i}`, prompt: r.prompt, markdown: r.markdown, at: Date.parse(r.timestamp ?? '') || 0 }))
    .filter((t) => !since || !t.at || t.at >= since)
    .sort((a, b) => a.at - b.at);
  return turns.slice(-count);
}

// A message she sent from the lane that no reply has answered yet.
export interface PendingMessage { text: string; at: number }

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim();

// Answered: a reply since she sent it quotes her text, or (Claude reworded a paste) one landed and the agent is idle.
export function isAnswered(message: PendingMessage, turns: readonly ChatTurn[], working: boolean): boolean {
  const text = squash(message.text);
  return turns.some((t) => t.at >= message.at && (!working || squash(t.prompt).includes(text)));
}

// Her unanswered messages show at once after the turns, each as a Working… turn, so a sent message is never invisible.
export function withPending(turns: readonly ChatTurn[], pending: readonly PendingMessage[], count = CHAT_TURNS): ChatTurn[] {
  const waiting = pending.map((m) => ({ id: `pending-${m.at}`, prompt: m.text, markdown: '', at: m.at, working: true }));
  return [...turns, ...waiting].slice(-count);
}

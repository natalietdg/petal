// A headless `claude -p` child session, listed with its parent's agents and rolled up into its card.
import type { ScreenAsk } from './prompt-answer';
import type { ChildSignal } from './needs-you';
import { agentsBadgeText } from './ipc';

export type ChildStatus = 'running' | 'stalled' | 'finished';

export interface ChildRow {
  sessionId: string;
  name: string;
  status: ChildStatus;
  ask: ScreenAsk | null; // stopped on a question for her
  askSince: number | null;
  updatedAt: number;
  step: string;
}

// The agent id a child goes by in the agents panel; main maps it back to the child's transcript.
export const HEADLESS_PREFIX = 'headless-';
export const childAgentId = (sessionId: string): string => `${HEADLESS_PREFIX}${sessionId}`;
export const childIdOf = (agentId: string): string | null => (agentId.startsWith(HEADLESS_PREFIX) ? agentId.slice(HEADLESS_PREFIX.length) : null);

export const childSignals = (children: readonly ChildRow[]): ChildSignal[] =>
  children.map((c) => ({ sessionId: c.sessionId, name: c.name, ask: c.ask, since: c.askSince }));

// "3 agents · 1 waiting · 1 stalled": subagents and children together, then what needs a look.
export function agentsBadge(subagents: number, children: readonly ChildRow[]): string {
  const total = subagents + children.length;
  if (!total) return '';
  const waiting = children.filter((c) => c.ask).length;
  const stalled = children.filter((c) => !c.ask && c.status === 'stalled').length;
  return [agentsBadgeText(total), waiting ? `${waiting} waiting` : '', stalled ? `${stalled} stalled` : ''].filter(Boolean).join(' · ');
}

export interface HistoryNode<T> {
  session: T;
  nested: boolean; // drawn indented under the parent row above it
}

// History's order: headless runs hidden unless she shows them; shown, each sits under its parent when the parent is listed.
export function historyRows<T extends { sessionId: string; headless?: boolean; parentId: string | null }>(sessions: readonly T[], showHeadless: boolean): HistoryNode<T>[] {
  const top = sessions.filter((s) => !s.headless);
  if (!showHeadless) return top.map((session) => ({ session, nested: false }));
  const listed = new Set(top.map((s) => s.sessionId));
  const under = new Map<string, T[]>();
  const loose: T[] = []; // a run whose parent is unknown or not listed keeps its own place
  for (const s of sessions) {
    if (!s.headless) continue;
    if (s.parentId && listed.has(s.parentId)) under.set(s.parentId, [...(under.get(s.parentId) ?? []), s]);
    else loose.push(s);
  }
  const looseIds = new Set(loose.map((s) => s.sessionId));
  return sessions.flatMap((s): HistoryNode<T>[] => {
    if (looseIds.has(s.sessionId)) return [{ session: s, nested: false }];
    if (s.headless) return [];
    return [{ session: s, nested: false }, ...(under.get(s.sessionId) ?? []).map((child) => ({ session: child, nested: true }))];
  });
}

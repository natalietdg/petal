// What the Agents dropdown shows per agent, and in what order. Pure, so it is unit tested without a page.
import type { AgentSummary } from '../main/agents';

export type DotStatus = 'running' | 'stalled' | 'done';

export interface MenuRow {
  id: string;
  task: string;
  status: DotStatus;
  time: string; // "9:42 AM · 4m"
}

type Clock = (at: number) => string;
const sameDay = (a: Date, b: Date): boolean => a.toDateString() === b.toDateString();
// "9:42 AM" today; "Oct 21, 9:42 AM" for an earlier day.
const localClock: Clock = (at) => {
  const when = new Date(at);
  const time = when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return sameDay(when, new Date()) ? time : `${when.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
};

// "45s", "12m", "1h 5m".
export function elapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

export const dotStatus = (agent: Pick<AgentSummary, 'status'>): DotStatus => (agent.status === 'finished' ? 'done' : agent.status);

// A running agent's duration runs to now; a stopped one's ends at its last write.
export function duration(agent: Pick<AgentSummary, 'status' | 'startedAt' | 'updatedAt'>, now: number): string {
  return elapsed((agent.status === 'running' ? now : agent.updatedAt) - agent.startedAt);
}

// Running first, then newest start first; ties keep the order they came in.
export function menuOrder<T extends Pick<AgentSummary, 'status' | 'startedAt'>>(agents: readonly T[]): T[] {
  const running = (a: T): number => (a.status === 'running' ? 0 : 1);
  return [...agents].sort((a, b) => running(a) - running(b) || b.startedAt - a.startedAt);
}

export function menuRows(agents: readonly AgentSummary[], now: number, clock: Clock = localClock): MenuRow[] {
  return menuOrder(agents).map((agent) => ({
    id: agent.id,
    task: agent.task,
    status: dotStatus(agent),
    time: `${clock(agent.startedAt)} · ${duration(agent, now)}`,
  }));
}

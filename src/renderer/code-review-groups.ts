// Which turns a reply's Code review shows: the reply's own turns, then each subagent those turns launched.
import { isAgentSource, type ReviewSource, type SessionSummary, type TurnSummary } from '../shared/code-review';

export type TurnMatch = { replyId: string | undefined } | { historyIndex: number };

export interface ReviewGroup {
  source: ReviewSource;
  heading: string | null; // null for the reply's own turns
  turnIds: string[];
  functions: number;
}

export const sourceKey = (source: ReviewSource): string => {
  if (isAgentSource(source)) return `agent:${source.sessionId}:${source.agentId}`;
  return 'tabId' in source ? `tab:${source.tabId}` : `session:${source.sessionId}`;
};

const matches = (turn: TurnSummary, match: TurnMatch): boolean => {
  if ('replyId' in match) return turn.replyId !== null && turn.replyId === match.replyId;
  return turn.historyIndex === match.historyIndex;
};

export function reviewGroups(source: ReviewSource, summary: SessionSummary | undefined, match: TurnMatch): ReviewGroup[] {
  const turns = (summary?.turns ?? []).filter((t) => matches(t, match));
  const own = turns.filter((t) => t.functions || !t.agents?.length); // a turn that only launched subagents isn't its own
  const groups: ReviewGroup[] = own.length ? [{ source, heading: null, turnIds: own.map((t) => t.turnId), functions: own.reduce((sum, t) => sum + t.functions, 0) }] : [];
  for (const agent of turns.flatMap((t) => t.agents ?? [])) {
    const agentSource = { sessionId: summary?.sessionId ?? '', agentId: agent.agentId };
    groups.push({ source: agentSource, heading: `By subagent: ${agent.description}`, turnIds: agent.turnIds, functions: agent.functions });
  }
  return groups;
}

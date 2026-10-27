// Agents with a prompt on screen in this window, across every loop and draft: main's asking state, the dock badge,
// and one notification per new prompt. Main says which terminal runs each agent here; nothing else is trusted.
import * as tabs from './tabs';
import * as composer from './composer';
import { setDockBadge } from './testing-agents-badge';
import type { AgentLoop } from './testing-agents-loops';
import { needsNotice, newlyWaiting } from '../shared/loop-signals';
import { ROLES, agentOf } from '../shared/agent-loop';
import type { AgentNames, AgentRole } from '../shared/agent-names';

type NameOf = (role: AgentRole, names?: AgentNames) => string;

// `changed` runs when the set of waiting agents changed.
export function createWaitingScan(loops: ReadonlyMap<string, AgentLoop>, nameOf: NameOf, changed: () => void): () => void {
  let waiting = new Set<string>(); // agent sessions with a prompt on screen here, at the last scan
  let askingReported = '';

  return function scanWaiting(): void {
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
      if (agent) void window.pastel.testing.notify(needsNotice(agent.name, agent.tabId));
    }
    const altered = now.size !== waiting.size || [...now.keys()].some((id) => !waiting.has(id));
    waiting = new Set(now.keys());
    if (altered) { setDockBadge(now.size); changed(); }
  };
}

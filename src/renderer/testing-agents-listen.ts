// What main and the agent terminals tell this window: clicked notifications, pastes into agents, terminals coming and going.
import * as tabs from './tabs';
import * as composer from './composer';
import * as agentTerms from './agent-terms';
import type { AgentLoop } from './testing-agents-loops';
import type { AgentContext } from './testing-agents-shown';

export interface ListenHooks {
  loops: ReadonlyMap<string, AgentLoop>;
  wantTerminal: (sessionId: string) => void;
  readLoops: () => Promise<void>;
}

export function listenToMain(ctx: AgentContext, { loops, wantTerminal, readLoops }: ListenHooks): void {
  // A clicked loop notification: a tab-bar tab is shown; an agent terminal opens in its lane.
  window.pastel.testing.onShowTab(({ tabId }) => {
    if (!tabs.get(tabId)) return;
    if (!agentTerms.isAgent(tabId)) { agentTerms.showTab(tabId); return; }
    const agent = [...loops.values()].flatMap((r) => [r.tester, r.fixer]).find((a) => a?.hostTabId === tabId);
    if (agent) wantTerminal(agent.sessionId);
    ctx.open();
  });
  // Main's handoffs and her lane messages: pasted through the reply box's path, which refuses while a prompt is on screen.
  window.pastel.testing.onAgentPaste(({ requestId, tabId, text }) => void (async () => {
    const tab = tabs.get(tabId);
    const outcome = !tab ? 'gone' : composer.claudeIsAsking(tab) ? 'asking' : (await composer.pasteToClaude(tab, composer.stripControls(text).trim())) ? 'sent' : 'gone';
    window.pastel.testing.agentPasted({ requestId, outcome });
  })());
  // An agent terminal came or went: the lanes follow at once, and main's loops are read now (it may be a loop new here).
  agentTerms.onAgentTabsChanged(() => { ctx.redraw(); void readLoops(); });
}

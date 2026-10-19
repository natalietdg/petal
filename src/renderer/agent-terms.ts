// Agent terminals as the Testing lanes use them: the tabs module's agent-terminal calls, forwarded when it has them.
// Without them (before the hostless agent tabs land) nothing mounts and Pop out shows the tab.
import * as tabs from './tabs';
import type { TabId } from '../shared/types';

interface AgentTermCalls {
  isAgent: (tabId: TabId) => boolean;
  mountAgent: (tabId: TabId, container: HTMLElement) => boolean;
  unmountAgent: (tabId: TabId) => void;
  popOut: (tabId: TabId) => void;
  onAgentTabsChanged: (callback: (ids: TabId[]) => void) => () => void;
}

const calls = tabs as unknown as Partial<AgentTermCalls>;

export const isAgent = (tabId: TabId): boolean => calls.isAgent?.(tabId) ?? false;
export const mountAgent = (tabId: TabId, container: HTMLElement): boolean => calls.mountAgent?.(tabId, container) ?? false;
export const unmountAgent = (tabId: TabId): void => calls.unmountAgent?.(tabId);
export const popOut = (tabId: TabId): void => (calls.popOut ? calls.popOut(tabId) : tabs.activate(tabId));
export const onAgentTabsChanged = (callback: (ids: TabId[]) => void): (() => void) => calls.onAgentTabsChanged?.(callback) ?? (() => {});
// A terminal in the tab bar: shown like any tab. An agent terminal can't be activated.
export const showTab = (tabId: TabId): void => { if (!isAgent(tabId)) tabs.activate(tabId); };

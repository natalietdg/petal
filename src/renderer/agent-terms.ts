// Agent terminals as the Testing lanes use them: the tabs module's agent-terminal calls.
import * as tabs from './tabs';
import type { TabId } from '../shared/types';

export const { isAgent, mountAgent, unmountAgent, popOut, popIn, onAgentTabsChanged } = tabs;
// A terminal in the tab bar: shown like any tab. An agent terminal can't be activated.
export const showTab = (tabId: TabId): void => { if (!isAgent(tabId)) tabs.activate(tabId); };

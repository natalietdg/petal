// Optional dock buttons: Library once it is on, Testing once a suite is known, Board always (rules in shared/dock-visibility.ts).
// A button whose view is open stays, so closing a tab never strands her in a view with no button.
import * as tabs from './tabs';
import { byId, isIpcError } from './dom';
import { OPTIONAL_BUTTONS, buttonShown, libraryOn, type DockFacts } from '../shared/dock-visibility';

const facts: Omit<DockFacts, 'sessions'> = { libraryOn: false, hasSuite: null };

export function sync(): void {
  const now: DockFacts = { ...facts, sessions: tabs.ids().length };
  for (const id of OPTIONAL_BUTTONS) {
    const button = byId(id);
    button.hidden = !buttonShown(id, now, button.getAttribute('aria-pressed') === 'true');
  }
}

async function readLibrary(): Promise<void> {
  const data = await window.pastel.library.list();
  facts.libraryOn = !isIpcError(data) && libraryOn(data);
  sync();
}

// Closing a view hides its button again if its rule says so.
const watcher = new MutationObserver(sync);
for (const id of OPTIONAL_BUTTONS) watcher.observe(byId(id), { attributes: true, attributeFilter: ['aria-pressed'] });
window.pastel.library.onChanged(() => void readLibrary());
// Turning Library on in Customize saves config; re-read when that view closes (a suite made by the skill shows then too).
new MutationObserver(() => { void readLibrary(); void readSuite(); }).observe(byId('customize'), { attributes: true, attributeFilter: ['hidden'] });
async function readSuite(): Promise<void> {
  const found = await window.pastel.testing.hasSuite();
  if (!isIpcError(found)) facts.hasSuite = found;
  sync();
}
// A run means the repo has a suite; a suite drafted in Testing is seen when that view closes.
window.pastel.testing.onRunUpdate(() => { facts.hasSuite = true; sync(); });
new MutationObserver(() => void readSuite()).observe(byId('testing-button'), { attributes: true, attributeFilter: ['aria-pressed'] });
void readLibrary();
void readSuite();

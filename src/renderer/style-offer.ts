// Confirmed and the status strip fill only from lines a Petal reply style asks Claude to write.
// When they're empty for that reason, this says so and offers to add the style.
import { el, isIpcError } from './dom';
import { addAndUsePetalStyle, petalStyleActive } from './customize-styles';
import { DEFAULT_PETAL_STYLE } from '../shared/petal-style-choices';

// null until the first read; false also while the Claude folder is off, since styles can't be added then.
let offerable: boolean | null = null;
const listeners = new Set<() => void>();

export async function refresh(): Promise<void> {
  const state = await window.pastel.config.get();
  const next = !isIpcError(state) && state.config.claudeFolder.choice === 'allowed' && !petalStyleActive(state);
  if (next === offerable) return;
  offerable = next;
  for (const listener of listeners) listener();
}

// True when no Petal style is on and one could be added.
export const shouldOffer = (): boolean => offerable === true;
export const onChange = (listener: () => void): void => { listeners.add(listener); };

// The cause in one line, then Add. The result line replaces the button.
export function offerLine(cause: string, className: string): HTMLElement {
  const box = el('div', `style-offer ${className}`);
  const add = el('button', 'flow-button style-offer-add', 'Add Petal style');
  add.type = 'button';
  const said = el('span', 'style-offer-result');
  said.setAttribute('aria-live', 'polite');
  add.addEventListener('click', async () => {
    add.disabled = true;
    const { ok, line } = await addAndUsePetalStyle(DEFAULT_PETAL_STYLE);
    said.textContent = ok ? `${line} New replies fill this in.` : line;
    add.hidden = ok;
    add.disabled = false;
    if (ok) void refresh();
  });
  box.append(el('span', 'style-offer-cause', cause), add, said);
  return box;
}

export const CONFIRMED_CAUSE = 'Nothing confirmed yet. Claude adds Checked and Verified lines here only with a Petal reply style, and none is on.';
export const STRIP_CAUSE = 'No Doing, Recommend or Next lines. Claude writes them only with a Petal reply style, and none is on.';

void refresh();
window.pastel.onClaudeFolder(() => void refresh());

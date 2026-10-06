// Reply box under the reader: what she types here is pasted into the active tab's Claude, as if typed there.
import * as tabs from './tabs';
import { byId, focusTerminal } from './dom';

const form = byId<HTMLFormElement>('composer');
const input = byId<HTMLTextAreaElement>('composer-input');
const MAX_ROWS = 8;
const NOT_LIVE_HINT = 'Start Claude in this tab first';
// Bracketed paste keeps multi-line replies as one message instead of sending at each newline.
const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

function fit(): void {
  input.style.height = 'auto';
  const line = parseFloat(getComputedStyle(input).lineHeight);
  input.style.height = `${Math.min(input.scrollHeight, line * MAX_ROWS + 20)}px`;
  document.documentElement.style.setProperty('--composer-height', `${form.offsetHeight}px`);
}

// Shown in place of sending when the active tab has no Claude to read the reply.
const hint = Object.assign(document.createElement('p'), { id: 'composer-hint', className: 'composer-hint', hidden: true, textContent: NOT_LIVE_HINT });
hint.setAttribute('role', 'status');
form.prepend(hint);

// C0 controls other than newline and tab could end the bracketed paste early or drive the TUI (ESC above all).
const stripControls = (text: string): string => text.replace(/[\x00-\x08\x0B-\x1F]/g, '');

function send(): void {
  const text = stripControls(input.value).trim();
  const tab = tabs.active();
  if (!text || !tab) return;
  if (tab.update?.state !== 'live') {
    hint.hidden = false;
    return;
  }
  hint.hidden = true;
  window.pastel.write(tab.id, `${PASTE_START}${text}${PASTE_END}\r`);
  input.value = '';
  fit();
}

form.addEventListener('submit', (event) => { event.preventDefault(); send(); });
input.addEventListener('input', () => {
  hint.hidden = true;
  fit();
});
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    send();
  } else if (event.key === 'Escape') {
    focusTerminal();
  }
});
new ResizeObserver(fit).observe(form);
fit();

export const focus = (): void => input.focus();

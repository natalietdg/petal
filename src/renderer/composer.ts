// Reply box under the reader: pasted into the active tab's Claude, or starts Claude with it when none is running.
import * as tabs from './tabs';
import { byId, focusTerminal } from './dom';

const form = byId<HTMLFormElement>('composer');
const input = byId<HTMLTextAreaElement>('composer-input');
const MAX_ROWS = 8;
// Bracketed paste keeps multi-line replies as one message instead of sending at each newline.
const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

function fit(): void {
  input.style.height = 'auto';
  const line = parseFloat(getComputedStyle(input).lineHeight);
  input.style.height = `${Math.min(input.scrollHeight, line * MAX_ROWS + 20)}px`;
  document.documentElement.style.setProperty('--composer-height', `${form.offsetHeight}px`);
}

// C0 controls other than newline and tab could end the bracketed paste early or drive the TUI (ESC above all).
// eslint-disable-next-line no-control-regex -- stripping C0 controls is the point
const stripControls = (text: string): string => text.replace(/[\x00-\x08\x0B-\x1F]/g, '');

function send(): void {
  const text = stripControls(input.value).trim();
  const tab = tabs.active();
  if (!text || !tab) return;
  if (tab.update?.state === 'live') window.pastel.write(tab.id, `${PASTE_START}${text}${PASTE_END}\r`);
  else window.pastel.startClaude(tab.id, text);
  input.value = '';
  fit();
}

form.addEventListener('submit', (event) => { event.preventDefault(); send(); });
input.addEventListener('input', fit);
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

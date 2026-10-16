// Board's "Message…": a small composer for one card, sent as the active session through the same mentions send.
import * as tabs from './tabs';
import * as mentions from './mentions';
import { byId, el } from './dom';
import { deliverySummary } from '../shared/mentions';

const CLOSE_AFTER_SENT_MS = 1200;

// Lives on the page, not the card, so the board's 2s re-render never drops her draft.
const popup = el('form', 'board-message');
popup.hidden = true;
popup.setAttribute('role', 'dialog');
popup.setAttribute('aria-label', 'Message a session');
const heading = el('p', 'board-message-title');
const field = el('textarea', 'board-message-input');
field.rows = 3;
field.setAttribute('aria-label', 'Message');
const status = el('p', 'board-message-status');
status.setAttribute('role', 'status');
const actions = el('div', 'board-message-actions');
const cancel = el('button', 'session-link', 'Cancel');
cancel.type = 'button';
const sendButton = el('button', 'flow-button board-message-send', 'Send');
sendButton.type = 'submit';
actions.append(cancel, sendButton);
popup.append(heading, field, status, actions);

let target: { tabId: string; name: string } | null = null;
let closeTimer: ReturnType<typeof setTimeout> | undefined;

export const isOpen = (): boolean => !popup.hidden;

export function close(): void {
  clearTimeout(closeTimer);
  popup.hidden = true;
  target = null;
}

function place(anchor: HTMLElement): void {
  const box = anchor.getBoundingClientRect();
  const width = Math.min(360, window.innerWidth - 32);
  popup.style.width = `${width}px`;
  popup.style.left = `${Math.min(Math.max(16, box.left), window.innerWidth - 16 - width)}px`;
  const below = box.bottom + 6;
  popup.style.top = `${Math.max(16, below + 200 > window.innerHeight ? box.top - 206 : below)}px`;
}

function open(anchor: HTMLElement, tabId: string, name: string): void {
  if (!popup.isConnected) document.body.append(popup);
  clearTimeout(closeTimer);
  if (target?.tabId !== tabId) field.value = '';
  target = { tabId, name };
  const sender = tabs.active()?.update?.sessionId ? tabs.active()?.update?.label : null;
  heading.textContent = sender ? `Message ${name} · from ${sender}` : `Message ${name}`;
  status.textContent = '';
  sendButton.disabled = false;
  popup.hidden = false;
  place(anchor);
  field.focus();
}

popup.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = field.value.trim();
  if (!target || !text) return;
  const { tabId } = target;
  sendButton.disabled = true;
  void mentions.send(tabs.active()?.id ?? null, [tabId], text).then((result) => {
    sendButton.disabled = false;
    if ('error' in result) { status.textContent = `Couldn’t send: ${result.error}`; return; }
    status.textContent = deliverySummary(result);
    if (result.some((d) => d.outcome === 'sent' || d.outcome === 'queued')) {
      field.value = '';
      closeTimer = setTimeout(close, CLOSE_AFTER_SENT_MS);
    }
  });
});
cancel.addEventListener('click', close);
// Esc closes this composer only, never the board under it; ⌘Enter sends.
popup.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
  else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); popup.requestSubmit(); }
});
window.addEventListener('resize', close);
new MutationObserver(() => { if (byId('board').hidden) close(); }).observe(byId('board'), { attributes: true, attributeFilter: ['hidden'] });

// The card's "Message…": only for another session in this window, never the one she is in.
export function control(card: { tabId: string | null; name: string }): HTMLButtonElement | null {
  const { tabId } = card;
  if (!tabId || tabId === tabs.active()?.id) return null;
  const button = el('button', 'board-message-open', 'Message…');
  button.type = 'button';
  button.title = `Send ${card.name} a message from this session`;
  button.addEventListener('click', () => open(button, tabId, card.name));
  return button;
}

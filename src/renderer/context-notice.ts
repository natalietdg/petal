// The one-time "Context about 60% full" line over the reader: once per session, until she closes it.
import { el } from './dom';
import { contextNotice, contextNoticeDue, type SessionSpend } from '../shared/session-spend';

const STORE_KEY = 'petal.contextNoticeClosed';
const KEPT = 200; // closed session ids remembered, newest last

const closed = (): string[] => {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]') as string[]; } catch { return []; }
};

export const line = el('p', 'status reader-notice context-notice');
line.hidden = true;
line.setAttribute('role', 'status');
const text = el('span', 'context-notice-text');
const close = el('button', 'context-notice-close', 'Got it');
close.type = 'button';
line.append(text, close);
let shownFor: string | null = null;

close.addEventListener('click', () => {
  if (shownFor) localStorage.setItem(STORE_KEY, JSON.stringify([...closed().filter((id) => id !== shownFor), shownFor].slice(-KEPT)));
  line.hidden = true;
});

export function paint(sessionId: string | null, spend: SessionSpend | null | undefined): void {
  const due = Boolean(sessionId && spend && contextNoticeDue(spend) && !closed().includes(sessionId));
  shownFor = due ? sessionId : null;
  line.hidden = !due;
  if (due && spend) text.textContent = `${contextNotice(spend)} `;
}

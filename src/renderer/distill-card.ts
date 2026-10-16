// "Claude needs you": a test-loop round that handed over, or asked something only she can answer, shows a card
// in the reader and on the session's Board card. Her answer goes through the reply box's paste path.
import * as tabs from './tabs';
import * as composer from './composer';
import { el } from './dom';
import { handoffAnswer, openHandoff, type Handoff } from '../shared/distillation';

export const CHANGED_EVENT = 'petal:distill-answered';

const answered = new Set<string>(); // reply ids she answered here; the card goes before Claude's log shows her message
const drafts = new Map<string, string>(); // per reply and place, so a re-render keeps what she typed
let focused: string | null = null; // the draft key whose box had focus

// The tab's open hand-off, unless she already answered it or has written since.
export function handoffFor(tabId: string | null): Handoff | null {
  const tab = tabId ? tabs.get(tabId) : null;
  const update = tab?.update;
  if (!tab || !update || update.state !== 'live') return null;
  const handoff = openHandoff(update.replies, update.waiting.length + tab.pending.length);
  return handoff && !answered.has(handoff.replyId) ? handoff : null;
}

// Changes when a card appears, goes, or is answered; the Board folds it into its re-render key.
export const stateKey = (tabIds: readonly (string | null)[]): string => tabIds.map((id) => handoffFor(id)?.replyId ?? '').join('|');

async function send(tabId: string, handoff: Handoff, text: string, note: HTMLElement, key: string): Promise<void> {
  const answer = composer.stripControls(text).trim();
  if (!answer) { note.textContent = 'Write your answer first.'; return; }
  const tab = tabs.get(tabId);
  if (!tab || !(await composer.pasteToClaude(tab, handoffAnswer(handoff, answer)))) { note.textContent = 'Couldn’t reach Claude in that tab. Try again.'; return; }
  answered.add(handoff.replyId);
  drafts.delete(key);
  focused = null;
  window.dispatchEvent(new CustomEvent(CHANGED_EVENT, { detail: tabId }));
}

// place: 'reader' or 'board'; the board's card is narrower and leads with the question only.
export function card(tabId: string | null, place: 'reader' | 'board'): HTMLElement | null {
  const handoff = tabId ? handoffFor(tabId) : null;
  if (!tabId || !handoff) return null;
  const key = `${place}:${handoff.replyId}`;
  const box = el('section', `distill-card is-${place}`);
  box.setAttribute('aria-label', 'Claude needs you');
  box.dataset.replyId = handoff.replyId;
  const title = el('p', 'distill-card-title');
  title.append(el('strong', 'distill-card-label', 'Claude needs you:'), ' ', el('span', 'distill-card-question', handoff.question));
  box.append(title);
  const more = handoff.asks.filter((q) => q !== handoff.question);
  if (more.length) {
    const list = el('ul', 'distill-card-asks');
    for (const q of more) list.append(el('li', null, q));
    box.append(list);
  }
  if (place === 'reader' && handoff.course === 'hand-to-you' && handoff.reason && handoff.reason !== handoff.question) box.append(el('p', 'distill-card-reason', `Why: ${handoff.reason}`));
  const form = el('form', 'distill-card-form');
  const input = el('textarea', 'distill-card-input');
  Object.assign(input, { rows: place === 'board' ? 1 : 2, placeholder: 'Your answer', spellcheck: true, value: drafts.get(key) ?? '' });
  input.setAttribute('aria-label', `Answer: ${handoff.question}`);
  const go = el('button', 'distill-card-send', 'Send answer');
  go.type = 'submit';
  const note = el('p', 'distill-card-note');
  note.setAttribute('role', 'status');
  form.append(input, go);
  box.append(form, note);
  input.addEventListener('input', () => drafts.set(key, input.value));
  input.addEventListener('focus', () => { focused = key; });
  // A box removed by a re-render keeps the focus claim; only a real blur on a box still shown gives it up.
  input.addEventListener('blur', () => setTimeout(() => { if (input.isConnected && focused === key && document.activeElement !== input) focused = null; }, 0));
  input.addEventListener('keydown', (event) => {
    event.stopPropagation(); // the Board's arrow keys and the reader's shortcuts stay out of her answer
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); }
  });
  form.addEventListener('submit', (event) => { event.preventDefault(); void send(tabId, handoff, input.value, note, key); });
  // A re-render while she types puts her back where she was.
  if (focused === key) queueMicrotask(() => { if (input.isConnected) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); } });
  return box;
}

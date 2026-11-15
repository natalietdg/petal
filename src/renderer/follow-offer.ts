// "Follow a session you already have": the empty reader and the What's next card offer live sessions started
// outside Petal, so the first page can arrive before she starts a session here (ux review #5).
import * as follow from './follow';
import * as sessionsPanel from './sessions-panel';
import { el } from './dom';
import { FOLLOW_LABEL, FOLLOW_OFFER_LINE, FOLLOW_OFFER_MAX, FOLLOW_OFFER_TITLE } from '../shared/outside-sessions';

type Outside = { sessionId: string; title: string };
let outside: Outside[] = [];
const shown = new Map<HTMLElement, () => void>(); // each offer on screen and what runs after a follow starts

sessionsPanel.onView((view) => {
  const next = view.outside ?? [];
  if (JSON.stringify(next) === JSON.stringify(outside)) return;
  outside = next;
  for (const [node, after] of shown) {
    if (node.isConnected) paint(node, after);
    else shown.delete(node);
  }
});

export const hasSessions = (): boolean => outside.length > 0;

// Hidden while nothing runs outside Petal; fills in on the next sessions tick when something does.
export function element(afterFollow: () => void = () => {}): HTMLElement {
  const node = el('div', 'follow-offer');
  shown.set(node, afterFollow);
  paint(node, afterFollow);
  return node;
}

function paint(node: HTMLElement, afterFollow: () => void): void {
  node.hidden = outside.length === 0;
  if (node.hidden) { node.replaceChildren(); return; }
  const note = el('p', 'follow-offer-note');
  note.setAttribute('aria-live', 'polite');
  const list = el('ul', 'follow-offer-list');
  list.append(...outside.slice(0, FOLLOW_OFFER_MAX).map(({ sessionId, title }) => {
    const item = el('li', 'follow-offer-item');
    const button = el('button', 'session-link follow-offer-follow', `${FOLLOW_LABEL} ${title}`);
    button.type = 'button';
    button.addEventListener('click', () => void followIt(sessionId, title, note, afterFollow));
    item.append(button);
    return item;
  }));
  node.replaceChildren(el('p', 'follow-offer-title', FOLLOW_OFFER_TITLE), el('p', 'follow-offer-line', FOLLOW_OFFER_LINE), list, note);
}

async function followIt(sessionId: string, title: string, note: HTMLElement, afterFollow: () => void): Promise<void> {
  const refused = await follow.start(sessionId, title);
  if (refused) { note.textContent = refused; return; }
  afterFollow();
}

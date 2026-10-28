// Draws the Confirmed page: four groups of items, each a link back to its reply.
import { el } from './dom';
import { renderInline } from './markdown';
import { GROUP_ORDER, GROUP_TITLES, type ConfirmedGroups, type ConfirmedItem } from '../shared/confirmed';

const PILL_CLASS = { 'In progress': 'progress', 'Waiting on you': 'waiting' } as const;

function itemRow(item: ConfirmedItem, onJump: (replyId: string | undefined) => void): HTMLLIElement {
  const row = el('li', 'confirmed-item');
  row.tabIndex = 0;
  row.setAttribute('role', 'button');
  row.title = 'Show this reply';
  if (item.pill) row.append(el('span', `confirmed-pill confirmed-pill-${PILL_CLASS[item.pill]}`, item.pill));
  const text = el('div', 'confirmed-text');
  text.innerHTML = renderInline(item.text);
  row.append(text);
  if (item.answer) {
    const answer = el('p', 'confirmed-answer');
    answer.append(el('span', 'confirmed-you', 'You:'), document.createTextNode(` ${item.answer}`));
    row.append(answer);
  }
  if (item.context) row.append(el('p', 'confirmed-context', item.context));
  row.addEventListener('click', (event) => {
    if ((event.target as Element).closest('a[href]')) return; // a link in the text opens, it doesn't jump
    onJump(item.replyId);
  });
  row.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onJump(item.replyId);
  });
  return row;
}

export function render(container: HTMLElement, groups: ConfirmedGroups, onJump: (replyId: string | undefined) => void): void {
  const sections = GROUP_ORDER.filter((key) => groups[key].length).map((key) => {
    const section = el('section', `confirmed-group confirmed-${key}`);
    const list = el('ul', 'confirmed-list');
    list.append(...groups[key].map((item) => itemRow(item, onJump)));
    section.append(el('h2', 'confirmed-title', GROUP_TITLES[key]), list);
    return section;
  });
  container.replaceChildren(...(sections.length ? sections : [el('p', 'confirmed-empty', 'Nothing confirmed yet in this session.')]));
}

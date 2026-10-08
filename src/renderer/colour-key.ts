// Colour key: a header popover listing each reply treatment as a live sample, drawn by the reader's own CSS.
// It lives inside #reader-head so the current look's tokens (Print's paper and ink) reach the samples.
import * as markdown from './markdown';
import { byId, el } from './dom';
import { KEY_ENTRIES, type KeyEntry } from './colour-key-entries';

const GAP_PX = 8;

const button = byId('colour-key-button');
const popover = byId('colour-key');
const list = el('ul', 'ck-list');
popover.append(el('p', 'ck-title', 'Colour key'), el('p', 'ck-sub', 'What each mark in a reply means, shown in this look.'), list);

// A sample is a real rendered reply fragment; section-only rows drop their placeholder heading.
function sample(entry: KeyEntry): HTMLElement {
  const prose = markdown.render(entry.inSection ? `## Section\n\n${entry.markdown}` : entry.markdown);
  if (entry.inSection) prose.querySelector('.story-section > h2')?.remove();
  for (const node of prose.querySelectorAll('.end-mark, .lede')) node.classList.remove('end-mark', 'lede'); // ornaments, not part of the key
  const column = el('div', 'ck-sample reader-column');
  column.append(prose);
  return column;
}

function row(entry: KeyEntry): HTMLLIElement {
  const item = el('li', 'ck-entry');
  item.dataset.key = entry.id;
  const meaning = el('p', 'ck-meaning');
  meaning.append(el('strong', '', entry.label), ` · ${entry.meaning}`);
  item.append(sample(entry), meaning);
  return item;
}

let built = false;
export const isOpen = (): boolean => !popover.hidden;

export function close(): void {
  popover.hidden = true;
  button.setAttribute('aria-expanded', 'false');
}

export function open(): void {
  if (!built) list.replaceChildren(...KEY_ENTRIES.map(row));
  built = true;
  const anchor = button.getBoundingClientRect();
  popover.style.top = `${Math.round(anchor.bottom + GAP_PX)}px`;
  popover.style.right = `${Math.round(window.innerWidth - anchor.right)}px`;
  popover.hidden = false;
  button.setAttribute('aria-expanded', 'true');
}

button.addEventListener('click', () => (isOpen() ? close() : open()));
// Dismiss on a click anywhere else, Esc, or a resize that would leave it detached from the button.
document.addEventListener('click', (event) => {
  const target = event.target as Node;
  if (isOpen() && !popover.contains(target) && !button.contains(target)) close();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && isOpen()) close();
});
window.addEventListener('resize', () => { if (isOpen()) close(); });

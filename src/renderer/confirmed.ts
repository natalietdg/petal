// Draws the Confirmed page: its sections of items, each a link back to its reply.
import { el } from './dom';
import { renderInline } from './markdown';
import { SECTIONS, type ConfirmedGroups, type ConfirmedItem } from '../shared/confirmed';
import { replyImageUrl } from '../shared/reply-image-url';

type Jump = (replyId: string | undefined) => void;

const PILL_CLASS = { 'In progress': 'progress', 'Waiting on you': 'waiting' } as const;

const fileName = (path: string): string => path.split('/').pop() || path;

// A card that jumps to its reply on click, Enter or Space; a link inside still opens.
function jumpRow(className: string, item: ConfirmedItem, onJump: Jump): HTMLLIElement {
  const row = el('li', className);
  row.tabIndex = 0;
  row.setAttribute('role', 'button');
  row.title = 'Show this reply';
  row.addEventListener('click', (event) => {
    if ((event.target as Element).closest('a[href]')) return;
    onJump(item.replyId);
  });
  row.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onJump(item.replyId);
  });
  return row;
}

function itemRow(item: ConfirmedItem, onJump: Jump): HTMLLIElement {
  const row = jumpRow('confirmed-item', item, onJump);
  if (item.pill) row.append(el('span', `confirmed-pill confirmed-pill-${PILL_CLASS[item.pill]}`, item.pill));
  const text = el('div', 'confirmed-text');
  text.innerHTML = renderInline(item.text);
  for (const img of text.querySelectorAll('img')) img.replaceWith(img.alt); // pictures show under Screens, never load from a raw src
  row.append(text);
  if (item.answer) {
    const answer = el('p', 'confirmed-answer');
    answer.append(el('span', 'confirmed-you', 'You:'), document.createTextNode(` ${item.answer}`));
    row.append(answer);
  }
  if (item.context) row.append(el('p', 'confirmed-context', item.context));
  return row;
}

// A screen: its thumbnail through petal-img://, the same address the reply's own picture uses.
function screenTile(item: ConfirmedItem, cwd: string | null, onJump: Jump): HTMLLIElement {
  const path = item.image ?? item.text;
  const tile = jumpRow('confirmed-item confirmed-screen', item, onJump);
  const frame = el('div', 'confirmed-thumb-frame');
  const thumb = el('img', 'confirmed-thumb');
  thumb.alt = fileName(path);
  thumb.decoding = 'async';
  thumb.src = replyImageUrl(path, cwd);
  thumb.addEventListener('error', () => frame.replaceChildren(el('span', 'confirmed-thumb-missing', `image not found: ${fileName(path)}`)), { once: true });
  frame.append(thumb);
  tile.append(frame, el('p', 'confirmed-context', item.context || fileName(path)));
  tile.title = path;
  return tile;
}

export function render(container: HTMLElement, groups: ConfirmedGroups, cwd: string | null, onJump: Jump): void {
  const sections = SECTIONS.flatMap(({ key, title, parts }) => {
    const shown = parts.filter((part) => groups[part.key].length);
    if (!shown.length) return [];
    const section = el('section', `confirmed-group confirmed-${key}`);
    section.append(el('h2', 'confirmed-title', title));
    for (const part of shown) {
      const list = el('ul', part.key === 'screens' ? 'confirmed-list confirmed-screens' : 'confirmed-list');
      list.append(...groups[part.key].map((item) => (part.key === 'screens' ? screenTile(item, cwd, onJump) : itemRow(item, onJump))));
      if (part.title) section.append(el('h3', `confirmed-subtitle confirmed-part-${part.key}`, part.title));
      section.append(list);
    }
    return [section];
  });
  container.replaceChildren(...(sections.length ? sections : [el('p', 'confirmed-empty', 'Nothing confirmed yet in this session.')]));
}

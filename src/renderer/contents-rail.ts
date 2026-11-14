// Replies view: a contents rail in the left gutter listing the replies on screen; a click jumps to one.
// Skipped in Book, whose left page carries the margin notes (#790), and whenever the gutter is too narrow.
import { el } from './dom';
import { railTitle, showsRail, type RailEntry } from '../shared/contents-rail';

const rail = el('nav', 'contents-rail');
rail.setAttribute('aria-label', 'Contents');
rail.hidden = true;
const list = el('ol', 'contents-rail-list');
rail.append(el('p', 'contents-rail-title', 'Contents'), list);

let jump: (replyId: string) => void = () => {};
let entries: RailEntry[] = [];
let host: HTMLElement | null = null;

const isBook = (): boolean => document.documentElement.dataset.reading === 'book';

function gutter(): number {
  if (!host?.parentElement) return 0;
  return host.getBoundingClientRect().left - host.parentElement.getBoundingClientRect().left;
}

function fit(): void {
  rail.hidden = !showsRail(entries.length, gutter(), isBook());
}

// Mounts once inside the replies view, so it hides with it when Confirmed is shown.
export function mount(repliesView: HTMLElement, onJump: (replyId: string) => void): void {
  jump = onJump;
  host = repliesView.closest<HTMLElement>('.reader-column');
  repliesView.prepend(rail);
  if (host?.parentElement) new ResizeObserver(fit).observe(host.parentElement);
  new MutationObserver(fit).observe(document.documentElement, { attributeFilter: ['data-reading'] });
}

function entryOf(reply: HTMLElement): RailEntry | null {
  const replyId = reply.dataset.replyId;
  if (!replyId) return null;
  const headline = reply.querySelector('.headline')?.textContent ?? null;
  const opening = reply.querySelector('.prose p:not(.headline)')?.textContent ?? '';
  return { replyId, title: railTitle(headline, opening) };
}

// Reads the replies as drawn (oldest first), so the rail always matches the page.
export function paint(replies: readonly HTMLElement[]): void {
  entries = replies.map(entryOf).filter((e): e is RailEntry => e !== null);
  list.replaceChildren(...entries.map(({ replyId, title }, index) => {
    const button = el('button', 'contents-rail-item', title);
    button.type = 'button';
    button.title = title;
    if (index === entries.length - 1) button.setAttribute('aria-current', 'true');
    button.addEventListener('click', () => jump(replyId));
    const item = el('li');
    item.append(button);
    return item;
  }));
  fit();
}

export const state = () => ({ shown: !rail.hidden, titles: entries.map((e) => e.title), gutter: Math.round(gutter()) });

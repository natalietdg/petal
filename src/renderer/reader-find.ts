// ⌘F: a find bar over the reader. Matches are painted with CSS highlights, so the replies' own nodes never change.
import { byId, el } from './dom';

const MATCH = 'petal-find';
const CURRENT = 'petal-find-current';
const REFRESH_MS = 150; // let a streaming reply settle before searching it again

interface TextRun { node: Text; start: number }

// Text a reader can see: not inside a hidden part (a reply behind its Code review tab, a hidden view).
function visibleText(root: Element): { text: string; runs: TextRun[] } {
  const runs: TextRun[] = [];
  let text = '';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement?.closest('[hidden], script, style') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    runs.push({ node: node as Text, start: text.length });
    text += node.textContent ?? '';
  }
  return { text, runs };
}

// The run holding character `at`; an end position belongs to the run it closes.
function positionOf(runs: TextRun[], at: number, isEnd: boolean): { node: Text; offset: number } {
  let low = 0;
  let high = runs.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const start = runs[mid]?.start ?? 0;
    if (start < at || (!isEnd && start === at)) low = mid;
    else high = mid - 1;
  }
  const run = runs[low] as TextRun;
  return { node: run.node, offset: at - run.start };
}

// Every case-insensitive match of the query in the root's visible text, in reading order; a match may span bold or links.
export function findMatches(root: Element, query: string): Range[] {
  const needle = query.toLowerCase();
  if (!needle) return [];
  const { text, runs } = visibleText(root);
  const haystack = text.toLowerCase();
  const ranges: Range[] = [];
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + needle.length)) {
    const start = positionOf(runs, at, false);
    const end = positionOf(runs, at + needle.length, true);
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    ranges.push(range);
  }
  return ranges;
}

export const countLabel = (current: number, total: number, query: string): string =>
  !query ? '' : total ? `${current + 1} of ${total}` : 'No matches';

// ---- The bar ----

const area = byId('reader-area');
const scroller = byId('reader');
const searched = byId('replies-view');

const bar = el('div', 'find-bar');
bar.setAttribute('role', 'search');
bar.hidden = true;
const input = el('input', 'find-input');
input.type = 'text';
input.placeholder = 'Find in reader';
input.setAttribute('aria-label', 'Find in reader');
input.spellcheck = false;
const count = el('span', 'find-count');
count.setAttribute('role', 'status');
const button = (className: string, label: string, text: string): HTMLButtonElement => {
  const b = el('button', `find-button ${className}`, text);
  b.type = 'button';
  b.setAttribute('aria-label', label);
  b.title = label;
  return b;
};
const previous = button('find-previous', 'Previous match', '↑');
const next = button('find-next', 'Next match', '↓');
const close = button('find-close', 'Close find', '×');
bar.append(input, count, previous, next, close);
area.append(bar);

let matches: Range[] = [];
let current = 0;
let returnFocus: HTMLElement | null = null;

const highlights = (): HighlightRegistry | null => (typeof CSS !== 'undefined' && 'highlights' in CSS ? CSS.highlights : null);

function paint(): void {
  count.textContent = countLabel(current, matches.length, input.value);
  const registry = highlights();
  if (!registry) return;
  registry.set(MATCH, new Highlight(...matches));
  const hit = matches[current];
  if (hit) registry.set(CURRENT, new Highlight(hit));
  else registry.delete(CURRENT);
}

const reducedMotion = (): boolean => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? true;

// A match inside a folded section opens that section first, the way clicking its heading would.
function reveal(range: Range): void {
  const host = range.startContainer.parentElement;
  const folded = host?.closest('.story-section.folded');
  folded?.querySelector<HTMLElement>(':scope > h2')?.click();
  host?.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
}

function search(keepPlace: boolean): void {
  matches = findMatches(searched, input.value);
  current = keepPlace ? Math.min(current, Math.max(matches.length - 1, 0)) : 0;
  paint();
}

export function step(delta: 1 | -1): void {
  if (!matches.length) return;
  current = (current + delta + matches.length) % matches.length;
  paint();
  const hit = matches[current];
  if (hit) reveal(hit);
}

export const isOpen = (): boolean => !bar.hidden;

export function open(): void {
  if (!scroller.getClientRects().length) return; // the reader is behind History or another full view
  if (!isOpen()) returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  bar.style.top = `${scroller.offsetTop + 8}px`;
  bar.hidden = false;
  input.focus();
  input.select();
  search(true);
  watcher.observe(searched, { childList: true, subtree: true, characterData: true });
}

export function closeBar(): void {
  if (!isOpen()) return;
  bar.hidden = true;
  watcher.disconnect();
  clearTimeout(refreshTimer);
  matches = [];
  highlights()?.delete(MATCH);
  highlights()?.delete(CURRENT);
  returnFocus?.focus({ preventScroll: true });
  returnFocus = null;
}

// The reader redraws as Claude writes: search again once it settles, keeping her place.
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
const watcher = new MutationObserver(() => {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => search(true), REFRESH_MS);
});

input.addEventListener('input', () => {
  search(false);
  const hit = matches[current];
  if (hit) reveal(hit);
});
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    step(event.shiftKey ? -1 : 1);
  } else if (event.key === 'Escape') {
    event.preventDefault(); // so Focus mode and open views keep this Esc out of their own handling
    event.stopPropagation();
    closeBar();
  }
});
previous.addEventListener('click', () => step(-1));
next.addEventListener('click', () => step(1));
close.addEventListener('click', closeBar);

window.pastel.onFindInReader(open);

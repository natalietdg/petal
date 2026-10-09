// A Steps section's numbered lists become step rows: a badge she clicks to tick, the action, its Check line muted underneath.
import { el } from './dom';
import { toggleDone, type FoldState } from '../shared/reply-fold';
import { checkLineStart, isCheckLine, stepRuns, stripCheckLabel, type StepBlock } from '../shared/reply-steps';

const BLOCK = new Set(['P', 'UL', 'OL', 'PRE', 'TABLE', 'BLOCKQUOTE', 'DIV', 'H3', 'H4']);
const TICK = '✓';

const textOf = (node: Node): string => node.textContent ?? '';

const blockKind = (node: Element): StepBlock => {
  if (node.nodeName === 'OL') return 'list';
  return node.nodeName === 'P' && isCheckLine(textOf(node)) ? 'check' : 'other';
};

// The Check line's own paragraph: its "Check:" label dropped, a quiet "Check" tag in its place.
function checkLine(from: Node): HTMLParagraphElement {
  const line = el('p', 'step-check');
  line.append(...from.childNodes);
  const first = line.firstChild;
  if (first?.nodeName === 'STRONG' && /^\s*check\s*:?\s*$/i.test(textOf(first))) first.remove();
  const lead = line.firstChild;
  if (lead?.nodeType === Node.TEXT_NODE) lead.textContent = stripCheckLabel(textOf(lead)).replace(/^\s*:?\s*/, '');
  const tag = el('span', 'step-check-label');
  tag.textContent = 'Check';
  line.prepend(tag, ' ');
  return line;
}

// "Do X\nCheck: Y" in one paragraph: everything from the Check line to the first block moves out.
function splitInlineCheck(container: Element): DocumentFragment | null {
  const inline = [...container.childNodes];
  const stop = inline.findIndex((node) => BLOCK.has(node.nodeName));
  const lead = stop < 0 ? inline : inline.slice(0, stop);
  const at = checkLineStart(lead.map(textOf).join(''));
  if (at < 0) return null;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let seen = 0;
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    const length = textOf(text).length;
    if (seen + length > at) {
      const range = document.createRange();
      range.setStart(text, at - seen);
      const end = lead[lead.length - 1];
      if (end) range.setEndAfter(end);
      const fragment = range.extractContents();
      const first = fragment.firstChild;
      if (first?.nodeType === Node.TEXT_NODE) first.textContent = textOf(first).replace(/^\s+/, '');
      if (first && !textOf(first)) first.remove(); // so a bold "Check:" label leads
      return fragment;
    }
    seen += length;
  }
  return null;
}

// A Check line inside the item: its own paragraph, a sub-item, or a line under the action (in a loose list, its <p>).
function takeCheck(item: Element): Node | null {
  for (const child of item.children) {
    if (child.nodeName === 'P' && isCheckLine(textOf(child))) {
      child.remove();
      return child;
    }
    if (child.nodeName === 'P' && checkLineStart(textOf(child)) >= 0) return splitInlineCheck(child);
    if (child.nodeName === 'UL' || child.nodeName === 'OL') {
      const sub = [...child.children].find((li) => isCheckLine(textOf(li)));
      if (!sub) continue;
      sub.remove();
      if (!child.childElementCount) child.remove();
      return sub;
    }
  }
  return splitInlineCheck(item);
}

function paint(row: HTMLElement, badge: HTMLButtonElement, number: number, done: boolean): void {
  row.classList.toggle('done', done);
  badge.textContent = done ? TICK : String(number);
  badge.setAttribute('aria-pressed', String(done));
}

function stepRow(item: Element, number: number, key: string, state: FoldState): HTMLLIElement {
  const row = el('li', 'step');
  const badge = el('button', 'step-badge');
  badge.type = 'button';
  badge.setAttribute('aria-label', `Step ${number} done`);
  const check = takeCheck(item);
  const body = el('div', 'step-body');
  body.append(...item.childNodes);
  row.append(badge, body);
  if (check) row.append(checkLine(check));
  badge.addEventListener('click', () => paint(row, badge, number, toggleDone(state, key)));
  paint(row, badge, number, state.done.has(key));
  return row;
}

// section: which section of the reply, so ticks survive a redraw while the reply streams.
export function buildSteps(body: Element, section: number, state: FoldState): void {
  const blocks = [...body.children];
  let number = 0;
  for (const run of stepRuns(blocks.map(blockKind))) {
    const list = el('ol', 'steps');
    for (const index of run) {
      const block = blocks[index] as Element;
      if (block.nodeName === 'OL') {
        for (const item of block.children) list.append(stepRow(item, ++number, `${section}:${number}`, state));
      } else {
        list.lastElementChild?.append(checkLine(block));
      }
    }
    blocks[run[0] ?? 0]?.before(list);
    for (const index of run) blocks[index]?.remove();
  }
}

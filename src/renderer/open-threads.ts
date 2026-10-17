// An Open threads section's list items become cards; clicking one asks that question as her next message.
import { el } from './dom';
import { splitThread, threadCheckStart, threadPrompt, type Thread } from '../shared/reply-threads';

// Fired on the card and bubbled; the reader and History each send it their own way.
export const OPEN_THREAD_EVENT = 'petal:open-thread';

const textOf = (node: Node): string => node.textContent ?? '';

// Everything from the Check label to the item's end moves out, inline formatting kept.
function extractCheck(item: Element, at: number): DocumentFragment | null {
  const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
  let seen = 0;
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    const length = textOf(text).length;
    if (seen + length > at) {
      const range = document.createRange();
      range.setStart(text, at - seen);
      range.setEndAfter(item.lastChild ?? text);
      return range.extractContents();
    }
    seen += length;
  }
  return null;
}

// Drops the "Check:" label (and a bracket around the check) from the fragment's first words.
function stripLabel(fragment: DocumentFragment, bracketed: boolean): void {
  const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT);
  const first = walker.nextNode();
  if (first) first.textContent = textOf(first).replace(/^\s*check\s*:\s*/i, '');
  if (!bracketed) return;
  let last: Node | null = null;
  for (let text: Node | null = first; text; text = walker.nextNode()) last = text;
  if (last) last.textContent = textOf(last).replace(/\)\s*$/, '');
}

// Empty wrappers the split left behind ("<em></em>") and a dangling "(" go too.
function tidyQuestion(question: Element): void {
  for (let node = question.lastChild; node && !textOf(node).trim(); node = question.lastChild) node.remove();
  const tail = question.lastChild;
  if (tail?.nodeType === Node.TEXT_NODE) tail.textContent = textOf(tail).replace(/\s*\(\s*$/, '');
}

function card(item: Element): HTMLLIElement {
  const thread = splitThread(textOf(item));
  const at = thread.check ? threadCheckStart(textOf(item)) : -1;
  const check = at >= 0 ? extractCheck(item, at) : null;
  const bracketed = /\(\s*$/.test(textOf(item));
  const question = el('span', 'thread-question');
  question.append(...item.childNodes);
  tidyQuestion(question);

  const button = el('button', 'thread-card');
  button.type = 'button';
  button.title = 'Ask Claude this next';
  button.append(question);
  if (check) {
    stripLabel(check, bracketed);
    const line = el('span', 'thread-check');
    line.append(el('span', 'thread-check-label', 'Check'), ' ', check);
    button.append(line);
  }
  button.append(el('span', 'thread-ask', 'Ask next'));
  button.addEventListener('click', (event) => {
    if ((event.target as Element).closest('a')) return; // a link inside still opens its page
    button.dispatchEvent(new CustomEvent(OPEN_THREAD_EVENT, { bubbles: true, detail: threadPrompt(thread) }));
  });
  const row = el('li', 'thread');
  row.append(button);
  return row;
}

// The section's top-level lists become one card list each; any prose around them stays.
export function buildThreads(body: Element): void {
  for (const list of [...body.children].filter((node) => node.nodeName === 'UL' || node.nodeName === 'OL')) {
    const cards = el('ul', 'threads');
    for (const item of [...list.children]) cards.append(card(item));
    list.replaceWith(cards);
  }
}

// The same card built from plain text, for views that read threads from markdown (Testing's distillation).
// ask gets what a reader card would send: the question, then its check.
export function threadButton(thread: Thread, ask: (prompt: string) => void): HTMLButtonElement {
  const button = el('button', 'thread-card');
  button.type = 'button';
  button.title = 'Ask Claude this next';
  button.append(el('span', 'thread-question', thread.question));
  if (thread.check) {
    const line = el('span', 'thread-check');
    line.append(el('span', 'thread-check-label', 'Check'), ' ', thread.check);
    button.append(line);
  }
  button.append(el('span', 'thread-ask', 'Ask next'));
  button.addEventListener('click', () => ask(threadPrompt(thread)));
  return button;
}

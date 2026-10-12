// Customize › Formatting › Shape guide: each shape as Claude types it, beside the reader's own rendering of it in the current look.
import * as markdown from './markdown';
import * as diagrams from './diagrams';
import { el } from './dom';
import { actionButton } from './customize-kit';
import { SHAPE_ENTRIES, type ShapeEntry } from './shape-guide-entries';

const COPIED_MS = 1400;

// Copies the raw markdown; the label says whether it worked.
function copyButton(text: string, name: string): HTMLButtonElement {
  const button = actionButton('Copy', async () => {
    const copied = await navigator.clipboard.writeText(text).then(() => true, () => false);
    button.textContent = copied ? 'Copied' : 'Copy failed';
    setTimeout(() => { button.textContent = 'Copy'; }, COPIED_MS);
  }, 'sg-copy');
  button.setAttribute('aria-label', `Copy the ${name} markdown`);
  return button;
}

// Rendered like a reply (sections fold, steps tick) under its own fold key, so the real reader's state is untouched.
function preview(entry: ShapeEntry): HTMLDivElement {
  const column = el('div', 'reader-column cz-preview sg-preview');
  const prose = markdown.render(entry.markdown, { fold: `shape-guide:${entry.id}` });
  column.append(prose);
  void diagrams.render(prose);
  return column;
}

function row(entry: ShapeEntry): HTMLDivElement {
  const item = el('div', 'sg-row');
  item.dataset.shape = entry.id;
  const head = el('div', 'sg-head');
  head.append(el('span', 'sg-name', entry.name), el('span', 'sg-use', entry.use));
  const raw = el('div', 'sg-raw');
  const code = el('pre', 'sg-md');
  code.append(el('code', null, entry.markdown)); // plain text, exactly as typed
  raw.append(code, copyButton(entry.markdown, entry.name));
  const pair = el('div', 'sg-pair');
  pair.append(raw, preview(entry));
  item.append(head, pair);
  return item;
}

export function shapeGuide(): HTMLDivElement {
  const list = el('div', 'sg-list');
  list.append(...SHAPE_ENTRIES.map(row));
  // Previews are samples: a link click never leaves Customize.
  list.addEventListener('click', (event) => {
    if ((event.target as Element).closest('.sg-preview a')) event.preventDefault();
  });
  return list;
}

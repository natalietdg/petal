// Customize › Formatting › Formatting guide: each shape as Claude types it beside the reader's rendering, then the colour labels.
// Both halves render through the reader's own markdown and CSS, so they always show the current look.
import * as markdown from './markdown';
import * as diagrams from './diagrams';
import { el } from './dom';
import { actionButton } from './customize-kit';
import { KEY_ENTRIES, LIFESTYLE_ENTRIES, SHAPE_ENTRIES, type KeyEntry, type ShapeEntry } from './formatting-guide-entries';

const COPIED_MS = 1400;
export const COLOUR_LABELS_ID = 'colour-labels';

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

function shapeRow(entry: ShapeEntry): HTMLDivElement {
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

// A colour sample is a real rendered reply fragment; section-only rows drop their placeholder heading.
function sample(entry: KeyEntry): HTMLElement {
  const column = el('div', 'ck-sample reader-column');
  if (entry.kicker) {
    column.append(el('p', 'status', 'Latest reply · 9:30 AM'));
    return column;
  }
  const prose = markdown.render(entry.inSection ? `## Section\n\n${entry.markdown}` : entry.markdown);
  if (entry.inSection) prose.querySelector('.story-section > h2')?.remove();
  for (const node of prose.querySelectorAll('.lede')) node.classList.remove('lede'); // drop caps are not part of the key
  if (!entry.keepEnd) for (const node of prose.querySelectorAll('.end-mark')) node.classList.remove('end-mark');
  column.append(prose);
  return column;
}

function colourRow(entry: KeyEntry): HTMLLIElement {
  const item = el('li', 'ck-entry');
  item.dataset.key = entry.id;
  const meaning = el('p', 'ck-meaning');
  meaning.append(el('strong', '', entry.label), ` · ${entry.meaning}`);
  item.append(sample(entry), meaning);
  return item;
}

// The four colour labels, then Lifestyle's extra colour (CSS shows that part only in Lifestyle, so it follows a look change).
function colourLabels(): HTMLElement {
  const part = el('section', 'ck-part');
  part.id = COLOUR_LABELS_ID;
  const list = el('ul', 'ck-list');
  list.append(...KEY_ENTRIES.map(colourRow));
  const lookOnly = el('div', 'ck-look');
  const lookList = el('ul', 'ck-list');
  lookList.append(...LIFESTYLE_ENTRIES.map(colourRow));
  lookOnly.append(el('p', 'ck-look-head', 'In this look'), lookList);
  part.append(el('h3', 'ck-title', 'Colour labels'), el('p', 'ck-sub', 'What each coloured mark in a reply means, shown in this look. Everything else is type.'), list, lookOnly);
  return part;
}

export function formattingGuide(): HTMLDivElement {
  const guide = el('div', 'fg-guide');
  const shapes = el('div', 'sg-list');
  shapes.append(...SHAPE_ENTRIES.map(shapeRow));
  guide.append(shapes, colourLabels());
  // Previews are samples: a link click never leaves Customize.
  guide.addEventListener('click', (event) => {
    if ((event.target as Element).closest('.sg-preview a')) event.preventDefault();
  });
  return guide;
}

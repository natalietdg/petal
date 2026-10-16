// Library: the domain knowledge Petal gathered from sessions, one note per topic, on a half dial.
// The dial's flat side sits on the left edge; the note at 3 o'clock is selected and previewed; Enter or a second click reads it.
// Sort and filter last for this window only.
import * as overlays from './overlays';
import * as tabs from './tabs';
import * as markdown from './markdown';
import * as customize from './customize';
import { byId, el, isIpcError } from './dom';
import {
  LIBRARY_SORTS, categoriesOf, filterEntries, letterOf, sortEntries,
  type LibraryEntry, type LibraryList, type LibrarySort,
} from '../shared/library';

const MAX_ANGLE = 72; // degrees above and below 3 o'clock that still show a note
const ITEM_GAP_PX = 44; // vertical room per note, so horizontal labels never overlap near the poles
const ARC_OUT = 18; // labels sit this far outside the rim
const WHEEL_STEP = 60; // wheel delta per note
const PAGE = 5;
const DRAG_START_PX = 4;

const view = byId('library');
view.tabIndex = -1;

// ---- Static frame: head, chips, note line, stage (dial + preview), and the reading pane.
const head = el('header', 'lib-head');
const title = el('h2', 'lib-title', 'Library');
const summary = el('p', 'lib-summary');
const tools = el('div', 'lib-tools');
const sortGroup = el('div', 'lib-sort');
sortGroup.setAttribute('role', 'group');
sortGroup.setAttribute('aria-label', 'Sort');
const search = el('input', 'lib-search');
Object.assign(search, { type: 'search', placeholder: 'Filter notes', spellcheck: false });
search.setAttribute('aria-label', 'Filter notes by words');
const addButton = el('button', 'lib-add', 'Add from this session');
addButton.type = 'button';
addButton.title = 'Read the active tab’s session now and add any new domain knowledge';
tools.append(sortGroup, search, addButton);
head.append(title, summary, tools);

const chips = el('div', 'lib-chips');
chips.setAttribute('role', 'group');
chips.setAttribute('aria-label', 'Category');
const noteLine = el('div', 'lib-note');
noteLine.setAttribute('role', 'status');

const stage = el('div', 'lib-stage');
const dial = el('div', 'lib-dial');
const disc = el('div', 'lib-disc');
disc.setAttribute('aria-hidden', 'true');
const rim = el('div', 'lib-rim');
rim.setAttribute('aria-hidden', 'true');
const pointer = el('div', 'lib-pointer');
pointer.setAttribute('aria-hidden', 'true');
const list = el('ul', 'lib-list');
list.id = 'library-list';
list.tabIndex = 0;
list.setAttribute('role', 'listbox');
list.setAttribute('aria-label', 'Library notes, turn with the arrow keys');
dial.append(disc, rim, pointer, list);
const preview = el('aside', 'lib-preview');
preview.setAttribute('aria-label', 'Selected note');
const empty = el('div', 'lib-empty');
stage.append(dial, preview, empty);

const reading = el('article', 'lib-reading');
reading.hidden = true;
reading.tabIndex = -1;

view.append(head, chips, noteLine, stage, reading);

// ---- State, per window.
let sort: LibrarySort = 'az';
let category: string | null = null;
let text = '';
let data: LibraryList | null = null;
let shown: LibraryEntry[] = [];
let selected = 0;
let pos = 0; // the dial's turn in notes, unbounded when it wraps; fractional only while dragging
let folderAllowed = true;
let status = ''; // the last Add from this session result
const rows = new Map<string, HTMLLIElement>(); // slug -> its option, kept across turns so they glide
const marks = new Map<string, HTMLElement>(); // rim letters and ticks

interface Geometry { radius: number; cy: number; labelWidth: number }
let geometry: Geometry = { radius: 200, cy: 240, labelWidth: 220 };

export const isOpen = (): boolean => overlays.isOpen('library');
export const isReading = (): boolean => !reading.hidden;
const selectedEntry = (): LibraryEntry | null => shown[selected] ?? null;
const optionId = (slug: string) => `library-option-${slug}`;

// ---- Geometry: the dial fills the stage's height, and shrinks with the window's width.
function measure(): void {
  const height = Math.max(320, stage.clientHeight);
  const width = Math.max(320, stage.clientWidth);
  const radius = Math.round(Math.max(120, Math.min(height / 2 - 30, width * 0.27, 300)));
  const labelWidth = Math.round(Math.max(150, Math.min(260, width * 0.25)));
  geometry = { radius, cy: height / 2, labelWidth };
  stage.style.setProperty('--dial-r', `${radius}px`);
  stage.style.setProperty('--dial-w', `${radius + 26 + Math.round(labelWidth * 1.16)}px`);
  stage.style.setProperty('--label-w', `${labelWidth}px`);
}

// Notes are spaced evenly in height and sit on the arc at that height, so labels never overlap.
const offsetOf = (index: number): number => (index - pos) * ITEM_GAP_PX;
const reach = (): number => (geometry.radius + ARC_OUT) * Math.sin((MAX_ANGLE * Math.PI) / 180);
const angleOf = (index: number): number => {
  const ratio = Math.max(-1, Math.min(1, offsetOf(index) / (geometry.radius + ARC_OUT)));
  return (Math.asin(ratio) * 180) / Math.PI;
};
const visible = (index: number): boolean => Math.abs(offsetOf(index)) <= reach();
const span = (): number => Math.ceil(reach() / ITEM_GAP_PX) + 1;
// A full dial wraps, Z back round to A, like a real wheel; a short list stops at its ends.
const wraps = (): boolean => shown.length > 2 * span() + 2;
const wrap = (k: number): number => ((k % shown.length) + shown.length) % shown.length;
// The turns in view: virtual positions k, each with its note's real index.
function inView(): { k: number; i: number }[] {
  const out: { k: number; i: number }[] = [];
  for (let k = Math.floor(pos) - span(); k <= Math.ceil(pos) + span(); k += 1) {
    if (!wraps() && (k < 0 || k >= shown.length)) continue;
    out.push({ k, i: wrap(k) });
  }
  return out;
}
const at = (angle: number, radius: number) => {
  const rad = (angle * Math.PI) / 180;
  return { x: radius * Math.cos(rad), y: geometry.cy + radius * Math.sin(rad) };
};

function makeRow(entry: LibraryEntry): HTMLLIElement {
  const row = el('li', 'lib-tab lib-enter');
  row.id = optionId(entry.slug);
  row.setAttribute('role', 'option');
  row.dataset.slug = entry.slug;
  row.append(el('span', 'lib-tab-name', entry.title), el('span', 'lib-tab-cat', entry.category));
  row.addEventListener('click', () => {
    if (dragMoved) return;
    const i = shown.findIndex((e) => e.slug === entry.slug);
    if (i === selected) void openDoc(entry.slug);
    else select(i);
  });
  return row;
}

// The rim: a tick per visible note, and the first note of each letter marked with that letter (A to Z sorts only).
function drawRim(): void {
  const { radius } = geometry;
  const want = new Map<string, { angle: number; letter?: string; current?: boolean }>();
  const lettered = sort !== 'recent';
  const current = selectedEntry() ? letterOf(selectedEntry()?.title ?? '') : '';
  for (const { k, i } of inView()) {
    if (!visible(k)) continue;
    const angle = angleOf(k);
    want.set(`t${k}`, { angle });
    const letter = letterOf(shown[i]?.title ?? '');
    if (lettered && (i === 0 || letterOf(shown[i - 1]?.title ?? '') !== letter)) want.set(`l${letter}`, { angle, letter, current: letter === current });
  }
  for (const [key, node] of marks) if (!want.has(key)) { node.remove(); marks.delete(key); }
  for (const [key, mark] of want) {
    let node = marks.get(key);
    if (!node) {
      node = el('span', mark.letter ? 'lib-letter lib-enter' : 'lib-tick lib-enter', mark.letter);
      marks.set(key, node);
      rim.append(node);
    }
    const p = at(mark.angle, mark.letter ? radius - 24 : radius - 7);
    node.style.transform = mark.letter
      ? `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`
      : `translate(${p.x}px, ${p.y}px) rotate(${mark.angle}deg)`;
    node.classList.toggle('current', Boolean(mark.current));
  }
}

// Places every note within reach of 3 o'clock on the arc; the rest leave the DOM.
function drawDial(): void {
  const { radius } = geometry;
  const keep = new Set<string>();
  for (const { k, i } of inView()) {
    const entry = shown[i];
    if (!entry) continue;
    if (!visible(k) && i !== selected) continue;
    const angle = angleOf(k);
    keep.add(entry.slug);
    let row = rows.get(entry.slug);
    if (!row) {
      row = makeRow(entry);
      rows.set(entry.slug, row);
      list.append(row);
    }
    const p = at(angle, radius + ARC_OUT);
    const isSelected = i === selected;
    const near = Math.abs(angle) <= 36;
    row.style.transform = `translate(${p.x}px, ${p.y}px) translateY(-50%) scale(${isSelected ? 1.16 : 1})`;
    row.classList.toggle('selected', isSelected);
    row.classList.toggle('far', !near && !isSelected);
    row.setAttribute('aria-selected', String(isSelected));
    row.setAttribute('aria-posinset', String(i + 1));
    row.setAttribute('aria-setsize', String(shown.length));
    row.setAttribute('aria-label', `${entry.title}, ${entry.category}`);
  }
  for (const [slug, row] of rows) if (!keep.has(slug)) { row.remove(); rows.delete(slug); }
  const current = selectedEntry();
  if (current) list.setAttribute('aria-activedescendant', optionId(current.slug));
  else list.removeAttribute('aria-activedescendant');
  drawRim();
  // New marks appear in place; only later turns glide.
  requestAnimationFrame(() => { for (const node of view.querySelectorAll('.lib-enter')) node.classList.remove('lib-enter'); });
}

const dateText = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function drawPreview(): void {
  const entry = selectedEntry();
  preview.replaceChildren();
  if (!entry) return;
  const meta = [`Updated ${dateText(entry.updated)}`, entry.sources ? `from ${plural(entry.sources, 'session')}` : ''].filter(Boolean).join(' · ');
  const facts = el('ul', 'lib-preview-facts');
  for (const line of entry.preview.split('\n').filter(Boolean)) facts.append(el('li', null, line));
  const read = el('button', 'lib-read', 'Read note');
  read.type = 'button';
  read.addEventListener('click', () => void openDoc(entry.slug));
  preview.append(
    el('span', 'lib-chip', entry.category),
    el('h3', 'lib-preview-title', entry.title),
    el('p', 'lib-preview-meta', meta),
    facts,
    read,
  );
}

function drawChips(all: readonly LibraryEntry[]): void {
  const counts = new Map<string, number>();
  for (const e of all) counts.set(e.category.toLowerCase(), (counts.get(e.category.toLowerCase()) ?? 0) + 1);
  const buttons = [null, ...categoriesOf(all)].map((name) => {
    const count = name ? counts.get(name.toLowerCase()) ?? 0 : all.length;
    const chip = el('button', 'lib-filter', `${name ?? 'All'} ${count}`);
    chip.type = 'button';
    chip.dataset.category = name ?? '';
    chip.setAttribute('aria-pressed', String((name ?? null)?.toLowerCase() === category?.toLowerCase() || (!name && !category)));
    chip.addEventListener('click', () => { category = name; refilter(); chips.querySelector<HTMLElement>(`[data-category="${CSS.escape(name ?? '')}"]`)?.focus(); });
    return chip;
  });
  chips.replaceChildren(...buttons);
  chips.hidden = all.length === 0;
}

function drawSort(): void {
  sortGroup.replaceChildren(...LIBRARY_SORTS.map(([id, label]) => {
    const button = el('button', 'lib-sort-button', label);
    button.type = 'button';
    button.dataset.sort = id;
    button.setAttribute('aria-pressed', String(id === sort));
    button.addEventListener('click', () => setSort(id));
    return button;
  }));
}

function drawNote(): void {
  noteLine.replaceChildren();
  if (!folderAllowed) {
    const allow = el('button', 'lib-link', 'Allow');
    allow.type = 'button';
    allow.addEventListener('click', () => window.dispatchEvent(new Event('petal:allow-folder')));
    noteLine.append(el('span', null, 'Petal isn’t reading your Claude folder, so it can’t add to your Library.'), allow);
  } else if (status) noteLine.append(el('span', null, status));
  else if (data && !data.autoBuild && data.entries.length) {
    const turnOn = el('button', 'lib-link', 'Turn it on');
    turnOn.type = 'button';
    turnOn.addEventListener('click', () => void customize.open('organizer'));
    noteLine.append(el('span', null, 'Build my Library is off, so only Add from this session adds notes.'), turnOn);
  }
  noteLine.hidden = !noteLine.childElementCount;
}

function drawEmpty(): void {
  const all = data?.entries ?? [];
  empty.replaceChildren();
  const none = !shown.length;
  stage.classList.toggle('is-empty', none);
  empty.hidden = !none;
  if (!none) return;
  if (!data) { empty.append(el('p', 'lib-empty-text', 'Opening your Library…')); return; }
  if (all.length) {
    empty.append(el('p', 'lib-empty-title', 'Nothing matches'), el('p', 'lib-empty-text', 'Try another category or fewer words.'));
    return;
  }
  empty.append(el('p', 'lib-empty-title', 'Your Library is empty'));
  if (!folderAllowed) {
    empty.append(el('p', 'lib-empty-text', 'Petal gathers domain knowledge from your Claude sessions: how systems, rules and terms work. It needs to read your Claude folder first.'));
    const allow = el('button', 'lib-read', 'Allow reading your Claude folder');
    allow.type = 'button';
    allow.addEventListener('click', () => window.dispatchEvent(new Event('petal:allow-folder')));
    empty.append(allow);
    return;
  }
  empty.append(el('p', 'lib-empty-text', data.autoBuild
    ? 'Petal adds domain knowledge here after each session ends: how systems, rules and terms work. Nothing yet.'
    : 'Turn on Build my Library and Petal adds domain knowledge here after each session ends. It uses your Claude plan. Or add the active session now.'));
  if (!data.autoBuild) {
    const turnOn = el('button', 'lib-read', 'Open the setting');
    turnOn.type = 'button';
    turnOn.addEventListener('click', () => void customize.open('organizer'));
    empty.append(turnOn);
  }
}

function drawSummary(): void {
  const all = data?.entries ?? [];
  const cats = categoriesOf(all).length;
  summary.textContent = all.length ? `${plural(all.length, 'note')} · ${plural(cats, 'category').replace('categorys', 'categories')}${data?.running ? ' · adding…' : ''}` : '';
  const live = Boolean(tabs.active()?.update?.sessionId);
  addButton.disabled = !folderAllowed || !live;
  addButton.title = !folderAllowed ? 'Allow reading your Claude folder first' : live ? 'Read the active tab’s session now and add any new domain knowledge' : 'The active tab has no Claude session';
}

function drawAll(): void {
  measure();
  drawSort();
  drawChips(data?.entries ?? []);
  drawSummary();
  drawNote();
  drawEmpty();
  drawDial();
  drawPreview();
}

// Sort, then filter; keeps the selected note when it is still shown.
function refilter(keepSlug = selectedEntry()?.slug): void {
  shown = filterEntries(sortEntries(data?.entries ?? [], sort), { category, text });
  const index = keepSlug ? shown.findIndex((e) => e.slug === keepSlug) : -1;
  selected = index === -1 ? 0 : index;
  pos = selected;
  for (const row of rows.values()) row.remove(); // a new order starts fresh, without gliding across the dial
  rows.clear();
  for (const mark of marks.values()) mark.remove();
  marks.clear();
  drawAll();
}

export function setSort(next: LibrarySort): void {
  sort = next;
  refilter(sort === 'recent' ? undefined : selectedEntry()?.slug);
}

function turnTo(virtual: number): void {
  if (!shown.length) return;
  pos = wraps() ? virtual : Math.max(0, Math.min(shown.length - 1, virtual));
  selected = wrap(Math.round(pos));
  drawDial();
  drawPreview();
}

// By notes from where the dial rests; wraps past the ends on a full dial.
const turnBy = (notes: number): void => turnTo(Math.round(pos) + notes);

// A note by its place in the list, reached the short way round.
export function select(index: number): void {
  if (!shown.length) return;
  const target = Math.max(0, Math.min(shown.length - 1, index));
  const base = Math.round(pos);
  let delta = target - wrap(base);
  if (wraps() && delta > shown.length / 2) delta -= shown.length;
  if (wraps() && delta < -shown.length / 2) delta += shown.length;
  turnTo(base + delta);
}

// ---- Reading a note: rendered like a reply, read-only, with a way back.
export async function openDoc(slug: string): Promise<void> {
  const doc = await window.pastel.library.read(slug);
  const back = el('button', 'lib-back', '← Back to Library');
  back.type = 'button';
  back.addEventListener('click', closeDoc);
  if (isIpcError(doc) || 'missing' in doc) {
    reading.replaceChildren(back, el('p', 'lib-empty-text', 'That note couldn’t be opened. It may have been moved or be too large.'));
  } else {
    const header = el('header', 'lib-reading-head');
    const meta = [`Updated ${dateText(doc.updated)}`, doc.sources.length ? `from ${plural(doc.sources.length, 'session')}` : ''].filter(Boolean).join(' · ');
    header.append(el('span', 'lib-chip', doc.category), el('h1', 'lib-reading-title', doc.title), el('p', 'lib-preview-meta', meta));
    const column = el('div', 'reader-column lib-reading-column');
    column.append(header, markdown.render(doc.markdown));
    reading.replaceChildren(back, column);
  }
  reading.dataset.slug = slug;
  for (const part of [head, chips, noteLine, stage]) part.hidden = true;
  reading.hidden = false;
  reading.scrollTop = 0;
  back.focus();
}

export function closeDoc(): void {
  if (reading.hidden) return;
  reading.hidden = true;
  head.hidden = false;
  chips.hidden = !(data?.entries.length);
  stage.hidden = false;
  drawAll();
  list.focus();
}

// ---- Input: keys, wheel, drag.
list.addEventListener('keydown', (event) => {
  const turns: Record<string, number> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1, PageDown: PAGE, PageUp: -PAGE };
  const ends: Record<string, number> = { Home: 0, End: shown.length - 1 };
  if (turns[event.key] !== undefined || ends[event.key] !== undefined) {
    event.preventDefault();
    if (turns[event.key] !== undefined) turnBy(turns[event.key] ?? 0);
    else select(ends[event.key] ?? 0);
    return;
  }
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    const entry = selectedEntry();
    if (entry) void openDoc(entry.slug);
    return;
  }
  // A letter jumps to the next note starting with it.
  if (/^[a-z0-9]$/i.test(event.key) && !event.metaKey && !event.ctrlKey && !event.altKey) {
    const key = event.key.toUpperCase();
    const order = shown.map((_, i) => (selected + 1 + i) % shown.length);
    const hit = order.find((i) => (shown[i]?.title.trim().charAt(0).toUpperCase() ?? '') === key);
    if (hit !== undefined) { event.preventDefault(); select(hit); }
  }
});

let wheelSum = 0;
dial.addEventListener('wheel', (event) => {
  event.preventDefault();
  wheelSum += event.deltaY;
  const notes = Math.trunc(wheelSum / WHEEL_STEP);
  if (!notes) return;
  wheelSum -= notes * WHEEL_STEP;
  turnBy(notes);
}, { passive: false });

// Dragging turns the dial with the pointer, a note per ITEM_GAP_PX; letting go settles on the nearest note.
let drag: { id: number; startPos: number; x: number; y: number } | null = null;
let dragMoved = false;
dial.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || !shown.length) return;
  drag = { id: event.pointerId, startPos: pos, x: event.clientX, y: event.clientY };
  dragMoved = false;
});
dial.addEventListener('pointermove', (event) => {
  if (!drag || event.pointerId !== drag.id) return;
  if (!dragMoved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < DRAG_START_PX) return;
  if (!dragMoved) { dragMoved = true; dial.setPointerCapture(event.pointerId); dial.classList.add('dragging'); }
  const turned = drag.startPos - (event.clientY - drag.y) / ITEM_GAP_PX;
  pos = wraps() ? turned : Math.max(0, Math.min(shown.length - 1, turned));
  selected = wrap(Math.round(pos));
  drawDial();
});
const endDrag = (event: PointerEvent) => {
  if (!drag || event.pointerId !== drag.id) return;
  drag = null;
  dial.classList.remove('dragging');
  if (dragMoved) { turnTo(Math.round(pos)); list.focus(); }
  setTimeout(() => { dragMoved = false; }, 0); // the click that ends a drag is not a pick
};
dial.addEventListener('pointerup', endDrag);
dial.addEventListener('pointercancel', endDrag);

let searchTimer: ReturnType<typeof setTimeout> | undefined;
search.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { text = search.value; refilter(); }, 120);
});

addButton.addEventListener('click', async () => {
  const tab = tabs.active();
  if (!tab) return;
  addButton.disabled = true;
  status = 'Reading this session for domain knowledge…';
  drawNote();
  const result = await window.pastel.library.addSession(tab.id);
  if (isIpcError(result)) {
    console.error('[petal] library add failed:', result.error); // the raw error stays out of the page
    status = 'Couldn’t read this session. Try again after Claude’s next reply.';
  }
  else if (result.skipped) status = `Nothing added: ${result.skipped}.`;
  else if (!result.added && !result.updated) status = 'No new domain knowledge in this session since it was last read.';
  else status = [result.added ? `Added ${plural(result.added, 'note')}` : '', result.updated ? `updated ${plural(result.updated, 'note')}` : ''].filter(Boolean).join(', ').replace(/^u/, 'U') + '.';
  await load();
});

// Esc while reading goes back to the dial; Esc on the dial closes the Library (overlays.ts).
view.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || reading.hidden) return;
  event.stopImmediatePropagation();
  closeDoc();
}, true);

// A resize redraws in place; only turns glide.
new ResizeObserver(() => {
  if (!isOpen() || stage.hidden) return;
  dial.classList.add('dragging');
  measure();
  drawDial();
  requestAnimationFrame(() => { if (!drag) dial.classList.remove('dragging'); });
}).observe(stage);

// ---- Open, close, refresh.
export async function load(): Promise<void> {
  const result = await window.pastel.library.list();
  data = isIpcError(result) ? { allowed: folderAllowed, autoBuild: false, running: false, entries: [] } : result;
  if (!isIpcError(result)) folderAllowed = result.allowed;
  if (!reading.hidden) return;
  refilter();
}

export async function open(): Promise<void> {
  if (!overlays.show('library')) return;
  status = '';
  search.value = text;
  closeDoc();
  drawAll();
  await load();
  list.focus();
}

export const close = (): void => overlays.hide('library');
export const toggle = (): void => { if (isOpen()) close(); else void open(); };

export function setFolderAllowed(allowed: boolean): void {
  folderAllowed = allowed;
  if (isOpen()) void load();
}

export const state = () => ({ sort, category, text, selected, shown: shown.map((e) => e.title) });

window.pastel.library.onChanged(() => { if (isOpen()) void load(); });
byId('library-button').addEventListener('click', toggle);

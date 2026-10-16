// Library: the domain knowledge Petal gathered from sessions, one note per topic, on a half dial.
// The dial's flat side sits on the left edge; the note at 3 o'clock is selected and previewed; Enter or a second click reads it.
// Sort and filter last for this window only. Each category keeps one theme hue (categoryHue), on its tabs, rim and chip.
// Read past sessions feeds older logs through the same queue in main; its progress outlives the overlay.
import * as overlays from './overlays';
import * as markdown from './markdown';
import * as customize from './customize';
import { byId, el, isIpcError } from './dom';
import { OPEN_NOTE_EVENT } from './conclusion-banner';
import {
  BACKFILL_RANGES, IDLE_BACKFILL, LIBRARY_SORTS, categoriesOf, categoryHue, filterEntries, letterOf, rangeText, sortEntries,
  type BackfillDays, type BackfillPlan, type BackfillState, type LibraryEntry, type LibraryList, type LibrarySort,
} from '../shared/library';
import { aliasesFrom, likeness } from '../shared/library-titles';

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
const pastButton = el('button', 'lib-add lib-past', 'Read past sessions');
pastButton.type = 'button';
tools.append(sortGroup, search, pastButton);
const progress = el('p', 'lib-progress');
progress.setAttribute('role', 'status');
head.append(title, summary, progress, tools);

// Read past sessions asks first: how many, about how many calls, and which range.
const confirmBox = el('section', 'lib-confirm');
confirmBox.setAttribute('aria-label', 'Read past sessions');
confirmBox.hidden = true;

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

view.append(head, confirmBox, chips, noteLine, stage, reading);

// ---- State, per window.
let sort: LibrarySort = 'az';
let category: string | null = null;
let text = '';
let data: LibraryList | null = null;
let shown: LibraryEntry[] = [];
let selected = 0;
let pos = 0; // the dial's turn in notes, unbounded when it wraps; fractional only while dragging
let folderAllowed = true;
let status = ''; // the last Read past sessions result
let backfill: BackfillState = { ...IDLE_BACKFILL };
let confirmDays: BackfillDays = 30;
let plan: BackfillPlan | { skipped: string } | null = null;
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
  stage.style.setProperty('--dial-w', `${radius + 26 + Math.round((labelWidth + 60) * 1.16)}px`); // the selected tab is 60px wider
  stage.style.setProperty('--label-w', `${labelWidth}px`);
}

// Notes are spaced evenly in height and sit on the arc at that height, so labels never overlap.
const offsetOf = (index: number, at = pos): number => (index - at) * ITEM_GAP_PX;
const reach = (): number => (geometry.radius + ARC_OUT) * Math.sin((MAX_ANGLE * Math.PI) / 180);
const angleOf = (index: number, at = pos): number => {
  const ratio = Math.max(-1, Math.min(1, offsetOf(index, at) / (geometry.radius + ARC_OUT)));
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
  row.dataset.hue = categoryHue(entry.category);
  row.title = `${entry.title} · ${entry.category}`;
  row.append(el('span', 'lib-tab-name', entry.title), el('span', 'lib-tab-cat', entry.category));
  row.addEventListener('click', () => {
    if (dragMoved) return;
    const i = shown.findIndex((e) => e.slug === entry.slug);
    if (i === selected) void openDoc(entry.slug);
    else select(i);
  });
  return row;
}

// The rim: a coloured band segment and a tick per visible note, so the dial reads as sectors by category,
// and the first note of each letter marked with that letter (A to Z sorts only).
const SEG_DEPTH = 12; // px of band inside the rim
function drawRim(): void {
  const { radius } = geometry;
  const want = new Map<string, { angle: number; kind: 'tick' | 'letter' | 'seg'; letter?: string; current?: boolean; hue?: string; length?: number }>();
  const lettered = sort !== 'recent';
  const current = selectedEntry() ? letterOf(selectedEntry()?.title ?? '') : '';
  const bandRadius = radius - SEG_DEPTH;
  for (const { k, i } of inView()) {
    if (!visible(k)) continue;
    const angle = angleOf(k);
    const hue = categoryHue(shown[i]?.category ?? '');
    const sweep = ((angleOf(k + 0.5) - angleOf(k - 0.5)) * Math.PI) / 180;
    want.set(`s${k}`, { angle, kind: 'seg', hue, length: Math.max(4, sweep * bandRadius - 2) });
    want.set(`t${k}`, { angle, kind: 'tick', hue });
    const letter = letterOf(shown[i]?.title ?? '');
    if (lettered && (i === 0 || letterOf(shown[i - 1]?.title ?? '') !== letter)) want.set(`l${letter}`, { angle, kind: 'letter', letter, current: letter === current, hue });
  }
  for (const [key, node] of marks) if (!want.has(key)) { node.remove(); marks.delete(key); }
  for (const [key, mark] of want) {
    let node = marks.get(key);
    if (!node) {
      node = el('span', `lib-${mark.kind} lib-enter`, mark.letter);
      marks.set(key, node);
      rim.append(node);
    }
    if (mark.hue) node.dataset.hue = mark.hue;
    if (mark.kind === 'seg') node.style.setProperty('--seg-h', `${(mark.length ?? 4).toFixed(1)}px`);
    const p = at(mark.angle, mark.kind === 'letter' ? radius - 24 : mark.kind === 'seg' ? bandRadius : radius - 7);
    node.style.transform = mark.kind === 'letter'
      ? `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`
      : `translate(${p.x}px, ${p.y}px) rotate(${mark.angle}deg)`;
    node.classList.toggle('current', Boolean(mark.current));
  }
}

// The disc's body: one slice per note in its category colour, thin rule lines between, the selected slice lit.
// Drawn as a conic gradient from the hub; it eases to the dial's turn with the tabs (SECTOR_MS, as in library.css).
const SECTOR_MS = 260;
const SECTOR_GAP_DEG = 0.5;
let sectorPos = 0;
let sectorFrame = 0;

function sectorsAt(at: number): string {
  const stops: string[] = [];
  let edge = 0; // conic degrees, 0 at 12 o'clock, clockwise; 3 o'clock is 90
  for (let k = Math.floor(at) - span(); k <= Math.ceil(at) + span(); k += 1) {
    if (!wraps() && (k < 0 || k >= shown.length)) continue;
    const entry = shown[wrap(k)];
    if (!entry) continue;
    const from = 90 + angleOf(k - 0.5, at);
    const to = 90 + angleOf(k + 0.5, at);
    if (to - from < 0.2) continue; // squeezed flat at the poles
    const lit = wrap(k) === selected && Math.abs(k - Math.round(pos)) < shown.length / 2 ? '-on' : '';
    stops.push(`${stops.length ? 'var(--rule)' : 'transparent'} ${edge}deg ${from}deg`, `var(--sector-${categoryHue(entry.category)}${lit}) ${from + SECTOR_GAP_DEG / 2}deg ${to - SECTOR_GAP_DEG / 2}deg`);
    edge = to - SECTOR_GAP_DEG / 2;
  }
  if (!stops.length) return 'none';
  stops.push(`transparent ${edge}deg 360deg`);
  return `conic-gradient(from 0deg at 0 50%, ${stops.join(', ')})`;
}

function drawSectors(): void {
  cancelAnimationFrame(sectorFrame);
  disc.dataset.hue = selectedEntry() ? categoryHue(selectedEntry()?.category ?? '') : '';
  const paint = (at: number) => disc.style.setProperty('--sectors', sectorsAt(at));
  const instant = dial.classList.contains('dragging') || !shown.length || matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (instant || Math.abs(sectorPos - pos) > shown.length / 2) { sectorPos = pos; paint(pos); return; }
  const from = sectorPos;
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / SECTOR_MS);
    const eased = 1 - (1 - t) ** 3;
    sectorPos = from + (pos - from) * eased;
    paint(sectorPos);
    if (t < 1) sectorFrame = requestAnimationFrame(step);
  };
  sectorFrame = requestAnimationFrame(step);
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
  drawSectors();
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
  preview.dataset.hue = entry ? categoryHue(entry.category) : '';
  if (!entry) return;
  const meta = [`Updated ${dateText(entry.updated)}`, entry.sources ? `from ${plural(entry.sources, 'session')}` : ''].filter(Boolean).join(' · ');
  const facts = el('ul', 'lib-preview-facts');
  for (const line of entry.preview.split('\n').filter(Boolean)) facts.append(el('li', null, line));
  const read = el('button', 'lib-read', 'Read note');
  read.type = 'button';
  read.addEventListener('click', () => void openDoc(entry.slug));
  const chip = el('span', 'lib-chip', entry.category);
  chip.dataset.hue = categoryHue(entry.category);
  preview.append(
    chip,
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
    if (name) { chip.dataset.hue = categoryHue(name); chip.prepend(el('span', 'lib-dot')); } // the chips double as the colour legend
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
    noteLine.append(el('span', null, 'Build my Library is off, so notes come only from Add to Library and Read past sessions.'), turnOn);
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
    : 'Turn on Build my Library and Petal adds domain knowledge here after each session ends. It uses your Claude plan. Or read your past sessions now.'));
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
  tidyButton.disabled = (data?.entries.length ?? 0) < 2;
  pastButton.disabled = !folderAllowed || backfill.running;
  pastButton.title = !folderAllowed ? 'Allow reading your Claude folder first'
    : backfill.running ? 'Already reading past sessions' : 'Read your past Claude sessions for domain knowledge';
  drawProgress();
}

// ---- Read past sessions: the header line while it runs, the confirm before it starts.
function drawProgress(): void {
  progress.replaceChildren();
  progress.hidden = !backfill.running;
  if (!backfill.running) return;
  const shownDone = Math.min(backfill.total, backfill.done + 1); // the one being read counts
  if (backfill.stopping) { progress.append(el('span', null, `Reading past sessions: ${shownDone} of ${backfill.total} · stopping after this one`)); return; }
  const stop = el('button', 'lib-link lib-stop', 'Stop');
  stop.type = 'button';
  stop.addEventListener('click', () => void window.pastel.library.backfillStop());
  progress.append(el('span', null, `Reading past sessions: ${shownDone} of ${backfill.total} · `), stop);
}

function confirmText(): string {
  if (!plan) return 'Counting your sessions…';
  if ('skipped' in plan) return `Can’t read past sessions: ${plan.skipped}.`;
  if (!plan.sessions) return `Nothing new to read ${rangeText(plan.days)}.`;
  return `Read ${plural(plan.sessions, 'session')} ${rangeText(plan.days)}? This uses your Claude plan, about ${plural(plan.calls, 'call')}.`;
}

function drawConfirm(): void {
  confirmBox.replaceChildren();
  const ranges = el('div', 'lib-sort lib-range');
  ranges.setAttribute('role', 'group');
  ranges.setAttribute('aria-label', 'Which sessions');
  for (const [days, label] of BACKFILL_RANGES) {
    const button = el('button', 'lib-sort-button', label);
    button.type = 'button';
    button.dataset.days = String(days);
    button.setAttribute('aria-pressed', String(days === confirmDays));
    button.addEventListener('click', () => { void choosePlan(days); });
    ranges.append(button);
  }
  const go = el('button', 'lib-read lib-confirm-go', 'Read them');
  go.type = 'button';
  go.disabled = !plan || 'skipped' in plan || !plan.sessions;
  go.addEventListener('click', () => void startBackfill());
  const cancel = el('button', 'lib-confirm-cancel', 'Cancel');
  cancel.type = 'button';
  cancel.addEventListener('click', closeConfirm);
  const actions = el('div', 'lib-confirm-actions');
  actions.append(go, cancel);
  confirmBox.append(el('p', 'lib-confirm-text', confirmText()), ranges, actions);
}

async function choosePlan(days: BackfillDays): Promise<void> {
  confirmDays = days;
  plan = null;
  drawConfirm();
  const result = await window.pastel.library.backfillPlan(days);
  if (days !== confirmDays) return; // another range was picked meanwhile
  plan = isIpcError(result) ? { skipped: 'something went wrong counting them' } : result;
  drawConfirm();
  confirmBox.querySelector<HTMLElement>(`[data-days="${days}"]`)?.focus();
}

function openConfirm(): void {
  tidyBox.hidden = true;
  confirmBox.hidden = false;
  void choosePlan(30);
}

function closeConfirm(): void {
  confirmBox.hidden = true;
  pastButton.focus();
}

async function startBackfill(): Promise<void> {
  const result = await window.pastel.library.backfillStart(confirmDays);
  confirmBox.hidden = true;
  if (isIpcError(result)) { status = 'Couldn’t start reading past sessions.'; drawNote(); return; }
  if ('skipped' in result) { status = `Nothing read: ${result.skipped}.`; drawNote(); return; }
  setBackfill(result);
}

// What a finished run says on the note line.
function backfillDoneText(state: BackfillState): string {
  if (state.note) return `Stopped reading past sessions: ${state.note}.`;
  const found = state.added || state.updated
    ? [state.added ? `added ${plural(state.added, 'note')}` : '', state.updated ? `updated ${state.updated}` : ''].filter(Boolean).join(', ')
    : 'no new domain knowledge';
  const read = state.done < state.total ? `Stopped after ${state.done} of ${state.total} past sessions` : `Read ${plural(state.done, 'past session')}`;
  return `${read}: ${found}.`;
}

function setBackfill(next: BackfillState): void {
  const finished = backfill.running && !next.running;
  backfill = next;
  if (finished) status = backfillDoneText(next);
  if (!isOpen()) return;
  drawSummary();
  if (finished) drawNote();
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
    const chip = el('span', 'lib-chip', doc.category);
    chip.dataset.hue = categoryHue(doc.category);
    header.append(chip, el('h1', 'lib-reading-title', doc.title), el('p', 'lib-preview-meta', meta), manageBar(doc.slug, doc.title, doc.category));
    const column = el('div', 'reader-column lib-reading-column');
    column.append(header, markdown.render(doc.markdown));
    reading.replaceChildren(back, column);
  }
  reading.dataset.slug = slug;
  for (const part of [head, confirmBox, tidyBox, chips, noteLine, stage]) part.hidden = true;
  reading.hidden = false;
  reading.scrollTop = 0;
  back.focus();
}

// ---- Managing a note from its reading view: Rename, Change category, Merge into, Delete (to the trash, with Undo).
const TOAST_MS = 8000;
const toast = el('div', 'lib-toast');
toast.setAttribute('role', 'status');
toast.hidden = true;
view.append(toast);
let toastTimer: ReturnType<typeof setTimeout> | undefined;

function showToast(text: string, undo?: () => void): void {
  clearTimeout(toastTimer);
  toast.replaceChildren(el('span', null, text));
  if (undo) {
    const button = el('button', 'lib-link lib-undo', 'Undo');
    button.type = 'button';
    button.addEventListener('click', () => { toast.hidden = true; undo(); });
    toast.append(button);
  }
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, TOAST_MS);
}

const editError = (result: unknown): string | null => {
  if (isIpcError(result)) { console.error('[petal] library edit failed:', result.error); return 'That didn’t work. Try again.'; }
  return result && typeof result === 'object' && 'error' in result ? String((result as { error: string }).error) : null;
};

function manageBar(slug: string, title: string, category: string): HTMLElement {
  const bar = el('div', 'lib-manage');
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Manage this note');
  const editor = el('div', 'lib-manage-edit');
  editor.hidden = true;
  const button = (label: string, onClick: () => void) => {
    const b = el('button', 'lib-manage-button', label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  };
  // One small form at a time under the buttons: a field or a picker, then Save and Cancel.
  const openEditor = (field: HTMLInputElement | HTMLSelectElement, hint: string, save: () => Promise<void>) => {
    const ok = button('Save', () => void save());
    ok.classList.add('lib-manage-save');
    const cancel = button('Cancel', () => { editor.hidden = true; });
    const note = el('p', 'lib-manage-hint', hint);
    field.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Enter') { event.preventDefault(); void save(); }
    });
    editor.replaceChildren(field, ok, cancel, note);
    editor.hidden = false;
    field.focus();
  };
  const finish = async (result: unknown, toastText: string, undo?: () => void) => {
    const error = editError(result);
    if (error) { editor.querySelector('.lib-manage-hint')?.replaceChildren(error); return; }
    const next = (result as { slug: string }).slug;
    await load();
    showToast(toastText, undo);
    if (next && next !== slug) await openDoc(next);
    else if (next) await openDoc(slug);
  };

  const rename = button('Rename', () => {
    const input = el('input', 'lib-manage-input');
    Object.assign(input, { type: 'text', value: title, maxLength: 80, spellcheck: true });
    input.setAttribute('aria-label', 'New title');
    openEditor(input, 'The note keeps its facts and sources.', async () => {
      if (!input.value.trim() || input.value.trim() === title) { editor.hidden = true; return; }
      await finish(await window.pastel.library.rename(slug, input.value), `Renamed to “${input.value.trim()}”.`);
    });
  });
  const recategorize = button('Change category', () => {
    const input = el('input', 'lib-manage-input');
    const options = el('datalist');
    options.id = 'lib-category-options';
    for (const name of categoriesOf(data?.entries ?? [])) { const o = el('option'); o.value = name; options.append(o); }
    Object.assign(input, { type: 'text', value: category, maxLength: 32 });
    input.setAttribute('list', options.id);
    input.setAttribute('aria-label', 'Category');
    openEditor(input, 'Pick one in use or type a new one.', async () => {
      if (!input.value.trim() || input.value.trim() === category) { editor.hidden = true; return; }
      const result = await window.pastel.library.recategorize(slug, input.value);
      const saved = !isIpcError(result) && 'slug' in result ? (await window.pastel.library.read(result.slug)) : null;
      await finish(result, `Moved to ${saved && !isIpcError(saved) && 'category' in saved ? saved.category : input.value.trim()}.`);
    });
    editor.append(options);
  });
  const merge = button('Merge into…', () => {
    const picker = el('select', 'lib-manage-input');
    picker.setAttribute('aria-label', 'Merge into which note');
    // Likely duplicates first, then the rest of its category, then everything else.
    const aliases = aliasesFrom((data?.entries ?? []).map((e) => e.title));
    const rank = (e: LibraryEntry) => (likeness(title, e.title, aliases) ? 0 : e.category === category ? 1 : 2);
    const others = (data?.entries ?? []).filter((e) => e.slug !== slug)
      .sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title));
    for (const entry of others) { const o = el('option', null, `${entry.title} (${entry.category})`); o.value = entry.slug; picker.append(o); }
    openEditor(picker, 'This note’s facts and sources move into the one picked; this one goes to the trash.', async () => {
      const into = others.find((e) => e.slug === picker.value);
      if (!into) return;
      await finish(await window.pastel.library.merge(slug, into.slug), `Merged into “${into.title}”. The old note is in the trash.`);
    });
  });
  const remove = button('Delete', async () => {
    const result = await window.pastel.library.remove(slug);
    const error = editError(result);
    if (error) { showToast(error); return; }
    const trashId = (result as { trashId?: string }).trashId;
    closeDoc();
    await load();
    showToast(`Deleted “${title}”.`, trashId ? () => void window.pastel.library.restore(trashId).then(() => load()) : undefined);
  });
  remove.classList.add('lib-manage-delete');
  bar.append(rename, recategorize, merge, remove, editor);
  return bar;
}

// ---- Tidy duplicates: pairs Petal finds by title (shared/library-titles.ts), each merged only on her click.
const tidyButton = el('button', 'lib-add lib-tidy-open', 'Tidy duplicates');
tidyButton.type = 'button';
tidyButton.title = 'Find notes that look like the same topic';
tools.insertBefore(tidyButton, pastButton);
const tidyBox = el('section', 'lib-confirm lib-tidy');
tidyBox.setAttribute('aria-label', 'Tidy duplicates');
tidyBox.hidden = true;
head.after(tidyBox);

async function openTidy(): Promise<void> {
  confirmBox.hidden = true;
  tidyBox.hidden = false;
  tidyBox.replaceChildren(el('p', 'lib-confirm-text', 'Looking for duplicates…'));
  const pairs = await window.pastel.library.duplicates();
  const list = el('ul', 'lib-tidy-list');
  const close = el('button', 'lib-confirm-cancel', 'Done');
  close.type = 'button';
  close.addEventListener('click', () => { tidyBox.hidden = true; tidyButton.focus(); });
  const intro = el('p', 'lib-confirm-text');
  const count = () => {
    const left = list.childElementCount;
    intro.textContent = left ? `${plural(left, 'pair')} of notes look like the same topic. Nothing merges until you choose.` : 'No likely duplicates left.';
  };
  for (const { keep, fold } of isIpcError(pairs) ? [] : pairs) {
    const row = el('li', 'lib-tidy-row');
    row.dataset.hue = categoryHue(keep.category);
    const names = el('p', 'lib-tidy-names');
    names.append(el('strong', null, fold.title), el('span', 'lib-tidy-and', ' and '), el('strong', null, keep.title), el('span', 'lib-tidy-cat', ` · ${keep.category}`));
    const mergeButton = el('button', 'lib-read lib-tidy-merge', `Merge into “${keep.title}”`);
    mergeButton.type = 'button';
    mergeButton.addEventListener('click', async () => {
      const result = await window.pastel.library.merge(fold.slug, keep.slug);
      const error = editError(result);
      if (error) { showToast(error); return; }
      row.remove();
      count();
      await load();
      showToast(`Merged “${fold.title}” into “${keep.title}”. The old note is in the trash.`);
    });
    const keepButton = el('button', 'lib-confirm-cancel lib-tidy-keep', 'Keep both');
    keepButton.type = 'button';
    keepButton.addEventListener('click', async () => { await window.pastel.library.keepBoth(fold.slug, keep.slug); row.remove(); count(); });
    const actions = el('div', 'lib-confirm-actions');
    actions.append(mergeButton, keepButton);
    row.append(names, actions);
    list.append(row);
  }
  count();
  tidyBox.replaceChildren(intro, list, close);
}
tidyButton.addEventListener('click', () => { if (tidyBox.hidden) void openTidy(); else tidyBox.hidden = true; });

export function closeDoc(): void {
  if (reading.hidden) return;
  reading.hidden = true;
  head.hidden = false;
  chips.hidden = !(data?.entries.length);
  stage.hidden = false;
  refilter(); // notes may have changed while reading (load skips the dial then)
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

pastButton.addEventListener('click', () => { if (confirmBox.hidden) openConfirm(); else closeConfirm(); });

// Esc while reading goes back to the dial, and closes the confirm; Esc on the dial closes the Library (overlays.ts).
view.addEventListener('keydown', (event) => {
  const editing = (event.target as HTMLElement | null)?.closest?.('.lib-manage-edit');
  if (event.key === 'Escape' && editing) { event.stopImmediatePropagation(); (editing as HTMLElement).hidden = true; return; }
  if (event.key === 'Escape' && !tidyBox.hidden && reading.hidden) { event.stopImmediatePropagation(); tidyBox.hidden = true; return; }
  if (event.key === 'Escape' && !confirmBox.hidden && reading.hidden) { event.stopImmediatePropagation(); closeConfirm(); return; }
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
  if (!backfill.running) status = '';
  confirmBox.hidden = true;
  tidyBox.hidden = true;
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

export const state = () => ({ sort, category, text, selected, shown: shown.map((e) => e.title), backfill: { ...backfill }, confirm: confirmBox.hidden ? '' : confirmText(),
  tidy: tidyBox.hidden ? null : [...tidyBox.querySelectorAll('.lib-tidy-names')].map((n) => n.textContent ?? ''), toast: toast.hidden ? '' : toast.textContent ?? '' });

window.pastel.library.onChanged(() => { if (isOpen()) void load(); });
window.pastel.library.onBackfill(setBackfill);
void window.pastel.library.backfillState().then((result) => { if (!isIpcError(result)) setBackfill(result); });
byId('library-button').addEventListener('click', toggle);
// A note named in a conclusion's This session line; no slug opens the Library's list.
window.addEventListener(OPEN_NOTE_EVENT, (event) => {
  const slug = (event as CustomEvent<string | null>).detail;
  void open().then(() => (slug && isOpen() ? openDoc(slug) : undefined));
});

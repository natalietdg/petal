// A 20x20 pixel pet in the reader's corner: eyes shut and dozing when Claude rests, playing when it works.
// Each cat has her own coat, her own prop and her own busy move.
import * as scenes from './scenes';
import { byId, el, isIpcError, query } from './dom';
import { CATS, EYES_CLOSED, PROPS, SITTING, TAIL_DOWN, TAIL_UP, spriteCols, spriteRows, type Line, type Pet, type Prop } from './cat-art';
import { LOCAL_CATS } from '../shared/local-cats';
import { PET_SCALE, isPetSize } from '../shared/pet-size';

// Built-in cats plus any private ones from cats-local/, each with her toy and her own stylesheet.
const ALL_CATS: Readonly<Record<string, Pet>> = { ...CATS, ...Object.fromEntries(LOCAL_CATS.map(({ id, pet }) => [id, pet])) };
const ALL_PROPS: Readonly<Record<string, Prop>> = { ...PROPS, ...Object.fromEntries(LOCAL_CATS.map(({ id, prop }) => [id, prop])) };
for (const { css } of LOCAL_CATS) if (css) document.head.append(el('style', null, css));
const isCatId = (id: string): boolean => Object.hasOwn(ALL_CATS, id);

// The eye sparkle (W) sits in the pupil at 2/3 size: 2px at 3px per pixel, so it stays crisp.
const SPARKLE = 2 / 3;
const rect = (x: number, y: number, cell: string): string => (cell === 'W'
  ? `<rect x="${x}" y="${y}" width="1" height="1" class="px-O"/><rect x="${x}" y="${y}" width="${SPARKLE}" height="${SPARKLE}" class="px-W"/>`
  : `<rect x="${x}" y="${y}" width="1" height="1" class="px-${cell}"/>`);
const rects = (rows: readonly string[], offset = 0): string => rows.flatMap((row, y) => [...row].flatMap((cell, x) => (
  cell === '.' ? [] : [rect(x, y + offset, cell)]
))).join('');
const partial = (lines: readonly Line[]): string => lines.map(([y, row]) => rects([row], y)).join('');

const overlay = (rows: readonly string[], lines: readonly Line[]): string[] => {
  const out = [...rows];
  for (const [y, line] of lines) out[y] = [...(out[y] ?? '')].map((cell, x) => (line[x] && line[x] !== '.' ? line[x] : cell)).join('');
  return out;
};
const region = (rows: readonly string[], [y0, y1]: readonly [number, number], [x0, x1]: readonly [number, number]): string[] => rows.map((row, y) => [...row].map((cell, x) => (
  y >= y0 && y <= y1 && x >= x0 && x <= x1 ? cell : '.'
)).join(''));
const without = (rows: readonly string[], parts: readonly string[][]): string[] => rows.map((row, y) => [...row].map((cell, x) => (
  parts.some((part) => part[y]?.[x] !== '.') ? '.' : cell
)).join(''));

const svg = (inner: string, cols: number, rows: number): string => `<svg viewBox="0 0 ${cols} ${rows}" shape-rendering="crispEdges" aria-hidden="true">${inner}</svg>`;

// Ears and front paws live in their own groups so each cat's move can animate them.
function sittingSvg(cat: Pet): string {
  const coat = overlay(cat.base ?? SITTING, cat.sitting);
  const parts = {
    'ear-left': region(coat, [0, 2], [0, 6]),
    'ear-right': region(coat, [0, 2], [12, 19]),
    'paw-left': region(coat, [17, 18], [0, 7]),
    'paw-right': region(coat, [17, 18], [10, 19]),
  };
  const groups = Object.entries(parts).map(([name, rows]) => `<g class="${name}">${rects(rows)}</g>`).join('');
  const wings = cat.wings ? `<g class="wings">${partial(cat.wings)}</g>` : '';
  const tail = cat.tail === false ? null : cat.tail ?? { up: TAIL_UP, down: TAIL_DOWN };
  return svg(wings + groups + rects(without(coat, Object.values(parts)))
    + `<g class="eyes-open">${partial(cat.eyesOpen)}</g><g class="eyes-closed">${partial(cat.eyesClosed ?? EYES_CLOSED)}</g>`
    + (tail ? `<g class="tail-up">${partial(tail.up)}</g><g class="tail-down">${partial(tail.down)}</g>` : ''), spriteCols(cat), spriteRows(cat));
}

// Tea steam and wand sparkles (and heart) are their own groups so they can rise and twinkle; the rest moves as one.
function propSvg(prop: Prop): string {
  const width = prop.rows[0]?.length ?? 0;
  const height = prop.rows.length;
  const only = (cells: RegExp) => prop.rows.map((row) => row.replace(cells, '.'));
  const inner = `<g class="steam">${rects(only(/[^s]/g))}</g><g class="sparkle">${rects(only(/[^kh]/g))}</g>${rects(only(/[skh]/g))}`;
  return `<svg viewBox="0 0 ${width} ${height}" width="${width * 3}" height="${height * 3}" shape-rendering="crispEdges" aria-hidden="true">${inner}</svg>`;
}

// A still picture of one cat for pickers; wrap it in .cat-portrait[data-cat] so her coat colours apply.
export const portrait = (id: string): string => sittingSvg(ALL_CATS[isCatId(id) ? id : 'mika']);

const root = byId('cat');
let current: Pet = CATS.mika;
let busy = false;
let scene = 'none';

const updateTip = () => {
  query(root, '.cat-tip').textContent = `${current.name} · ${busy ? 'Claude is working' : 'Claude is resting'}`;
};

function render() {
  const key = root.dataset.cat ?? '';
  const prop = isCatId(key) ? ALL_PROPS[key] : PROPS.mika;
  const layers = scenes.svg(scene);
  root.style.setProperty('--cat-sprite-h', `${spriteRows(current) * 3}px`); // taller pets lift the z and the tip
  root.style.setProperty('--cat-sprite-w', `${spriteCols(current) * 3}px`);
  root.innerHTML = layers.back
    + `<div class="cat-prop prop-${prop.name}">${propSvg(prop)}</div>`
    + `<div class="cat-sprite sitting">${sittingSvg(current)}</div>`
    + '<span class="cat-z">z</span>'
    + layers.front
    + '<span class="cat-tip" role="tooltip"></span>';
  updateTip();
}

// Replies arrive every tick: only touch the class and tip, never re-render, or the animations restart.
// After Claude finishes she stays sitting up, eyes open, for a while before dozing off.
const AWAKE_AFTER_WORK_MS = 5 * 60 * 1000;
let dozeTimer: ReturnType<typeof setTimeout> | undefined;

export function setBusy(next: boolean): void {
  const wasBusy = busy;
  busy = Boolean(next);
  root.classList.toggle('busy', busy);
  if (busy) {
    clearTimeout(dozeTimer);
    root.classList.add('awake');
  } else if (wasBusy) {
    clearTimeout(dozeTimer);
    dozeTimer = setTimeout(() => root.classList.remove('awake'), AWAKE_AFTER_WORK_MS);
  }
  updateTip();
}

// Unknown ids (an old settings file, a retired or renamed cat) fall back to Mika.
export function setCat(id: string): void {
  const key = isCatId(id) ? id : 'mika';
  current = ALL_CATS[key];
  root.dataset.cat = key;
  render();
}

export function setScene(id: string): void {
  scene = scenes.has(id) ? id : 'none';
  root.dataset.scene = scene;
  render();
}

// Never on the text: only text blocks on screen under her corner count. She keeps her chosen size when none are there,
// shrinks when that clears them, and otherwise the reader leaves her a strip (a short reader steps her out).
const area = byId('reader-area');
const reader = byId('reader');
const column = query(reader, '.reader-column');
const BLOCKS = ':is(#latest, #older, #flow-view, #decisions-view) :is(p, h1, h2, h3, h4, pre, table, blockquote, ul, ol)';
const TEXT_GAP_PX = 4;
const SCALES = Object.values(PET_SCALE).sort((a, b) => b - a);
let chosenScale = PET_SCALE.normal;

interface Box { left: number; top: number; right: number; bottom: number }
const meets = (a: Box, b: Box): boolean => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const shifted = (r: Box, dy: number): Box => ({ left: r.left, right: r.right, top: r.top + dy, bottom: r.bottom + dy });

// Her corner at a scale, anchored bottom right; computed from styles so it works while she is stepped out.
function cornerAt(scale: number, areaBox: Box, style: CSSStyleDeclaration): Box {
  const right = areaBox.right - parseFloat(style.right);
  const bottom = areaBox.bottom - parseFloat(style.bottom);
  return { left: right - parseFloat(style.width) * scale, top: bottom - parseFloat(style.height) * scale, right, bottom };
}

// The reader as it would be without the strip, so turning the strip on or off never flips the answer.
function viewWithoutStrip(): { view: Box; dy: number } {
  const box = reader.getBoundingClientRect();
  const strip = area.classList.contains('cat-strip') ? parseFloat(getComputedStyle(reader).marginBottom) || 0 : 0;
  const maxScroll = reader.scrollHeight - reader.clientHeight;
  const dy = Math.max(0, reader.scrollTop - Math.max(0, maxScroll - strip)); // a taller reader clamps the scroll down
  return { view: { left: box.left, top: box.top, right: box.right, bottom: box.bottom + strip }, dy };
}

const grown = (b: Box): Box => ({ left: b.left - TEXT_GAP_PX, top: b.top - TEXT_GAP_PX, right: b.right + TEXT_GAP_PX, bottom: b.bottom + TEXT_GAP_PX });

// Every text block on screen inside region, clipped to the reader.
function textIn(region: Box): Box[] {
  const { view, dy } = viewWithoutStrip();
  const found: Box[] = [];
  for (const block of column.querySelectorAll(BLOCKS)) {
    const b = shifted(block.getBoundingClientRect(), dy);
    const clipped = { left: Math.max(b.left, view.left), top: Math.max(b.top, view.top), right: Math.min(b.right, view.right), bottom: Math.min(b.bottom, view.bottom) };
    if (clipped.right > clipped.left && clipped.bottom > clipped.top && meets(clipped, region)) found.push(clipped);
  }
  return found;
}

// Reads everything first, then writes only what changed.
function guard(): void {
  if (reader.hidden) return; // an overlay is up; she is hidden there and measured again when the reader returns
  const areaBox = area.getBoundingClientRect();
  const style = getComputedStyle(root);
  const allowed = SCALES.filter((scale) => scale <= chosenScale);
  const text = textIn(grown(cornerAt(chosenScale, areaBox, style)));
  const fit = allowed.find((scale) => !text.some((block) => meets(block, grown(cornerAt(scale, areaBox, style)))));
  const scale = fit ?? allowed[allowed.length - 1];
  if (root.style.getPropertyValue('--cat-scale') !== String(scale)) root.style.setProperty('--cat-scale', String(scale));
  root.classList.toggle('compact', scale < chosenScale);
  area.classList.toggle('cat-strip', fit === undefined);
}

// Scrolling only moves text under her: one measure per frame at most.
let frame = 0;
reader.addEventListener('scroll', () => {
  if (!frame) frame = requestAnimationFrame(() => { frame = 0; guard(); });
}, { passive: true });
// The reader's width moves with Notes opening and closing, and its column with the look and the reply.
const watch = new ResizeObserver(guard);
for (const target of [area, reader, column]) watch.observe(target);

export function setSize(size: string): void {
  chosenScale = PET_SCALE[isPetSize(size) ? size : 'normal'];
  area.style.setProperty('--pet-scale', String(chosenScale)); // the column ends above her at this size (cat.css)
  guard();
}
void window.pastel.config.get().then((state) => { if (!isIpcError(state)) setSize(state.config.pet.size); });

setCat('mika');
setBusy(false);
// Awake when Petal opens too, so the first thing she sees is the big eyes.
root.classList.add('awake');
dozeTimer = setTimeout(() => root.classList.remove('awake'), AWAKE_AFTER_WORK_MS);

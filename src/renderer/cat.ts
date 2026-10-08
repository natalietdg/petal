// A 20x20 pixel pet in the reader's corner: eyes shut and dozing when Claude rests, playing when it works.
// Four cats share one silhouette; each has her own coat, her own prop and her own busy move.
import * as scenes from './scenes';
import { byId, el, query } from './dom';
import { CATS, EYES_CLOSED, PROPS, SITTING, TAIL_DOWN, TAIL_UP, type Line, type Pet, type Prop } from './cat-art';
import { LOCAL_CATS } from '../shared/local-cats';

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

const svg = (inner: string): string => `<svg viewBox="0 0 20 20" shape-rendering="crispEdges" aria-hidden="true">${inner}</svg>`;

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
    + (tail ? `<g class="tail-up">${partial(tail.up)}</g><g class="tail-down">${partial(tail.down)}</g>` : ''));
}

// Tea steam and wand sparkles are their own groups so they can rise and twinkle; the rest moves as one.
function propSvg(prop: Prop): string {
  const width = prop.rows[0]?.length ?? 0;
  const height = prop.rows.length;
  const only = (cells: RegExp) => prop.rows.map((row) => row.replace(cells, '.'));
  const inner = `<g class="steam">${rects(only(/[^s]/g))}</g><g class="sparkle">${rects(only(/[^k]/g))}</g>${rects(only(/[sk]/g))}`;
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

// Never hide her: when she would sit on the text column, she shrinks to 2px pixels instead.
const column = query(byId('reader'), '.reader-column');
const guard = () => {
  root.classList.remove('compact');
  const textRight = column.getBoundingClientRect().right - parseFloat(getComputedStyle(column).paddingRight);
  root.classList.toggle('compact', root.getBoundingClientRect().left < textRight + 12);
};
new ResizeObserver(guard).observe(byId('reader-area'));

setCat('mika');
setBusy(false);
// Awake when Petal opens too, so the first thing she sees is the big eyes.
root.classList.add('awake');
dozeTimer = setTimeout(() => root.classList.remove('awake'), AWAKE_AFTER_WORK_MS);

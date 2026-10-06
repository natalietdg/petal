// A 20x20 pixel pet in the reader's corner: eyes shut and dozing when Claude rests, playing when it works.
// Three cats share one silhouette; each has her own coat, her own prop and her own busy move.
import * as scenes from './scenes';
import { byId, query } from './dom';

// One row of a sprite drawn over the base at row y.
type Line = readonly [y: number, row: string];

export interface Pet {
  name: string;
  // Her own silhouette; the cats share SITTING.
  base?: readonly string[];
  eyesOpen: readonly Line[];
  eyesClosed?: readonly Line[];
  sitting: readonly Line[];
  tail?: false;
}

export interface Prop {
  name: string;
  rows: readonly string[];
}

// O outline · B fur · L belly · P pink (ears, nose, beans) · K blush · E eye · W eye sparkle.
const SITTING = [
  '...O..........O.....',
  '..OPO........OPO....',
  '..OPPO......OPPO....',
  '..OBBBOOOOOOBBBO....',
  '.OBBBBBBBBBBBBBBO...',
  '.OBBBBBBBBBBBBBBO...',
  'OBBBBBBBBBBBBBBBBO..',
  'OBBBBBBBBBBBBBBBBO..',
  'OBBBBBBBPPBBBBBBBO..',
  'OBBKKBBOBBOBBKKBBO..',
  'OBBBBBBBOOBBBBBBBO..',
  '.OBBBBBBBBBBBBBBO...',
  '..OOBBBBBBBBBBOO....',
  '...OBLLLLLLLLBO.....',
  '...OBLLLLLLLLBO.....',
  '...OBBLLLLLLBBO.....',
  '...OBBBBBBBBBBO.....',
  '...OBPBOOOOBPBO.....',
  '...OOOOO..OOOOO.....',
  '....................',
];
// Round 2x2 pupil with a sparkle in the iris.
const EYES_OPEN: readonly Line[] = [
  [6, '...EEE......EEE.....'],
  [7, '...EWO......EWO.....'],
  [8, '...EOO......EOO.....'],
];
// Closed eyes sit on the open eyes' middle row, 3 wide, so a dozing face matches the awake one.
const EYES_CLOSED: readonly Line[] = [
  [7, '...OOO......OOO.....'],
];
const TAIL_UP: readonly Line[] = [
  [12, '.................O..'],
  [13, '................OBO.'],
  [14, '................OBO.'],
  [15, '...............OBO..'],
  [16, '..............OBO...'],
];
const TAIL_DOWN: readonly Line[] = [
  [16, '...............OOO..'],
  [17, '..............OBBBO.'],
  [18, '...............OOO..'],
];

// Markings drawn over the shared silhouette.
// S stripe · R orange patch · M white fur · C collar · T collar tag.
export const CATS = {
  // Mika, an orange tabby: forehead and cheek stripes, green eyes, cream chest, brown outline.
  mika: {
    name: 'Mika',
    eyesOpen: EYES_OPEN,
    sitting: [
      [1, '...L..........L.....'],
      [2, '...LL........LL.....'],
      [4, '...SS........SS.....'],
      [5, '..SS..........SS....'],
      [13, '....S........S......'],
      [15, '....S........S......'],
    ],
  },
  // Corgi: her own silhouette: big upright pink-lined ears, tan forehead, a white blaze into a white muzzle,
  // dark 2x2 eyes set low, black nose over a tongue, a white bib, a stocky tan body and white socks. No tail.
  corgi: {
    name: 'Corgi',
    base: [
      '...O..........O',
      '..OPO........OPO',
      '..OPBO......OBPO',
      '.OPPPBO....OBPPPO',
      '.OPPPPBOOOOBPPPPO',
      '.OBBBBBBBBBBBBBBO',
      '.OBBBBBBMMBBBBBBO',
      '.OBBBBBBMMBBBBBBO',
      '.OBBBBBBMMBBBBBBO',
      '.OBBBBBMMMMBBBBBO',
      '.OBBBBMMMMMMBBBBO',
      '.OBKKMMMOOMMMKKBO',
      '..OBMMMOPPOMMMBO',
      '...OBMMMMMMMMBO',
      '...OBBMMMMMMBBO',
      '..OBBBBMMMMBBBBO',
      '..OBBBBBBBBBBBBO',
      '..OMMOBBBBBBOMMO',
      '..OOOO......OOOO',
      '',
    ].map((row) => row.padEnd(20, '.')),
    // Eyes two rows lower than the cats', so there's tan forehead between the ears and the eyes.
    eyesOpen: [
      [9, '....WE......WE......'],
      [10, '....EE......EE......'],
    ],
    eyesClosed: [
      [9, '...OOO......OOO.....'],
    ],
    sitting: [],
    tail: false,
  },
  // Near-black grey tabby: M on the forehead, white muzzle, amber eyes, collar with a white tag.
  miki: {
    name: 'Miki',
    eyesOpen: EYES_OPEN,
    sitting: [
      [4, '......S.SS.S........'],
      [5, '.......S..S.........'],
      [8, '......MM..MM........'],
      [9, '.....MM.MM.MM.......'],
      [10, '......MM..MM........'],
      [12, '....CCCCCTCCCC......'],
      [13, '.........T..........'],
      [15, '....S........S......'],
    ],
  },
  // Calico: grey tabby with orange and dark patches, white muzzle, belly and paws, green eyes.
  kira: {
    name: 'Kira',
    eyesOpen: EYES_OPEN,
    sitting: [
      [4, '..RRR...R.S..SSS....'],
      [5, '..RRRR..S....SSS....'],
      [6, '.RR.............S...'],
      [8, '......MM..MM........'],
      [9, '.....MM.MM.MM.......'],
      [10, '......MM..MM........'],
      [11, '..RR.........SS.....'],
      [14, '....R.......S.......'],
      [15, '....RR.......S......'],
      [16, '....R.......SS......'],
      [17, '....M.M....M.M......'],
    ],
  },
} satisfies Record<string, Pet>;

type CatId = keyof typeof CATS;
const isCatId = (id: string): id is CatId => Object.hasOwn(CATS, id);

// Each cat's toy, on the same 3px grid. r/d ball · c/g cup and tea · s steam · f/D fish and its outline · e bone.
export const PROPS = {
  mika: {
    name: 'fish',
    rows: [
      '..DDDD....',
      '.DffffD.DD',
      'DfwffffDfD',
      'DffffffffD',
      'DffffffDfD',
      '.DffffD.DD',
      '..DDDD....',
    ],
  },
  corgi: {
    name: 'bone',
    rows: [
      'DD....DD',
      'DeDDDDeD',
      'DeeeeeeD',
      'DeDDDDeD',
      'DD....DD',
    ],
  },
  miki: {
    name: 'ball',
    rows: [
      '.rrrr.',
      'rwwrrr',
      'rwrrrr',
      'rrrrrd',
      'rrrrdd',
      '.dddd.',
    ],
  },
  kira: {
    name: 'tea',
    rows: [
      '..s..s..',
      '...s..s.',
      '..s..s..',
      'OOOOOO..',
      'OggggOO.',
      'OccccO.O',
      'OccccO.O',
      'OccccOO.',
      '.OOOO...',
    ],
  },
} satisfies Record<string, Prop>;

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
  return svg(groups + rects(without(coat, Object.values(parts)))
    + `<g class="eyes-open">${partial(cat.eyesOpen)}</g><g class="eyes-closed">${partial(cat.eyesClosed ?? EYES_CLOSED)}</g>`
    + (cat.tail === false ? '' : `<g class="tail-up">${partial(TAIL_UP)}</g><g class="tail-down">${partial(TAIL_DOWN)}</g>`));
}

// Tea steam is its own group so it can rise; everything else in a prop moves as one.
function propSvg(prop: Prop): string {
  const width = prop.rows[0]?.length ?? 0;
  const height = prop.rows.length;
  const steam = prop.rows.map((row) => row.replace(/[^s]/g, '.'));
  const solid = prop.rows.map((row) => row.replace(/s/g, '.'));
  const inner = `<g class="steam">${rects(steam)}</g>${rects(solid)}`;
  return `<svg viewBox="0 0 ${width} ${height}" width="${width * 3}" height="${height * 3}" shape-rendering="crispEdges" aria-hidden="true">${inner}</svg>`;
}

const root = byId('cat');
let current: Pet = CATS.mika;
let busy = false;
let scene = 'none';

const updateTip = () => {
  query(root, '.cat-tip').textContent = `${current.name} · ${busy ? 'Claude is working' : 'Claude is resting'}`;
};

function render() {
  const key = root.dataset.cat ?? '';
  const prop = isCatId(key) ? PROPS[key] : PROPS.mika;
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
  current = CATS[key];
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

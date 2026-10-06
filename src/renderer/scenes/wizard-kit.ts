// Furniture shared by the two wizard rooms. Every class is `${prefix}-…`: 'h' for the Loft (howl), 'hs' for the Study,
// so each room keeps its own palette in its own CSS. The rooms place and outline the pieces themselves.
import { inEllipse, outlined, stamp, type Cell, type CellClass, type Shape } from './kit';

// One letter per colour so the hand-drawn sprites stay readable. '.' is see-through.
const LEGEND_NAMES: Record<string, string> = {
  o: 'out', K: 'void',
  W: 'wood-d', w: 'wood', v: 'wood-l',
  B: 'brass-d', b: 'brass', y: 'brass-l', '*': 'shine',
  R: 'red-d', r: 'red', q: 'red-l',
  T: 'teal-d', t: 'teal', u: 'teal-l',
  G: 'lan-d', g: 'lan', z: 'lan-l',
  C: 'paper-d', c: 'paper',
  P: 'plum', p: 'plum-l', N: 'navy', n: 'navy-l',
};

// Back wall and floor rows.
export const FLOOR = 36;
const WALL_SHADOW_FROM = 30;
const RUG = { left: 5, right: 47, top: 40, bottom: 47, diamondRow: 44, diamondPitch: 10 };

export interface SunSize {
  cx: number;
  cy: number;
  // Radii: the face, its dark ring, and the tips of the rays.
  face: number;
  ring: number;
  rays: number;
}

export interface ChestBox {
  left: number;
  right: number;
  // The lock is two columns wide, starting here.
  lock: number;
}

const CHEST_TOP = 30;
const CHEST_BOTTOM = 36;
const CHEST_BAND = 32;

// Caged green lantern hanging from the ceiling: brass cage, four glowing panes.
const LANTERN = [
  '...b...',
  '...B...',
  '..yby..',
  '.ybbbB.',
  'ybbbbbB',
  'bzzbggB',
  'bz*bgGB',
  'bzgbgGB',
  'ybbbbbB',
  'bzgbgGB',
  'bggbGGB',
  'ybbbbbB',
  '.bbbbB.',
  '..bBb..',
  '...B...',
];

// Golden gramophone: a big flared bell with a dark throat, a tube (each room bends its own) and a wooden base.
const HORN_BELL = [
  '...yyyyy....',
  '.yy*yyybb...',
  'yy*ybbbbbb..',
  'yybbBKKBbbB.',
  'ybbBKKKKBbB.',
  'ybbBKKKKBbB.',
  'ybbbBKKBbBB.',
  '.bbbbBBbbBB.',
  '..bbbbbbBB..',
];
const HORN_BASE = [
  '..vvvvvvvwW.',
  '..wwbybwwwW.',
  '..WWWWWWWWW.',
];

// Mantel over the hearth: a round green-glass flask, a tall teal bottle and a candle.
const POTIONS = [
  '..v...v....',
  '..g..uT....',
  '.zgG.uT.c..',
  'zzgGGtT.c..',
  'zggGGtT.C..',
  '.gGG.tTbbB.',
  'vvvvvvvvvvv',
  'WWWWWWWWWWW',
];
const MANTEL_AT = [0, 15] as const;

// Stone hearth under the mantel: brick face, arched opening, logs for the fire spirit, a slab.
const HEARTH = { left: 0, right: 10, top: 23, bottom: 38 };
const OPENING = { left: 1, right: 9, top: 24, bottom: 36 };
const LOG_ROW = 35;
const EMBER_ROW = 36;

// Ornate carved bookcase on the right: arched crown with a big red gem, three shelves of chunky books.
const CASE = { left: 32, right: 47, mid: 39.5, bottom: 33 };
const SHELVES = [8, 15, 22]; // first book row of each shelf; each shelf is 5 rows tall
const SHELF_HEIGHT = 5;
// Curios take a sprite instead of a book tone.
const CURIOS: Record<string, readonly string[]> = {
  jar: ['vwW', 'zgG', 'zgG', 'gGG'],
  skull: ['ccc', 'oco', 'cCC', '.C.'],
  orb: ['.p.', 'ppP', 'pPP', 'bBB'],
  scroll: ['cC.', 'CcC', 'ccC', 'CcC'],
};
// Books as [width, height, tone letter], or [width, height, curio name].
export type ShelfItem = readonly [width: number, height: number, kind: string];

// The fire spirit on the hearth logs: three flame frames swap so it always flickers.
// F deep orange edge, f orange, e yellow, h white-hot core.
const SPIRIT_AT = [1, 25] as const;
const SPIRIT_BODY = ['.FfffffF.', 'FffefeffF', 'FfeeeeefF', 'FeehhheeF', 'FehhhhheF', 'FehhhhheF', '.FehhheF.'];
const SPIRIT_FRAMES = [
  ['...F.....', '..FeF..F.', '.FfefFfF.'],
  ['......F..', '.F..FeF..', '.FFfefFF.'],
  ['.F..F....', '.Ff.FeF.F', '..FfeFfF.'],
].map((tips) => [...tips, ...SPIRIT_BODY]);
// Face drawn over every frame: big white eyes with dark pupils, a wide grin.
const SPIRIT_FACE = ['', '', '', '..WW.WW..', '..WK.KW..', '..WK.KW..', '', '.K.....K.', '..K...K..', '...KKK...'];
// Blink frame: eyelids cover the eyes, leaving a dark closed-eye line.
const SPIRIT_BLINK = ['', '', '', '..ff.ff..', '..ff.ff..', '..KK.KK..'];

// Lantern light pools in a box around the lantern; firelight around the hearth.
const LANTERN_GLOW = { bottom: 18, before: 6, after: 10, rx: 7.5, cy: 7.5, ry: 9 };
const FIRE_GLOW = { top: 20, bottom: 44, right: 16, cx: 5.5, cy: 31, r: 11 };

export function wizardKit(prefix: string) {
  const c = (name: string): CellClass => `${prefix}-${name}`;
  const LEGEND: Record<string, CellClass> = Object.fromEntries(Object.entries(LEGEND_NAMES).map(([letter, name]) => [letter, c(name)]));
  const art = (left: number, top: number, rows: readonly string[]): Shape => stamp(left, top, rows, LEGEND);

  // Back wall: flat and dark so objects pop. Floor: plank boards under a woven rug.
  function wall(x: number, y: number): CellClass {
    if (y < FLOOR - 1) return y >= WALL_SHADOW_FROM ? c('wall-d') : c('wall');
    if (y === FLOOR - 1) return c('wood-d');
    if (y === FLOOR) return c('wood-l');
    const seam = (y - FLOOR) % 3 === 0 || (x + ((y - FLOOR) / 3 | 0) * 7) % 11 === 0;
    return seam ? c('floor-d') : c('floor');
  }

  // Woven rug under the pet: red field, brass border, big teal diamonds.
  function rug(x: number, y: number): CellClass | null {
    const { left, right, top, bottom, diamondRow, diamondPitch } = RUG;
    if (x < left || x > right || y < top || y > bottom) return null;
    if (y === top || x === left) return c('out');
    if (x === left + 1 || y === top + 1) return c('brass');
    const dx = Math.abs(((x - left) % diamondPitch) - diamondPitch / 2);
    const dy = Math.abs(y - diamondRow);
    if (dx + dy <= 1) return c('brass-l');
    if (dx + dy === 2) return c('teal');
    return c('red');
  }

  // Sun mask: orange face in a dark ring, eight brass rays, rosy cheeks and a grin.
  function sunMask({ cx, cy, face, ring, rays }: SunSize, edge: CellClass): Shape {
    return outlined((x, y) => {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.hypot(dx, dy);
      if (d <= face) {
        if ((dx === -2 || dx === 2) && dy === -1) return c('out');
        if ((dx === -3 || dx === 3) && dy === 1) return c('red-l');
        if ((Math.abs(dx) <= 1 && dy === 2) || (Math.abs(dx) === 2 && dy === 1)) return c('red-d');
        if (dx + dy <= -3) return c('brass-l');
        if (dx + dy >= 3) return c('brass-d');
        return c('sun');
      }
      if (d <= ring) return c('out');
      if (d > rays) return null;
      const turns = Math.atan2(dy, dx) / (Math.PI / 4);
      const lateral = Math.abs(turns - Math.round(turns)) * (Math.PI / 4) * d;
      if (lateral > 0.35 + (rays - d) * 0.55) return null;
      return dx + dy < 0 ? c('brass-l') : c('brass');
    }, edge);
  }

  const lantern = (left: number, edge: CellClass): Shape => outlined(art(left, 0, LANTERN), edge);

  const gramophone = (left: number, top: number, tube: readonly string[], edge: CellClass): Shape => (
    outlined(art(left, top, [...HORN_BELL, ...tube, ...HORN_BASE]), edge)
  );

  // Treasure chest: wooden body, heavy brass straps and a lock; `ink` draws the lid seam and the outline.
  function chest({ left, right, lock }: ChestBox, ink: CellClass): Shape {
    return outlined((x, y) => {
      if (x < left || x > right || y < CHEST_TOP || y > CHEST_BOTTOM) return null;
      if (y === CHEST_TOP && (x === left || x === right)) return null;
      if ((x === lock || x === lock + 1) && (y === CHEST_BAND || y === CHEST_BAND + 1)) return y === CHEST_BAND + 1 && x === lock ? c('out') : c('brass-l');
      if (y === CHEST_BAND) return ink;
      if (x === left + 2 || x === right - 2) return y < CHEST_BAND ? c('brass-l') : c('brass');
      if (y === CHEST_TOP || x === left) return c('wood-l');
      if (x === right || y === CHEST_BOTTOM) return c('wood-d');
      return c('wood');
    }, ink);
  }

  // Wizard's staff topped with a teal crystal in brass claws; the shaft is `length` rows of wood.
  function staff(left: number, top: number, length: number, edge: CellClass): Shape {
    const rows = ['.u.', 'uuT', 'utT', '.T.', 'bBb', '.B.', ...Array.from({ length }, (_, i) => (i % 3 === 2 ? '.W.' : '.w.'))];
    return outlined(art(left, top, rows), edge);
  }

  const mantel = art(...MANTEL_AT, POTIONS);
  const inOpening = (x: number, y: number): boolean => {
    const { left, right, top, bottom } = OPENING;
    if (x < left || x > right || y < top || y > bottom) return false;
    return !(y === top && (x === left || x === right)); // rounded arch corners
  };
  function hearthShape(x: number, y: number): CellClass | null {
    const { left, right, top, bottom } = HEARTH;
    if (x < left || x > right || y < top || y > bottom) return null;
    if (y >= bottom - 1) return y === bottom - 1 ? c('stone-l') : c('stone-d');
    if (inOpening(x, y)) {
      if (y === LOG_ROW) return x === OPENING.left || x === OPENING.right ? c('wood-l') : c('wood');
      if (y === EMBER_ROW) return x === 3 || x === 5 || x === 7 ? c('red-l') : c('wood-d'); // embers between logs
      return c('soot');
    }
    const row = y - top;
    if (row % 3 === 2) return c('stone-d'); // mortar line
    const shift = Math.floor(row / 3) % 2 ? 2 : 0;
    if ((x + shift) % 4 === 3) return c('stone-d');
    return row % 3 === 0 ? c('stone-l') : c('stone');
  }
  const hearth = outlined((x, y) => mantel(x, y) ?? hearthShape(x, y), c('out'));

  const BOOK_TONES: Record<string, readonly [CellClass, CellClass, CellClass]> = {
    r: [c('red-l'), c('red'), c('red-d')], t: [c('teal-l'), c('teal'), c('teal-d')],
    n: [c('navy-l'), c('navy'), c('out')], b: [c('brass-l'), c('brass'), c('brass-d')],
    c: [c('paper'), c('paper'), c('paper-d')], p: [c('plum-l'), c('plum'), c('out')],
  };
  function shelfItem(x: number, y: number, shelfTop: number, items: readonly ShelfItem[]): CellClass {
    let left = CASE.left + 2;
    const floor = shelfTop + SHELF_HEIGHT - 1;
    for (const [width, height, kind] of items) {
      if (x < left + width) {
        const top = floor - height + 1;
        const curio = CURIOS[kind];
        if (curio) return art(left, top, curio)(x, y) ?? c('void');
        if (y < top) return c('void');
        const [light, mid, dark] = BOOK_TONES[kind];
        const col = x - left;
        if (y === top + 1 && height >= 5) return c('brass-l');
        if (width > 1 && col === width - 1) return dark;
        return col === 0 ? light : mid;
      }
      left += width;
    }
    return c('void');
  }
  // `shelves` holds each of the three shelves' items, left to right.
  const bookcase = (shelves: readonly (readonly ShelfItem[])[]): Shape => (x, y) => {
    const { left, right, mid, bottom } = CASE;
    if (x < left || x > right || y > bottom) return null;
    // Crown: an arch peaking over the centre, with the red gem in a brass setting.
    const archTop = Math.round(Math.abs(x - mid) / 3);
    if (y < archTop) return null;
    if (y <= 6) {
      if (y === archTop || x === left || x === right) return c('out');
      const gem = Math.hypot((x - mid) / 1.6, (y - 3.5) / 1.5);
      if (gem <= 1) return x < mid && y < 4 ? c('red-l') : c('red');
      if (gem <= 1.6) return c('brass-l');
      if (gem <= 2.1) return c('out');
      if (y === 6) return c('brass-d');
      return y === archTop + 1 ? c('wood-l') : c('wood');
    }
    // Side posts with a teal stud each.
    if (x === left || x === right) return c('out');
    if (x === left + 1 || x === right - 1) {
      if (y === 11 || y === 18) return c('teal-l');
      return x === left + 1 ? c('wood-l') : c('wood-d');
    }
    const shelf = SHELVES.findIndex((top) => y >= top && y < top + SHELF_HEIGHT);
    if (shelf >= 0) return shelfItem(x, y, SHELVES[shelf], shelves[shelf]);
    if (y === 7) return c('wood-d');
    if ([13, 20, 27].includes(y)) return c('wood-l');
    if ([14, 21, 28].includes(y)) return c('wood-d');
    // Lower cupboard, behind the pet.
    if (y === bottom) return c('out');
    return y === 29 ? c('wood-l') : c('wood');
  };

  // A talisman string that sways while Claude works; each string has its own code group.
  // Beads hang from (x, top), then the charm is centred under them.
  const strand = (group: number, x: number, top: number, beads: readonly string[], charm: readonly string[]): Cell[] => {
    const cells: Cell[] = [];
    const charmTop = top + beads.length;
    const half = (charm[0].length - 1) / 2;
    for (let i = 0; i < beads.length; i += 1) cells.push([x, top + i, c(`s${group}-${beads[i]}`)]);
    charm.forEach((row, dy) => [...row].forEach((cell, dx) => {
      if (cell !== '.') cells.push([x - half + dx, charmTop + dy, c(`s${group}-${cell}`)]);
    }));
    return cells;
  };

  // Green light pooling on the bare wall around the lantern hung at `left`.
  function lanternGlow(paint: Shape, left: number): Cell[] {
    const { bottom, before, after, rx, cy, ry } = LANTERN_GLOW;
    const cx = left + (LANTERN[0].length / 2);
    const cells: Cell[] = [];
    for (let y = 0; y <= bottom; y += 1) {
      for (let x = left - before; x <= left + after; x += 1) {
        if (inEllipse(x + 0.5, y + 0.5, cx, cy, rx, ry) && paint(x, y) === c('wall')) cells.push([x, y, c('glow')]);
      }
    }
    return cells;
  }

  const cellsFrom = (rows: readonly string[], cls: (cell: string) => CellClass): Cell[] => rows.flatMap((row, dy) => [...row].flatMap((cell, dx) => (
    cell === '.' ? [] : [[SPIRIT_AT[0] + dx, SPIRIT_AT[1] + dy, cls(cell)] as const]
  )));
  const FACE_CLASS: Record<string, CellClass> = { W: c('sp-eye'), K: c('out') };
  const BLINK_CLASS: Record<string, CellClass> = { f: c('sp-lid'), K: c('sp-lidline') };
  const fireSpirit: Cell[] = [
    ...SPIRIT_FRAMES.flatMap((rows, i) => cellsFrom(rows, (cell) => c(`sp${i + 1}-${cell}`))),
    ...cellsFrom(SPIRIT_FACE, (cell) => FACE_CLASS[cell]),
    ...cellsFrom(SPIRIT_BLINK, (cell) => BLINK_CLASS[cell]),
  ];

  // Warm firelight breathing on the wall and floor around the hearth.
  function fireGlow(paint: Shape): Cell[] {
    const { top, bottom, right, cx, cy, r } = FIRE_GLOW;
    const warm = [c('wall'), c('wall-d'), c('floor'), c('floor-d')];
    const cells: Cell[] = [];
    for (let y = top; y <= bottom; y += 1) {
      for (let x = 0; x <= right; x += 1) {
        if (inEllipse(x + 0.5, y + 0.5, cx, cy, r, r) && warm.includes(paint(x, y) ?? '')) cells.push([x, y, c('fireglow')]);
      }
    }
    return cells;
  }

  return { art, wall, rug, sunMask, lantern, gramophone, chest, staff, hearth, bookcase, strand, lanternGlow, fireSpirit, fireGlow };
}


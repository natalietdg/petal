// Bakery: a corner bakery after hours. Grimy exposed brick, worn dark wood, two industrial pendants
// throwing warm pools of light, a chalkboard menu, and a rain-streaked window with a neon sign glowing in it.
// Clarity rules: every object is ringed by a 1px outline in a darker tone of its own material.
import { cellsOf, inEllipse, layers, outlined, stamp, type Cell, type CellClass, type Scene, type Shape } from './kit';

type Inside = (x: number, y: number) => boolean;

// Layout rows and columns on the 48x48 canvas.
const BRICK_TOP = 2;
const SHELF = 13;
const LEDGE = 26;
const COUNTER_TOP = 29;
const BASEBOARD = 42;
const COUNTER_RIGHT = 17;
const WINDOW = { left: 32, right: 46, top: 2, bottom: 18, mullion: 39 };
// Pendants: one over the ledge loaf, one over the bread shelf.
const LEDGE_LAMP = { x: 28, bulb: 13, reach: 27 };
const SHELF_LAMP = { x: 9, bulb: 6, reach: 12 };

// Deterministic per-cell noise, so grime and worn bricks stay put between renders.
const noise = (a: number, b: number): number => {
  const n = Math.imul(a, 374761393) + Math.imul(b, 668265263);
  return (Math.imul(n ^ (n >>> 13), 1274126177) >>> 0) % 100;
};

// Exposed brick: 2-row courses on dark mortar, staggered, each brick its own worn tone.
// Mortar crumbles in places, grime drips below the window sill and darkens toward the floor.
const DRIPS = [30, 34, 41, 45];
function brick(x: number, y: number): CellClass {
  const course = Math.floor((y - BRICK_TOP) / 3);
  const inCourse = (y - BRICK_TOP) % 3;
  const shifted = x + (course % 2) * 3;
  const brickId = Math.floor(shifted / 6);
  if (inCourse === 2 || shifted % 6 === 5) return noise(x, y) < 12 ? 'b-mortarL' : 'b-mortar';
  if (DRIPS.includes(x) && y > 20 && y < 21 + (noise(x, 7) % 9)) return 'b-grime';
  const tone = noise(brickId, course);
  const sooty = y > 34 ? (y - 34) * 9 : 0;
  if (noise(x, y) < 3) return 'b-chip';
  if (tone < 18 + sooty) return 'b-brickD';
  if (tone > 80) return 'b-brickR';
  return 'b-brick';
}

// Back wall: a charcoal ceiling beam, brick, then a baseboard and worn floorboards.
function wall(x: number, y: number): CellClass {
  if (y === 0) return 'b-beamD';
  if (y === 1) return 'b-beam';
  if (y === BASEBOARD) return 'b-woodD';
  if (y > BASEBOARD) {
    if ((x + (y % 2) * 5) % 9 === 0) return 'b-floorD';
    return noise(x, y) < 8 ? 'b-scuff' : 'b-floor';
  }
  return brick(x, y);
}

// Industrial pendant: cord from the beam, charcoal dome, brass rim, a warm bulb peeking out below.
function pendant(cx: number, bulbY: number): Shape {
  const shade = outlined((x, y) => {
    const dx = x - cx;
    if (y === bulbY - 3 && Math.abs(dx) <= 1) return dx < 0 ? 'b-metalL' : 'b-metal';
    if (y === bulbY - 2 && Math.abs(dx) <= 2) return dx < 0 ? 'b-metalL' : dx > 0 ? 'b-metalD' : 'b-metal';
    if (y === bulbY - 1 && Math.abs(dx) <= 2) return 'b-brass';
    return null;
  }, 'b-metal-ink');
  const cord: Shape = (x, y) => (x === cx && y >= BRICK_TOP && y < bulbY - 3 ? 'b-cord' : null);
  const bulb: Shape = (x, y) => (y === bulbY && Math.abs(x - cx) <= 1 ? 'b-bulb' : null);
  return layers(cord, bulb, shade);
}

// A cone of lamplight under a bulb: solid in the middle, dithered at the edges. Drawn as see-through overlay cells.
function lightCone(cx: number, bulbY: number, reach: number, spread: number): Shape {
  return (x, y) => {
    if (y <= bulbY || y > reach) return null;
    const half = 1 + (y - bulbY) * spread;
    const off = Math.abs(x - cx);
    if (off <= half * 0.55) return 'b-glowA';
    if (off <= half && (x + y) % 2 === 0) return 'b-glowB';
    return null;
  };
}

// A crusty shape lit from the lamp above: bright rim on top, warm middle, deep shadow underneath.
function crust(x: number, y: number, inside: Inside, cx: number, cy: number): CellClass | null {
  if (!inside(x, y)) return null;
  if (!inside(x + 1, y) || !inside(x - 1, y) || !inside(x, y + 1) || !inside(x, y - 1)) return 'b-ol';
  if (!inside(x, y - 2)) return 'b-rim';
  const lean = (x - cx) * 0.4 + (y - cy) * 1.6;
  if (lean > 0.6) return 'b-crustD';
  return 'b-crust';
}

// Round boule with two pale diagonal score cuts across its top.
function boule(cx: number, cy: number, rx: number, ry: number): Shape {
  return (x, y) => {
    const cell = crust(x, y, (px, py) => inEllipse(px + 0.5, py + 0.5, cx, cy, rx, ry), cx - 0.5, cy - 0.5);
    if (cell && cell !== 'b-ol' && y + 0.5 <= cy) {
      const k = x - Math.floor(cx) + (y - Math.floor(cy));
      if ((k === -2 || k === 1) && Math.abs(x + 0.5 - cx) < rx - 1.5) return 'b-score';
    }
    return cell;
  };
}

// Tin loaf: a block with a domed top and a pale split along its crown.
function panLoaf(left: number, top: number, width: number): Shape {
  const right = left + width - 1;
  const inside: Inside = (px, py) => px >= left && px <= right && py >= top && py <= top + 4
    && !(py === top && (px === left || px === right));
  return (x, y) => {
    const cell = crust(x, y, inside, left + width / 2, top + 2);
    if (cell && cell !== 'b-ol' && y === top + 1 && x > left + 1 && x < right - 1) return 'b-score';
    return cell;
  };
}

// Baguettes standing in a basket, each with a rounded tip and slanted pale scores, front to back.
const BAGUETTES: readonly (readonly [number, number])[] = [[10, 17], [14, 18], [12, 15]];
const BAGUETTE_TONES = ['b-rim', 'b-crust', 'b-crustD'] as const;
const baguette = (left: number, top: number): Shape => outlined((x, y) => {
  const dx = x - left;
  if (dx < 0 || dx > 2 || y < top || y > 23) return null;
  if (y === top) return dx === 1 ? 'b-rim' : null;
  if (dx < 2 && (y - top + dx) % 3 === 0) return 'b-score';
  return BAGUETTE_TONES[dx] ?? null;
}, 'b-ol');
const baguettes = layers(...BAGUETTES.map(([left, top]) => baguette(left, top)));

// Wicker basket on the counter: lit rim, woven body, shaded right side.
const basket = outlined((x, y) => {
  if (y < 24 || y > 28) return null;
  const inset = y === 28 ? 1 : 0;
  if (x < 10 + inset || x > 16 - inset) return null;
  if (y === 24) return 'b-wickerL';
  if (x === 16 - inset || y === 28) return 'b-wickerD';
  return (x + Math.floor(y / 2)) % 2 ? 'b-wicker' : 'b-wickerD';
}, 'b-wicker-ink');

// Cream bun: a dusted golden lid, a thick band of cream, a golden base.
const CREAM_BUN = [
  '.oooo.',
  'osRsMo',
  'oRsMDo',
  'WWWWWw',
  'oWWWwo',
  'oMMDDo',
  '.oooo.',
];
const CREAM_BUN_LEGEND: Record<string, CellClass> = { o: 'b-ol', R: 'b-rim', M: 'b-crust', D: 'b-crustD', s: 'b-sugar', W: 'b-whip', w: 'b-whipD' };
const creamBun = (left: number, top: number): Shape => stamp(left, top, CREAM_BUN, CREAM_BUN_LEGEND);

// Croissant: a plump 11x5 crescent with drooping horns, split into rolled segments by dark creases.
type Span = readonly [number, number];
const CROISSANT_ROWS: readonly Span[] = [[3, 7], [1, 9], [0, 10], [0, 10], [0, 10]];
const CROISSANT_GAP: readonly (Span | null)[] = [null, null, null, null, [3, 7]];
const CROISSANT_CREASES = ['3,1', '3,2', '3,3', '7,1', '7,2', '7,3'];
function croissant(left: number, top: number): Shape {
  const inside: Inside = (px, py) => {
    const row = CROISSANT_ROWS[py - top];
    const gap = CROISSANT_GAP[py - top];
    const dx = px - left;
    return !!row && dx >= row[0] && dx <= row[1] && !(gap && dx >= gap[0] && dx <= gap[1]);
  };
  return (x, y) => {
    const cell = crust(x, y, inside, left + 5, top + 2);
    if (cell && cell !== 'b-ol' && CROISSANT_CREASES.includes(`${x - left},${y - top}`)) return 'b-crustD';
    return cell;
  };
}

// Espresso machine: brushed steel body, brass rail and gauge, dark recess with a cup under the group head.
const ESPRESSO = [
  '.bbbbb.',
  'LMMMMMD',
  'LMgMMMD',
  'LMMMbMD',
  'LMMMMMD',
  'LDkbkDD',
  'LnkbknD',
  'LnnnnnD',
  'LnwwWnD',
  'rrrrrrr',
];
const ESPRESSO_LEGEND: Record<string, CellClass> = {
  b: 'b-brass', L: 'b-metalL', M: 'b-metal', D: 'b-metalD', g: 'b-bulb', k: 'b-metal-ink',
  n: 'b-recess', w: 'b-cup', W: 'b-cupD', r: 'b-brassD',
};
const espresso = outlined(stamp(2, 19, ESPRESSO, ESPRESSO_LEGEND), 'b-metal-ink');

// Chalkboard menu: scribbled lines with price dots, smudges, a heart and a little cup doodle.
const CHALK = [
  'ssssssss',
  'sccdccss',
  'ssesssss',
  'sdcdsdcs',
  'sssssess',
  'scdcsdcs',
  'spspsdss',
  'spppsccs',
  'sspssccs',
];
const CHALK_LEGEND: Record<string, CellClass> = { s: 'b-slate', e: 'b-smudge', c: 'b-chalk', d: 'b-chalkD', p: 'b-chalkP' };
const chalkboard = outlined((x, y) => {
  if (x < 17 || x > 26 || y < 3 || y > 13) return null;
  if (y === 3 || x === 17) return 'b-woodL';
  if (y === 13 || x === 26) return 'b-woodD';
  return stamp(18, 4, CHALK, CHALK_LEGEND)(x, y);
}, 'b-wood-ink');

// Neon sign hung in the window: a pink pill with a teal squiggle, haloed onto the glass.
const NEON = [
  '.ppppppppp.',
  'p.t...t...p',
  'p..t.t.t.tp',
  'p...t...t.p',
  '.ppppppppp.',
];
const NEON_BOX = { left: 34, top: 4, right: 44, bottom: 8 };
const neonTube = stamp(NEON_BOX.left, NEON_BOX.top, NEON, { p: 'b-neon', t: 'b-neonT' });
// The pill's footprint is the mask, so the halo spills outward and the street still shows inside it.
const inNeonBox: Inside = (x, y) => x >= NEON_BOX.left && x <= NEON_BOX.right && y >= NEON_BOX.top && y <= NEON_BOX.bottom;
const neon = outlined(neonTube, 'b-halo', inNeonBox);

// Night street through the glass: dark sky, a ragged skyline with a few dim windows, a wet kerb.
function street(x: number, y: number): CellClass {
  if (y === WINDOW.bottom - 1) return x % 3 === 0 ? 'b-wetLit' : 'b-wet';
  const roof = 9 + (noise(Math.floor(x / 3), 3) % 4);
  if (y >= roof) return (x + y) % 4 === 0 && noise(x, y) < 40 ? 'b-cityWin' : 'b-city';
  return 'b-night';
}

// Window: dark wood frame and mullion, a deep sill along the bottom.
const windowFrame = outlined((x, y) => {
  const { left, right, top, bottom, mullion } = WINDOW;
  if (y === bottom + 1 && x >= left - 1 && x <= 47) return 'b-woodL';
  if (y === bottom + 2 && x >= left - 1 && x <= 47) return 'b-wood';
  if (x < left || x > right || y < top || y > bottom) return null;
  if (x === left || x === right || y === top || y === bottom || x === mullion) return x === left || y === top ? 'b-wood' : 'b-woodD';
  return street(x, y);
}, 'b-wood-ink');

// A gig poster peeling off the brick: taped top, folded-back corner, torn away underneath.
const POSTER = [
  'taaaaat',
  'arrrrra',
  'arRRRra',
  'arrrrra',
  'adadada',
  'aaaaf..',
  'aaaf...',
];
const poster = outlined(stamp(37, 21, POSTER, { t: 'b-tape', a: 'b-paper', r: 'b-print', R: 'b-printD', d: 'b-printD', f: 'b-paperD' }), 'b-paper-ink');
const stickers = layers(
  outlined((x, y) => (x >= 44 && x <= 45 && y >= 24 && y <= 25 ? 'b-stickerT' : null), 'b-stickerT-ink'),
  outlined((x, y) => (x >= 33 && x <= 34 && y >= 22 && y <= 23 ? 'b-stickerM' : null), 'b-stickerM-ink'),
);

// Glass case counter: worn top, dim warm glass over two cream buns, scuffed panelled base.
const counter = outlined((x, y) => {
  if (x < 1 || x > COUNTER_RIGHT || y < COUNTER_TOP) return null;
  if (y === COUNTER_TOP) return x === COUNTER_RIGHT ? 'b-wood' : 'b-woodL';
  if (y === COUNTER_TOP + 1) return 'b-woodD';
  if (y <= 40) {
    if (x === 1 || x === COUNTER_RIGHT || y === 40) return 'b-frame';
    const bun = creamBun(3, 32)(x, y) ?? creamBun(10, 32)(x, y);
    if (bun) return bun;
    const shine = x - (y - 31);
    if ((shine === 4 || shine === 12) && y <= 33) return 'b-shine';
    return y === 39 ? 'b-glassD' : 'b-glass';
  }
  if (y === 41) return 'b-woodD';
  const panelLeft = x >= 3 && x <= 8;
  const panelRight = x >= 10 && x <= 15;
  if ((panelLeft || panelRight) && y >= 43 && y <= 46) {
    const [l, r] = panelLeft ? [3, 8] : [10, 15];
    if (y === 43 || x === l) return 'b-woodD';
    if (y === 46 || x === r) return 'b-woodL';
    return noise(x, y) < 15 ? 'b-scuff' : 'b-wood';
  }
  return noise(x, y) < 10 ? 'b-scuff' : 'b-wood';
}, 'b-wood-ink');

// A shelf plank: lit top, front edge, shaded brackets underneath; all ringed in dark wood.
function shelf(top: number, from: number, to: number, brackets: readonly number[]): Shape {
  return outlined((x, y) => {
    if (x < from || x > to) return null;
    if (y === top) return 'b-woodL';
    if (y === top + 1) return noise(x, y) < 20 ? 'b-scuff' : 'b-wood';
    const b = brackets.find((bx) => x >= bx && x <= bx + 2 - (y - top - 2));
    if (b !== undefined && y >= top + 2 && y <= top + 3) return 'b-woodD';
    return null;
  }, 'b-wood-ink');
}

// Front to back. Fill-only layers sit ahead of outlines that must not cut into them.
const paint = layers(
  pendant(LEDGE_LAMP.x, LEDGE_LAMP.bulb), pendant(SHELF_LAMP.x, SHELF_LAMP.bulb),
  neon,
  croissant(34, 14),
  boule(5.5, 10.4, 4, 2.4), panLoaf(10, 8, 6),
  baguettes, basket, espresso,
  shelf(SHELF, 1, 15, [2, 11]),
  boule(27.5, 24, 4.2, 2.3),
  shelf(LEDGE, 21, 35, [22, 32]),
  chalkboard, windowFrame, poster, stickers,
  counter,
  wall,
);

// Overlays: lamplight pools, rain on the window glass, steam off the ledge loaf.
const glow = layers(
  lightCone(LEDGE_LAMP.x, LEDGE_LAMP.bulb, LEDGE_LAMP.reach, 0.5),
  lightCone(SHELF_LAMP.x, SHELF_LAMP.bulb, SHELF_LAMP.reach, 0.7),
);
const RAIN: readonly (readonly [number, number, CellClass])[] = [
  [34, 3, 'b-rain'], [37, 7, 'b-rain2'], [41, 3, 'b-rain3'], [44, 8, 'b-rain'],
  [35, 11, 'b-rain3'], [42, 12, 'b-rain2'], [38, 13, 'b-rain'], [45, 13, 'b-rain3'],
];
const rain: Cell[] = RAIN.flatMap(([x, y, c]): Cell[] => [[x, y, c], [x, y + 1, c]]);
const steam: Cell[] = [
  [26, 21, 'b-steam'], [25, 20, 'b-steam'], [25, 19, 'b-steam'], [26, 18, 'b-steam'],
  [29, 21, 'b-steam2'], [30, 20, 'b-steam2'], [30, 19, 'b-steam2'], [29, 18, 'b-steam2'],
];

const scene: Scene = {
  name: 'Bakery',
  size: [48, 48],
  paint,
  moving: [...cellsOf(glow, 0, 0, 47, 47), ...rain, ...steam],
};
export default scene;

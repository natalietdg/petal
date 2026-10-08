// Izakaya: inside a little Japanese pub at night, sitting at the counter.
// Focal point: the chef in his blue samue jacket and hachimaki, fanning the grill under the big lantern.
// Golden plaster, warm wood and lantern halos everywhere; only the night through the noren is cool.
import { cellsOf, layers, stamp, type Cell, type CellClass, type Scene, type Shape } from './kit';

// Layout on the 48x48 canvas. The pet sits on the counter's right end (x 28+, y 28+); her toy sits just left of her.
const DOORWAY = { left: 0, right: 8, top: 4, bottom: 28 };
const COUNTER = { top: 29, lip: 32, front: 34 };

// Dark ceiling with a long lantern-lit beam the lanterns hang from.
const ceiling: Shape = (_x, y) => (y === 0 ? 'iz-ceil' : y === 1 ? 'iz-beamL' : null);

// Three paper lanterns: a big one over the chef, two small ones either side. Caps, red skin, orange body, hot core.
const BIG_LANTERN = [
  '...k...',
  '..kkk..',
  '.rRORr.',
  'rROcORr',
  'rROcORr',
  'rROcORr',
  '.rRORr.',
  '..kkk..',
];
const SMALL_LANTERN = [
  '..k..',
  '.kkk.',
  'rRORr',
  'ROcOR',
  'ROcOR',
  'rRORr',
  '.kkk.',
];
const lanternKey = (core: CellClass): Record<string, CellClass> => ({ k: 'iz-cap', r: 'iz-lanD', R: 'iz-lan', O: 'iz-lanO', c: core });
const lanterns = layers(
  stamp(17, 1, BIG_LANTERN, lanternKey('iz-coreA')),
  stamp(9, 3, SMALL_LANTERN, lanternKey('iz-coreB')),
  stamp(38, 3, SMALL_LANTERN, lanternKey('iz-coreB')),
);
// Cords from the beam to the small lanterns' hooks.
const cords: Shape = (x, y) => (y === 2 && (x === 11 || x === 40) ? 'iz-cord' : null);

// The doorway on the left: indigo noren split in two, the cool night beyond, a far-off red lantern and two stars.
function doorway(x: number, y: number): CellClass | null {
  const { left, right, top, bottom } = DOORWAY;
  if (x < left || x > right || y < top || y > bottom) return null;
  if (x === left || x === right || y === top) return 'iz-post';
  if (y <= 11) {
    if (x === 4) return 'iz-night';
    return y === top + 1 ? 'iz-norenL' : y === 11 ? 'iz-norenD' : 'iz-noren';
  }
  if ((x === 2 && y === 15) || (x === 6 && y === 13)) return 'iz-star';
  if (x >= 4 && x <= 5 && (y === 19 || y === 20)) return y === 19 ? 'iz-lanO' : 'iz-lan';
  return y < 18 ? 'iz-nightD' : 'iz-night';
}

// The chef: black hair, white hachimaki with a red knot, smiling eyes, indigo samue jacket; his left hand rests on the grill.
const CHEF = stamp(16, 11, [
  '...hhhh....',
  '..hhhhhh...',
  '.HHHHHHHHkk',
  '.hssssssh.k',
  '.ssessess..',
  '.sbssssbs..',
  '..ssmmss...',
  '...ssss....',
  '.LLLVVLLL..',
  'LLLLVLLLLL.',
  'LLLLLLLLLL.',
  'cccccccccc.',
  'cccccccccc.',
  'scccccccc..',
], {
  h: 'iz-hair', H: 'iz-band', k: 'iz-knot', s: 'iz-skin', b: 'iz-blush', e: 'iz-eye', m: 'iz-mouth',
  L: 'iz-coatL', V: 'iz-coatD', c: 'iz-coat',
});

// The charcoal grill in front of him: two skewers over glowing coals in a dark iron box.
const GRILL = stamp(15, 24, [
  '..tmMm.mMmt.',
  'kCcCcCcCcCck',
  'kggggggggggk',
  'kGGGGGGGGGGk',
  'kkkkkkkkkkkk',
], { t: 'iz-stick', m: 'iz-meat', M: 'iz-meatL', k: 'iz-iron', C: 'iz-coalL', c: 'iz-coal', g: 'iz-grill', G: 'iz-grillD' });

// A simmering pot on the left burner.
const POT = stamp(10, 25, ['.kk.', 'LLLL', 'pppp', '.pp.'], { k: 'iz-pot', L: 'iz-potL', p: 'iz-pot' });

// Shelves either side of the chef: sake bottles up top, ceramic jars below.
const SHELF_KEY: Record<string, CellClass> = {
  n: 'iz-neck', G: 'iz-greenL', g: 'iz-green', W: 'iz-sakeL', w: 'iz-sake', B: 'iz-brownL', b: 'iz-brown',
  j: 'iz-jar', J: 'iz-jarL', u: 'iz-glaze', U: 'iz-glazeL', l: 'iz-neck', s: 'iz-shelf',
};
const shelves = layers(
  stamp(10, 11, [
    '.n..n.',
    'Gg.Ww.',
    'Gg.Ww.',
    'Gg.Ww.',
    'ssssss',
    '....n.',
    '.l..Bb',
    'jJj.Bb',
    'jJj.Bb',
    'ssssss',
  ], SHELF_KEY),
  stamp(27, 11, [
    'n..n.',
    'Bb.Gg',
    'Bb.Gg',
    'Bb.Gg',
    'sssss',
    '.....',
    '.l.l.',
    'jJ.uU',
    'jJ.uU',
    'sssss',
  ], SHELF_KEY),
);

// The menu: a rail of pale wooden tags, uneven lengths, no lettering.
const TAG_XS = [33, 36, 39, 42, 45];
function menu(x: number, y: number): CellClass | null {
  if (y === 11 && x >= 32) return 'iz-rail';
  const tag = TAG_XS.find((left) => x === left || x === left + 1);
  if (tag === undefined || y < 12) return null;
  const bottom = tag % 2 ? 18 : 17;
  if (y > bottom) return null;
  return x === tag ? 'iz-tag' : 'iz-tagD';
}

// On the counter: a sake set, a board of nigiri and a plate of gyoza.
const SAKE_KEY: Record<string, CellClass> = { w: 'iz-sake', W: 'iz-sakeL', b: 'iz-sakeBand' };
const OCHOKO = ['WW', 'bb', 'ww'];
const ON_COUNTER = layers(
  // Tokkuri flask at the back, two ochoko cups in front.
  stamp(0, 23, ['.W.', '.W.', 'wWw', 'bbb', 'wWw', 'wWw', 'wWw', 'www'], SAKE_KEY),
  stamp(3, 28, OCHOKO, SAKE_KEY),
  stamp(5, 29, OCHOKO, SAKE_KEY),
  // A little dish of soy for the gyoza.
  stamp(7, 30, ['SS', 'cc'], { S: 'iz-soy', c: 'iz-plate' }),
  // Geta board of nigiri: salmon, tuna, and tamago with a nori band.
  stamp(9, 28, [
    '.SSs.TTt.YkY.',
    '.rrr.rrr.rkr.',
    '.rrr.rrr.rrr.',
    'ggggggggggggg',
  ], { S: 'iz-salmon', s: 'iz-salmonL', T: 'iz-tuna', t: 'iz-tunaL', Y: 'iz-tamago', k: 'iz-nori', r: 'iz-rice', g: 'iz-getaD' }),
  // Three gyoza on a blue plate: pleated tops, crisp golden bottoms.
  stamp(21, 29, [
    '.Ee.Ee.Ee',
    'pGGpGGpGG',
    'ppppppppp',
  ], { E: 'iz-pleatL', e: 'iz-pleat', G: 'iz-gyoza', p: 'iz-glaze' }),
);

// One long thin grain streak: a darker run from `from` to `to` on a single row.
const streak = (x: number, from: number, to: number): boolean => x >= from && x <= to;

// Long horizontal panels across the full width, 4 rows each: lit top edge, one long grain streak, dark seam.
const PLANK_ROWS = 4;
const PLANK_STREAKS: readonly (readonly [number, number])[] = [[3, 38], [10, 47], [0, 30]];
function counterFront(x: number, y: number): CellClass {
  const plank = Math.floor((y - COUNTER.front) / PLANK_ROWS);
  const row = (y - COUNTER.front) % PLANK_ROWS;
  if (row === 0) return 'iz-panelL';
  if (row === PLANK_ROWS - 1) return 'iz-panelD';
  const [from, to] = PLANK_STREAKS[plank % PLANK_STREAKS.length] ?? [0, 0];
  return row === 2 && streak(x, from, to) ? 'iz-panelG' : 'iz-panel';
}

// The counter across the front: lit top edge, one long grain streak on the top, bright front lip, dark underside, then the panels.
function counter(x: number, y: number): CellClass | null {
  if (y < COUNTER.top) return null;
  if (y === COUNTER.top) return 'iz-counterL';
  if (y < COUNTER.lip) return y === COUNTER.lip - 1 && streak(x, 6, 41) ? 'iz-counterG' : 'iz-counter';
  if (y === COUNTER.lip) return 'iz-lip';
  if (y < COUNTER.front) return 'iz-counterD';
  return counterFront(x, y);
}

// Two round wooden stools in front of the counter.
const STOOL = ['.SSSSSS.', 'ssssssss', '.l....l.', '.l....l.', '.l....l.', '.l....l.', '.l....l.', '.l....l.', '.l....l.'];
const stools = layers(...[2, 12].map((left) => stamp(left, 39, STOOL, { S: 'iz-seatL', s: 'iz-seat', l: 'iz-leg' })));

// Golden plaster wall, warmed by three graded rings round every lantern.
const LIGHTS: readonly (readonly [number, number, number])[] = [[20.5, 5, 6], [11.5, 6.5, 4.5], [40.5, 6.5, 4.5]];
const RINGS: readonly (readonly [number, CellClass])[] = [[1, 'iz-halo'], [1.45, 'iz-halo2'], [1.95, 'iz-halo3']];
function wall(x: number, y: number): CellClass {
  const near = Math.min(...LIGHTS.map(([cx, cy, r]) => Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r));
  return RINGS.find(([reach]) => near <= reach)?.[1] ?? 'iz-wall';
}

// Front to back. The lanterns are left out: they sway, so they live in `moving`.
const front = layers(stools, ON_COUNTER, counter, GRILL, CHEF, POT, shelves, menu, doorway, cords, ceiling);
const paint: Shape = (x, y) => front(x, y) ?? wall(x, y);

// Moving cells. The lanterns, swaying together on their cords.
const lanternCells = cellsOf(lanterns, 0, 0, 47, 10);
// The chef's right arm fanning the grill with an uchiwa: two frames that swap.
const arm = (frame: 'A' | 'B', cells: readonly (readonly [number, number, 'sleeve' | 'hand' | 'fan'])[]): Cell[] =>
  cells.map(([x, y, part]) => [x, y, `iz-${part}${frame}`]);
const armDown = arm('A', [[25, 20, 'sleeve'], [26, 21, 'sleeve'], [26, 22, 'sleeve'], [26, 23, 'hand'], [27, 22, 'fan'], [28, 22, 'fan'], [27, 23, 'fan'], [28, 23, 'fan'], [28, 21, 'fan']]);
const armUp = arm('B', [[25, 20, 'sleeve'], [26, 20, 'sleeve'], [26, 19, 'sleeve'], [27, 18, 'hand'], [27, 17, 'fan'], [28, 17, 'fan'], [27, 16, 'fan'], [28, 16, 'fan'], [28, 15, 'fan']]);
// Sparks off the coals and steam off the pot, rising and fading.
const sparks: Cell[] = [[17, 23, 'iz-sparkA'], [21, 22, 'iz-sparkB'], [24, 23, 'iz-sparkA']];
const steam: Cell[] = [[11, 24, 'iz-steamA'], [12, 23, 'iz-steamB'], [11, 22, 'iz-steamA'], [12, 21, 'iz-steamB'], [11, 20, 'iz-steamB'], [13, 22, 'iz-steamA'],
  [22, 27, 'iz-steamA'], [25, 26, 'iz-steamB'], [28, 27, 'iz-steamA']];

const scene: Scene = {
  name: 'Izakaya',
  size: [48, 48],
  paint,
  moving: [...lanternCells, ...armDown, ...armUp, ...sparks, ...steam],
};
export default scene;

// Izakaya: a little Japanese pub seen from the wet street at night.
// Focal point: the row of glowing chōchin and the lit doorway under its indigo noren.
// Deep indigo night outside; every light is warm red, orange or amber, and it spills onto the street.
import { inEllipse, layers, stamp, type Cell, type CellClass, type Scene, type Shape } from './kit';

// Layout on the 48x48 canvas. The pet sits bottom right (x 28+, y 28+) on the step; her toy sits just left of her.
const LANTERN_XS = [2, 10, 18, 26, 34, 42];
const LANTERN_TOP = 8;
const BEAM = 14;
const DOOR = { left: 2, right: 26, top: 15, bottom: 38 };
const NOREN = { top: 16, bottom: 23, gaps: [10, 18] };
// A plain ring crest: no lettering.
const MON_RING = stamp(12, 18, ['.xxx.', 'x...x', 'x...x', 'x...x', '.xxx.'], { x: 'iz-mon' });
const SHOJI_RIGHT = 12;
const AKA = { cx: 31.5, cy: 21.5, rx: 4.4, ry: 4.6, top: 16, bottom: 27 };
const STEP = 39;
const STREET = 41;

// Sky and a kawara tile roof: ridge, grooved tiles, a row of round tile ends, then the dark eave.
function roof(x: number, y: number): CellClass | null {
  if (y === 0) return 'iz-skyD';
  if (y <= 2) return 'iz-sky';
  if (y === 3) return 'iz-roofL';
  if (y <= 5) return x % 3 === 0 ? 'iz-roofD' : 'iz-roof';
  if (y === 6) return x % 3 === 1 ? 'iz-tileEnd' : 'iz-roofD';
  return y === 7 ? 'iz-eave' : null;
}

// Six paper chōchin hung under the eave: dark caps, red skin, orange body, a bright core that pulses.
const LANTERN = [
  '..k..',
  '.kkk.',
  'rRORr',
  'ROcOR',
  'ROcOR',
  'rRORr',
  '.kkk.',
];
const lanterns = layers(...LANTERN_XS.map((left, i) => stamp(left, LANTERN_TOP - 1, LANTERN, {
  k: 'iz-cap', r: 'iz-lanD', R: 'iz-lan', O: 'iz-lanO', c: i % 2 ? 'iz-coreB' : 'iz-coreA',
})));

// The big akachōchin by the door: cord, caps, red body with dark ribs, a hot core.
function akachochin(x: number, y: number): CellClass | null {
  const { cx, cy, rx, ry, top, bottom } = AKA;
  const capped = x >= cx - 2 && x <= cx + 2;
  if (y === top - 1 && Math.abs(x + 0.5 - cx) < 1) return 'iz-cord';
  if ((y === top || y === bottom) && capped) return 'iz-cap';
  if (!inEllipse(x + 0.5, y + 0.5, cx, cy, rx, ry)) return null;
  const dx = Math.abs(x + 0.5 - cx);
  if (dx >= rx - 1.2) return 'iz-akaD';
  if (Math.abs(y + 0.5 - cy) < 2 && dx < 1.5) return 'iz-akaCore';
  if ((y - top) % 3 === 0) return 'iz-akaRib';
  return dx < 2.5 ? 'iz-akaL' : 'iz-aka';
}

// Three straw-wrapped sake barrels stacked by the wall, rope bands and a red label, lit on the lantern side.
const TARU = [
  '.llss.',
  'bbbbbb',
  'lLLLLs',
  'lLMMLs',
  'lLLLLs',
  'bbbbbb',
  '.llss.',
];
const TARU_KEY: Record<string, CellClass> = { s: 'iz-straw', l: 'iz-strawL', b: 'iz-rope', L: 'iz-label', M: 'iz-labelMark' };
const barrels = layers(stamp(39, 14, TARU, TARU_KEY), stamp(36, 21, TARU, TARU_KEY), stamp(42, 21, TARU, TARU_KEY));

// The noren: three indigo panels on a bamboo rod, a white ring crest on the middle one, warm light in the slits.
function noren(x: number, y: number): CellClass | null {
  if (x <= DOOR.left || x >= DOOR.right) return null;
  if (y === DOOR.top) return 'iz-rod';
  if (y < NOREN.top || y > NOREN.bottom) return null;
  if (NOREN.gaps.includes(x)) return 'iz-gap';
  if (MON_RING(x, y)) return 'iz-mon';
  if (y === NOREN.top) return 'iz-norenL';
  return y === NOREN.bottom ? 'iz-norenD' : 'iz-noren';
}

// Closed shoji on the left: wooden lattice over paper glowing amber, brightest up top.
function shoji(x: number, y: number): CellClass | null {
  if (x <= DOOR.left || x > SHOJI_RIGHT || y <= NOREN.bottom || y >= DOOR.bottom) return null;
  if (x === SHOJI_RIGHT || x === DOOR.left + 1) return 'iz-shojiFrame';
  if (x === 6 || x === 9 || y === 27 || y === 31 || y === 35) return 'iz-lattice';
  return y < 31 ? 'iz-paperL' : 'iz-paper';
}

// Through the open half of the door: two sake bottles on a shelf, a pot on the counter, a hot amber wall.
const BAR = stamp(13, 24, [
  '..n..n.......',
  '.Gg.Bb.......',
  '.Gg.Bb.......',
  '.Gg.Bb.......',
  'ssssss.pPPPp.',
  '.......ppppp.',
  '........ppp..',
], { n: 'iz-cap', G: 'iz-greenL', g: 'iz-green', B: 'iz-brownL', b: 'iz-brown', s: 'iz-shelf', p: 'iz-pot', P: 'iz-potL' });
function interior(x: number, y: number): CellClass | null {
  if (x <= SHOJI_RIGHT || x >= DOOR.right || y <= NOREN.bottom || y > DOOR.bottom) return null;
  const bar = BAR(x, y);
  if (bar) return bar;
  if (y === 31) return 'iz-counterL';
  if (y > 31) return x % 4 === 1 ? 'iz-counterD' : 'iz-counter';
  return inEllipse(x + 0.5, y + 0.5, 21.5, 26, 4.5, 3.5) ? 'iz-roomL' : 'iz-room';
}

// Door posts and the lintel beam, lit from the lanterns above.
function timber(x: number, y: number): CellClass | null {
  if (y === BEAM) return 'iz-beamL';
  if ((x === DOOR.left || x === DOOR.right) && y >= DOOR.top && y <= DOOR.bottom) return 'iz-post';
  return null;
}

// Dark plank wall, warmed to brown-red wherever a lantern is near.
const LIGHTS: readonly (readonly [number, number, number])[] = [
  ...LANTERN_XS.map((left) => [left + 2.5, 11, 4.5] as const),
  [AKA.cx, AKA.cy, 6.5],
];
function wall(x: number, y: number): CellClass {
  const near = Math.min(...LIGHTS.map(([cx, cy, r]) => Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r));
  const seam = x % 4 === 3;
  if (near <= 1) return seam ? 'iz-haloSeam' : 'iz-halo';
  if (near <= 1.45) return seam ? 'iz-seam' : 'iz-halo2';
  return seam ? 'iz-seam' : 'iz-wood';
}

// Stone step, golden under the door; wet indigo road with the doorway's light spilling across it.
function ground(x: number, y: number): CellClass | null {
  const underDoor = x >= DOOR.left && x <= DOOR.right;
  if (y === STEP) return underDoor ? 'iz-stepLit' : 'iz-stepTop';
  if (y === STEP + 1) return 'iz-step';
  if (y < STREET) return null;
  const row = y - STREET;
  const lit = row <= 2 && x >= DOOR.left + 1 + row && x <= DOOR.right - 1 - row;
  if (lit) return row <= 1 ? 'iz-spillL' : 'iz-spill';
  return row % 3 === 1 ? 'iz-roadL' : 'iz-road';
}

// Front to back.
const front = layers(roof, lanterns, akachochin, barrels, noren, shoji, interior, timber, ground);
const paint: Shape = (x, y) => front(x, y) ?? wall(x, y);

// Moving cells. Each lantern's light as a broken streak in the wet road, two sets that swap.
const reflections: Cell[] = LANTERN_XS.flatMap((left): Cell[] => {
  const cx = left + 2;
  return [[cx, 44, 'iz-reflA'], [cx + 1, 44, 'iz-reflA'], [cx - 1, 46, 'iz-reflB'], [cx, 46, 'iz-reflB'], [cx + 1, 46, 'iz-reflB']];
});
// Steam curling up from the pot, and more drifting out under the noren.
const steam: Cell[] = [
  [21, 27, 'iz-steamA'], [22, 26, 'iz-steamA'], [23, 27, 'iz-steamB'], [22, 25, 'iz-steamB'], [21, 24, 'iz-steamB'], [23, 24, 'iz-steamA'],
  [18, 22, 'iz-steamA'], [19, 23, 'iz-steamB'], [24, 23, 'iz-steamB'],
];
// A light drizzle, three staggered sets of short streaks.
const RAIN: readonly (readonly [number, number, CellClass])[] = [
  [5, 0, 'iz-rain'], [16, 1, 'iz-rain2'], [29, 0, 'iz-rain3'], [40, 1, 'iz-rain'],
  [8, 15, 'iz-rain3'], [24, 12, 'iz-rain'], [38, 9, 'iz-rain2'], [46, 30, 'iz-rain3'],
  [4, 33, 'iz-rain2'], [15, 37, 'iz-rain3'], [22, 30, 'iz-rain'],
];
const rain: Cell[] = RAIN.flatMap(([x, y, c]): Cell[] => [[x, y, c], [x, y + 1, c], [x - 1, y + 2, c]]);

const scene: Scene = {
  name: 'Izakaya',
  size: [48, 48],
  paint,
  moving: [...reflections, ...steam, ...rain],
};
export default scene;

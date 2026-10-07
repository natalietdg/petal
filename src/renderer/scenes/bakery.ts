// Corner Bakery: a grungy bakery after dark. One lit glass case of pastries is the focal point;
// around it, sooty brick, a buzzing neon BAKERY sign, a leaky pipe, a rain-streaked window and a cracked tile floor.
// Readability: the case glass holds the brightest values, the room stays dark and desaturated.
import { layers, outlined, stamp, type Cell, type CellClass, type Scene, type Shape } from './kit';

// Layout on the 48x48 canvas. The pet covers the bottom-right 20x20 and her toy sits just left of her.
const CASE = { left: 1, right: 26, top: 16, glassTop: 18, shelf: 27, glassBottom: 35, base: 41 };
const FLOOR = 42;
const PIPE = { x: 28, joints: [7, 19] };
const WINDOW = { left: 32, right: 46, top: 3, bottom: 21, mullion: 39 };
const SIGN = { left: 2, top: 4 };

// Deterministic per-cell noise in 0..99, so grime and cracks stay put between renders.
const noise = (a: number, b: number): number => {
  const n = Math.imul(a, 374761393) + Math.imul(b, 668265263);
  return (Math.imul(n ^ (n >>> 13), 1274126177) >>> 0) % 100;
};

// Exposed brick, 5x2 bricks on black mortar; soot thickens toward the ceiling.
function brick(x: number, y: number): CellClass {
  const course = Math.floor(y / 3);
  const shifted = x + (course % 2) * 3;
  if (y % 3 === 2 || shifted % 6 === 5) return 'b-mortar';
  const soot = y < 5 ? 75 : y < 11 ? 40 : 15;
  if (noise(x, y) < soot / 3) return 'b-soot';
  return noise(Math.floor(shifted / 6), course) < soot ? 'b-brickD' : 'b-brick';
}

// Water stain spreading down the brick from the leaky pipe joint: dark core, pale tide line.
const stain = stamp(21, 9, [
  '....ttS',
  '...tSSS',
  '..tSSSS',
  '.tSSSSS',
  'tSSSSSS',
  '.tSSSSt',
  '..ttt..',
], { S: 'b-stain', t: 'b-tide' });

// Grime dripping from the window sill.
const DRIPS: readonly (readonly [number, number])[] = [[33, 26], [36, 24], [41, 27], [45, 25]];
const drips: Shape = (x, y) => (DRIPS.some(([dx, end]) => x === dx && y > WINDOW.bottom + 1 && y <= end) ? 'b-grime' : null);

function wall(x: number, y: number): CellClass {
  if (y <= 1) return y === 0 ? 'b-ceilD' : 'b-ceil';
  return stain(x, y) ?? drips(x, y) ?? brick(x, y);
}

// A rusty drainpipe from ceiling to floor: lit left edge, two clamped joints, rust bleeding below each.
const pipe: Shape = (x, y) => {
  const dx = x - PIPE.x;
  if (y < 2 || dx < -1 || dx > 2) return null;
  if (PIPE.joints.some((j) => y === j || y === j + 1)) return dx === -1 || dx === 2 ? 'b-steelD' : 'b-clamp';
  if (dx === 0) return 'b-pipeL';
  if (dx === 1) return PIPE.joints.some((j) => y > j + 1 && y < j + 5) ? 'b-rust' : 'b-pipe';
  return null;
};

// Cracked tile floor: big dark tiles on grout, two hairline cracks, warm spill from the case.
function floor(x: number, y: number): CellClass | null {
  if (y < FLOOR) return null;
  const crack = (x === 5 && y >= 43) || (x === 6 && y === 46) || (x === 11 && y <= 44) || (x === 12 && y === 45);
  if (crack) return 'b-crack';
  if (x % 5 === 4 || (y - FLOOR) % 4 === 3) return 'b-grout';
  if (y <= FLOOR + 1 && x <= CASE.right && (x + y) % 2 === 0) return 'b-spill';
  return (Math.floor(x / 5) + Math.floor((y - FLOOR) / 4)) % 2 ? 'b-tileD' : 'b-tile';
}

// Croissant: a fat crescent split into rolled segments, its horns curling down at each end.
const CROISSANT = [
  '...oooooo...',
  '.ooRRRRRRoo.',
  'oRRDRRRRDRRo',
  'oRDMMRRMMDRo',
  'oMDDooooDDMo',
  'oDDo....oDDo',
  'oDo......oDo',
  '.o........o.',
];
// Round loaf with two pale score cuts.
const LOAF = [
  '..ooooooo..',
  '.oRRRRRRRo.',
  'oRMsMMMsMMo',
  'oMMMsMMMsDo',
  'oMMMMMMMDDo',
  'oDDDDDDDDDo',
  '.ooooooooo.',
];
// A slice of layer cake, side on: cherry, white icing, sponge and jam stripes.
const CAKE = [
  '.......cc.',
  '......occo',
  '....ooiiio',
  '..ooiiiiio',
  'ooiiiiiiIo',
  'oSSSSSSSdo',
  'oJJJJJJJjo',
  'oSSSSSSSdo',
  'oooooooooo',
];
const PASTRY: Record<string, CellClass> = {
  o: 'b-ol', R: 'b-rim', M: 'b-crust', D: 'b-crustD', s: 'b-score',
  c: 'b-cherry', i: 'b-icing', I: 'b-icingD', S: 'b-sponge', d: 'b-spongeD', J: 'b-jam', j: 'b-jamD',
};
const pastries = layers(
  stamp(2, 19, CROISSANT, PASTRY),
  stamp(14, 19, CROISSANT, PASTRY),
  stamp(3, 28, LOAF, PASTRY),
  stamp(15, 27, CAKE, PASTRY),
);

// Glass interior: brightest under the tube, a touch dimmer low down, two diagonal reflections.
function glass(x: number, y: number): CellClass {
  const streak = x + y;
  if ((streak === 24 || streak === 26) && y <= 25) return 'b-glint';
  return y < CASE.shelf ? 'b-glass' : 'b-glassD';
}

// A star crack in the front glass, top right corner.
const CRACK = ['22,19', '24,19', '23,20', '22,21', '21,22', '24,21', '25,22'];
const crack: Shape = (x, y) => (CRACK.includes(`${x},${y}`) ? 'b-glassCrack' : null);

// Kick panel painted dirty teal, flaking back to bare wood, with a curled flap of paint.
function kickPanel(x: number, y: number): CellClass {
  if (y === CASE.glassBottom + 1) return 'b-steel';
  if (y === CASE.base) return 'b-steelD';
  if ((x === 18 && y === 37) || (x === 19 && y >= 37 && y <= 38)) return 'b-flap';
  const bare = (x >= 16 && x <= 23 && y >= 38) || noise(x, y) < 14;
  return bare ? 'b-bare' : 'b-paint';
}

// The display case: steel frame, worn wood top, glowing glass with a glass shelf, peeling kick panel.
function caseBody(x: number, y: number): CellClass | null {
  const { left, right, top, glassTop, shelf, glassBottom, base } = CASE;
  if (x < left || x > right || y < top || y > base) return null;
  if (y === top) return 'b-woodL';
  if (y === top + 1) return 'b-wood';
  if (y > glassBottom) return kickPanel(x, y);
  if (x === left || x === right || y === glassBottom) return 'b-steel';
  if (y === glassTop) return 'b-tube';
  if (y === shelf) return 'b-shelf';
  return crack(x, y) ?? pastries(x, y) ?? glass(x, y);
}
const displayCase = outlined(caseBody, 'b-steelD');

// Neon BAKERY sign in pink tubes on the brick, haloed; the K has its own class so it can stutter.
const LETTERS: Record<string, readonly string[]> = {
  B: ['xx.', 'x.x', 'xx.', 'x.x', 'xx.'],
  A: ['.x.', 'x.x', 'xxx', 'x.x', 'x.x'],
  K: ['x.x', 'x.x', 'xx.', 'x.x', 'x.x'],
  E: ['xxx', 'x..', 'xx.', 'x..', 'xxx'],
  R: ['xx.', 'x.x', 'xx.', 'x.x', 'x.x'],
  Y: ['x.x', 'x.x', '.x.', '.x.', '.x.'],
};
const WORD = 'BAKERY';
const neonTube: Shape = (x, y) => {
  if (x < SIGN.left) return null;
  const letter = WORD[Math.floor((x - SIGN.left) / 4)];
  const row = letter ? LETTERS[letter]?.[y - SIGN.top] : undefined;
  if (row?.[(x - SIGN.left) % 4] !== 'x') return null;
  return letter === 'K' ? 'b-neonK' : 'b-neon';
};
const neon = outlined(neonTube, 'b-halo');

// Night street through the glass: murky sky, black rooftops with a few lit windows, a wet road.
function street(x: number, y: number): CellClass {
  if (y >= WINDOW.bottom - 2) return x % 3 === 0 ? 'b-wetLit' : 'b-wet';
  const roof = 10 + (noise(Math.floor(x / 3), 3) % 4);
  if (y >= roof) return (x + y) % 4 === 0 && noise(x, y) < 25 ? 'b-cityWin' : 'b-city';
  return 'b-sky';
}
// Stickers slapped on the lower corner of the glass.
const STICKERS = stamp(33, 15, [
  'ppp....',
  'ppp.yy.',
  '....yy.',
  'tt.....',
  'tt.....',
], { p: 'b-stickP', y: 'b-stickY', t: 'b-stickT' });
const windowFrame = outlined((x, y) => {
  const { left, right, top, bottom, mullion } = WINDOW;
  if (y === bottom + 1 && x >= left - 1 && x <= right + 1) return 'b-sill';
  if (x < left || x > right || y < top || y > bottom) return null;
  if (x === left || x === right || y === top || y === bottom || x === mullion) return 'b-frame';
  return STICKERS(x, y) ?? street(x, y);
}, 'b-steelD');

// Front to back.
const paint = layers(displayCase, neon, pipe, windowFrame, floor, wall);

// Moving: rain down the window and steam hissing from the upper pipe joint.
const RAIN: readonly (readonly [number, number, CellClass])[] = [
  [34, 4, 'b-rain'], [37, 8, 'b-rain2'], [41, 4, 'b-rain3'], [44, 9, 'b-rain'],
  [36, 11, 'b-rain3'], [42, 12, 'b-rain2'], [38, 14, 'b-rain'], [45, 14, 'b-rain3'],
];
const rain: Cell[] = RAIN.flatMap(([x, y, c]): Cell[] => [[x, y, c], [x, y + 1, c], [x, y + 2, c]]);
const steam: Cell[] = [
  [31, 7, 'b-steam'], [32, 6, 'b-steam'], [32, 5, 'b-steam'],
  [31, 8, 'b-steam2'], [33, 7, 'b-steam2'], [34, 6, 'b-steam2'],
];

const scene: Scene = {
  name: 'Bakery',
  size: [48, 48],
  paint,
  moving: [...rain, ...steam],
};
export default scene;

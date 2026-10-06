// Wizard's Room: a crammed treasure-trove bedroom (after Howl's), drawn behind the pet.
// Maximalist but readable: a calm dark wall, every object ringed by a dark tone of its own material.
import { distanceToSegment, outlined, type CellClass, type Cell, type Scene, type Shape } from './kit';
import { wizardKit, type ShelfItem } from './wizard-kit';

const kit = wizardKit('h');
const { art, wall, rug, hearth, strand } = kit;

// Bunting sagging across the top: red, teal, brass, cream and plum pennants on a cream cord.
const PENNANTS: readonly (readonly [CellClass, CellClass])[] = [['h-red-l', 'h-red-d'], ['h-teal-l', 'h-teal-d'], ['h-brass-l', 'h-brass-d'], ['h-paper', 'h-paper-d'], ['h-plum-l', 'h-plum']];
// The cord is tied off at the sun's ray and at the bookcase crown.
const CORD = { left: 10, right: 31 };
const ropeY = (x: number): number => Math.round(0.4 + 1.6 * Math.sin((Math.PI * (x - CORD.left)) / (CORD.right - CORD.left)));
function pennant(x: number, y: number): CellClass | null {
  if (x <= CORD.left || x >= CORD.right) return null;
  const slot = Math.floor((x - CORD.left - 1) / 5);
  const left = CORD.left + 1 + slot * 5;
  const top = ropeY(left + 1) + 1;
  const [light, dark] = PENNANTS[slot % PENNANTS.length];
  if (y === top && x <= left + 3) return x === left + 3 ? dark : light;
  if (y === top + 1 && x >= left + 1 && x <= left + 2) return x === left + 2 ? dark : light;
  return null;
}
const cord: Shape = (x, y) => (x >= CORD.left && x <= CORD.right && y === ropeY(x) ? 'h-paper-d' : null);
const bunting = outlined((x, y) => cord(x, y) ?? pennant(x, y), 'h-out', pennant);

// Sun mask, top left, outlined in brass.
const sunMask = kit.sunMask({ cx: 5, cy: 8, face: 3.6, ring: 4.5, rays: 6.1 }, 'h-o-brass');

// Red tapestry with a teal diamond medallion, brass bands and a fringe of brass tassels.
const TAPESTRY = outlined(art(13, 5, [
  'ybbbbbbB',
  'qrrrrrrR',
  'qrruTrrR',
  'qruyyTrR',
  'qrrTTrrR',
  'qrrrrrrR',
  'yybbbbBB',
  'qRrRrRrR',
  'y.b..y.b',
  'b.B..b.B',
]), 'h-o-red');

// Caged green lantern hanging from the ceiling.
const LANTERN_LEFT = 24;
const lantern = kit.lantern(LANTERN_LEFT, 'h-o-brass');

// Brass wall clock under the lantern: cream face, navy hands at ten to twelve.
const clock = outlined(art(25, 16, [
  '..ybB..',
  '.ycNcB.',
  'yccNccB',
  'yNNNccB',
  'ycccCCB',
  '.bCCCB.',
  '..bBB..',
]), 'h-o-brass');

// Golden gramophone over the chest, its tube curving down into the base.
const gramophone = kit.gramophone(13, 14, ['....bbbBB...', '.....bbB....', '......bbB...'], 'h-o-brass');

// Treasure chest under the gramophone.
const chest = kit.chest({ left: 15, right: 24, lock: 19 }, 'h-o-wood');

// Wizard's staff leaning on the bookcase, topped with a teal crystal in brass claws.
const staff = kit.staff(31, 12, 18, 'h-o-wood');

// Leaning tower of books by the clock, a candle in a brass dish on top. Dark lines part the books.
const tower = outlined(art(26, 25, [
  '...c.',
  '..ybB',
  '.qqqR',
  '.rrrR',
  '.oooo',
  'uuuuT',
  'tttTT',
  'ooooo',
  '.pppP',
  '.PPPP',
  'oooo.',
  'ccccC',
]), 'h-out');

// Red feathered fan plant in a brass pot, beside the hearth. Each frond has its own outline,
// layered outside-in, so overlapping fronds stay separate: lit left, shaded right, golden tips.
const FROND_BASE = [12.5, 31] as const;
const FROND_TIPS: readonly (readonly [number, number])[] = [[8.2, 24], [17, 24.5], [9.6, 20.2], [15.6, 20.6], [12.6, 18.6]];
const frond = ([tipX, tipY]: readonly [number, number]): Shape => outlined((x, y) => {
  const [baseX, baseY] = FROND_BASE;
  const px = x + 0.5;
  const py = y + 0.5;
  const t = (baseY - py) / (baseY - tipY);
  if (t <= 0 || t > 1.04) return null;
  const halfWidth = 0.4 + 0.75 * Math.sin(Math.PI * Math.min(t, 1) * 0.85); // leaf: slim stem, full middle, sharp tip
  if (distanceToSegment(px, py, baseX, baseY, tipX, tipY) > halfWidth) return null;
  if (t > 0.82) return 'h-sun';
  return px < baseX + (tipX - baseX) * t ? 'h-red-l' : 'h-red';
}, 'h-o-red');
const fronds = FROND_TIPS.map(frond).reverse(); // centre frond in front
const POT = { left: 11, right: 14, top: 31, bottom: 35 };
function potShape(x: number, y: number): CellClass | null {
  const { left, right, top, bottom } = POT;
  if (x < left || x > right || y < top || y > bottom) return null;
  if (y === top) return x === right ? 'h-brass' : 'h-brass-l';
  if (y === top + 2) return x === right ? 'h-teal-d' : 'h-teal';
  if (y === bottom && (x === left || x === right)) return null;
  return x === left ? 'h-brass-l' : x === right ? 'h-brass-d' : 'h-brass';
}
const pot = outlined(potShape, 'h-o-brass');
const plant: Shape = (x, y) => pot(x, y) ?? fronds.reduce<CellClass | null>((hit, shape) => hit ?? shape(x, y), null);

// Floor clutter, kept low and clear of the pet's toy: a green jar and a teal bottle, scrolls, a coin heap.
const jars = outlined(art(11, 35, [
  '.WW..u.',
  'zggGutT',
  'zggGutT',
  'gggGttT',
  '.GG.tTT',
]), 'h-o-green');
const scrolls = outlined(art(18, 37, [
  '.cccrcC',
  'cccccrC',
  'CcccCCC',
]), 'h-o-paper');
const coins = outlined(art(25, 37, [
  '.yb.',
  'y*bB',
  'ybBB',
]), 'h-o-brass');

// Hand drum in front of the hearth: cream skin, brass rim, red body laced with a brass zigzag.
const drum = outlined(art(0, 39, [
  '.cccccCC.',
  'ccccccCCC',
  'yybbbbbBB',
  'qrrrrrrRR',
  'qryrrryRR',
  'yrrryrrrB',
  'qrrrrrrRR',
  'qrrrrrrRR',
  'yybbbbbBB',
]), 'h-o-red');

// Bookcase on the right: three shelves of chunky books and curios.
const SHELF_ITEMS: readonly (readonly ShelfItem[])[] = [
  [[2, 5, 'r'], [1, 4, 't'], [3, 4, 'jar'], [1, 5, 'b'], [1, 4, 'p'], [2, 5, 'n'], [2, 4, 'c']],
  [[1, 5, 'b'], [2, 5, 't'], [1, 4, 'c'], [3, 4, 'skull'], [1, 5, 'p'], [2, 5, 'r'], [2, 3, 'n']],
  [[2, 5, 'n'], [1, 4, 'r'], [3, 4, 'orb'], [1, 5, 't'], [3, 4, 'scroll'], [1, 4, 'b'], [1, 5, 'c']],
];
const bookcase = kit.bookcase(SHELF_ITEMS);

// Front to back: the first layer that paints a cell wins. Each layer brings its own outline.
function paint(x: number, y: number): CellClass | null {
  return drum(x, y)
    ?? jars(x, y)
    ?? scrolls(x, y)
    ?? coins(x, y)
    ?? tower(x, y)
    ?? plant(x, y)
    ?? gramophone(x, y)
    ?? chest(x, y)
    ?? clock(x, y)
    ?? lantern(x, y)
    ?? staff(x, y)
    ?? hearth(x, y)
    ?? bunting(x, y)
    ?? sunMask(x, y)
    ?? TAPESTRY(x, y)
    ?? bookcase(x, y)
    ?? rug(x, y)
    ?? wall(x, y);
}

// Talisman strings that sway while Claude works.
// Charms carry their own dark outline ('o') so they read over the wall and over objects.
const OFUDA = ['ooo', 'oco', 'oro', 'oco', 'oro', 'ooo'];
const EVIL_EYE = ['.ooo.', 'ottTo', 'otoTo', 'oTTTo', '.ooo.'];
const TASSEL = ['.ooo.', '.oyo.', 'orrRo', 'orrRo', 'orRRo', '.o.o.'];
const BELL = ['.o.', 'oyo', 'ybB', 'oBo'];
const SHORT_OFUDA = ['ooo', 'oco', 'oro', 'ooo'];
const strands = [
  // Paper talisman with red seals, between the sun and the tapestry.
  ...strand(1, 11, 0, ['s', 's', 's', 'r', 's', 'b', 's', 's', 's'], OFUDA),
  // Teal evil-eye charm between the tapestry and the lantern.
  ...strand(2, 22, 0, ['s', 's', 'r', 's', 's', 'b', 's', 's', 's', 's'], EVIL_EYE),
  // Red tassel between the lantern and the bookcase.
  ...strand(3, 31, 0, ['s', 's', 'b', 's', 's'], TASSEL),
  // A brass bell and a short paper talisman over the bookcase crown.
  ...strand(4, 35, 0, ['s', 's'], BELL),
  ...strand(5, 44, 0, ['s', 's', 's'], SHORT_OFUDA),
];

const scene: Scene = {
  name: "Wizard's Room",
  size: [48, 48],
  paint,
  moving: [
    ...kit.lanternGlow(paint, LANTERN_LEFT),
    ...kit.fireGlow(paint),
    ...kit.fireSpirit,
    ...strands,
    // Candle flames on the mantel and the book tower, two frames each.
    [8, 16, 'h-fa'], [8, 15, 'h-fb'], [29, 24, 'h-fa'], [29, 23, 'h-fb'],
    // Glints: the bookcase's red gem, the lantern glass, the staff crystal, the horn rim and the coins.
    [39, 3, 'h-glint'], [25, 6, 'h-glint2'], [31, 13, 'h-glint'], [16, 15, 'h-glint2'], [26, 38, 'h-glint'],
  ],
};
export default scene;

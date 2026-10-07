// City Lights: night sky over a sleeping city, fairy lights, rose curtains and hanging plants,
// a cushioned window seat with a knitted blanket, a telescope on a wall shelf, and a floor lamp.
import {
  distanceToSegment, inCircle, layers, onSegments, outlined, stamp, type Cell, type CellClass, type Scene, type Segment, type Shape,
} from './kit';

// Rooftop [x1, x2, top].
type Rooftop = readonly [x1: number, x2: number, top: number];

// Rooftops [x1, x2, top]: a far row in hazy navy, a near row in near-black with warm windows.
const FAR: readonly Rooftop[] = [[10, 13, 24], [16, 20, 23], [22, 26, 25], [29, 33, 22], [34, 37, 25]];
const NEAR: readonly Rooftop[] = [[9, 11, 30], [12, 15, 27], [16, 18, 31], [19, 22, 28], [23, 24, 32], [25, 28, 29], [29, 31, 31], [32, 35, 28], [36, 38, 30]];
const inBuilding = (x: number, y: number, rows: readonly Rooftop[]): Rooftop | undefined => rows.find(([x1, x2, top]) => x >= x1 && x <= x2 && y >= top);
// The light string droops in four swags under the rod, with a bulb every other cell along each.
const SWAGS: readonly (readonly [number, number])[] = [[9, 17], [17, 25], [25, 33], [33, 41]];
const sag = (x: number): number | null => {
  const swag = SWAGS.find(([a, b]) => x >= a && x <= b);
  return swag ? 3 + Math.round(2 * Math.sin((Math.PI * (x - swag[0])) / (swag[1] - swag[0]))) : null;
};
const BULBS = ['nb-bulb-gold', 'nb-bulb-rose', 'nb-bulb-mint', 'nb-bulb-sky'];
const bulbs = Array.from({ length: 16 }, (_, i) => 10 + i * 2).map((x, i): Cell => [x, (sag(x) ?? 0) + 1, BULBS[i % 4] ?? '']); // every x here is on a swag
// The milky way: a faint dithered band crossing the upper sky.
const milkyWay: Shape = (x, y) => {
  const d = distanceToSegment(x, y, 21, 3, 39, 23);
  if (d <= 1) return 'nb-milky';
  return d <= 2.6 && (x + y) % 2 === 0 ? 'nb-milky-edge' : null;
};
// Faint lines joining one constellation's stars (the stars themselves twinkle in `moving`).
const CONSTELLATION: readonly Segment[] = [[24, 6, 30, 5], [30, 5, 33, 9], [33, 9, 36, 13]];

// The window: frame, city, moon, sky. The sill sits under it.
const glass: Shape = (x, y) => {
  if (x < 8 || x > 39 || y < 3 || y > 38) return null;
  if (x === 8 || x === 39 || y === 3 || y === 38) return 'f';
  // The city, near row in front of far row.
  const near = inBuilding(x, y, NEAR);
  if (near) {
    const [x1, x2, top] = near;
    const pane = (x - x1) % 2 === 1 && (y - top) % 2 === 1 && x < x2 && y < 37;
    const lit = pane && (x * 7 + y * 13) % 5 < 3;
    return lit ? 'nb-window-lit' : 'nb-city-near';
  }
  if (x === 14 && y >= 24 && y < 27) return 'nb-city-near'; // rooftop antenna
  const far = inBuilding(x, y, FAR);
  if (far) return (x - far[0]) % 2 === 1 && (y - far[2]) % 2 === 1 && (x + y * 3) % 4 === 0 ? 'nb-window-dim' : 'nb-city-far';
  // Moon with a soft halo.
  if (inCircle(x, y, 16, 11, 3) && !inCircle(x, y, 17, 10, 2.8)) return 'm';
  if (inCircle(x, y, 16, 11, 4.8)) return 'h';
  // Wisps of lilac cloud.
  const wisps: readonly (readonly [number, number, number])[] = [[22, 13, 18], [24, 14, 20], [11, 23, 16]];
  if (wisps.some(([wy, x1, x2]) => y === wy && x >= x1 && x <= x2)) return 'L';
  if (onSegments(x, y, CONSTELLATION)) return 'ol-const';
  const milky = y <= 22 && milkyWay(x, y);
  if (milky) return milky;
  // Sky deepens from near-black blue at the top to midnight blue above the rooftops.
  return y <= 11 ? 'q' : y <= 20 ? 'Q' : y <= 26 ? 'p' : 'P';
};
const windowAndSill = outlined((x, y) => (y === 39 && x >= 7 && x <= 40 ? 'F' : glass(x, y)), 'ol-wood');

// Curtain rod, fairy-light wire, and curtains gathered by tiebacks at row 24.
const rod: Shape = (x, y) => (y === 2 && x >= 6 && x <= 41 ? 'k' : null);
const wire: Shape = (x, y) => (x >= 9 && x <= 41 && sag(x) === y ? 'nb-wire' : null);
const curtains = outlined((x, y) => {
  if (y < 3 || y > 38) return null;
  const left = x >= 6 && x <= (y < 24 ? 9 : y === 24 ? 7 : 8 + Math.floor((y - 24) / 5));
  const right = x <= 41 && x >= (y < 24 ? 38 : y === 24 ? 40 : 39 - Math.floor((y - 24) / 5));
  if (!left && !right) return null;
  return y === 24 ? 'T' : x % 2 === 0 ? 'c' : 'C';
}, 'ol-curtain');

// Trailing plants in terracotta pots, hung from the rod over each curtain.
const PLANT: Record<string, CellClass> = { w: 'nb-wire', O: 'nb-pot-rim', o: 'o', X: 'X', v: 'v', V: 'V', i: 'i' };
const potEdge = (cell: CellClass): boolean => (cell === 'nb-pot-rim' || cell === 'o' || cell === 'X');
const hangingPlant = (left: number, rows: readonly string[]): Shape => {
  const art = stamp(left, 3, rows, PLANT);
  const pot = outlined((x, y) => { const c = art(x, y); return c && potEdge(c) ? c : null; }, 'ol-pot');
  const leaves = outlined((x, y) => { const c = art(x, y); return c && !potEdge(c) && c !== 'nb-wire' ? c : null; }, 'ol-leaf');
  const string: Shape = (x, y) => (art(x, y) === 'nb-wire' ? 'nb-wire' : null);
  return layers(pot, leaves, string);
};
const leftPlant = hangingPlant(6, ['.w..', '.w..', 'ivvi', 'OOOO', 'oooX', 'VoXV', 'v..v', 'V..V', '.v..', 'V...']);
const rightPlant = hangingPlant(38, ['..w.', '..w.', 'ivvi', 'OOOO', 'oooX', 'VoXV', 'v..v', 'V..v', '...V']);

// On the sill: a candle, a stack of books, the potted sprout and a mug of cocoa.
const wick: Shape = (x, y) => (x === 11 && y === 34 ? 'nb-wick' : null);
const candle = outlined((x, y) => (x >= 11 && x <= 12 && y >= 35 && y <= 38 ? (x === 11 ? 'nb-wax' : 'nb-wax-shade') : null), 'ol-wax');
const books = outlined(stamp(14, 35, ['.AAAw', 'bbbbw', 'aaaaw', 'aaaaw'], {
  A: 'A', b: 'ol-book-rose', a: 'ol-book-blue', w: 'nb-wax',
}), 'ol-book-edge');
const pot = outlined((x, y) => (y >= 36 && y <= 38 && x >= 20 && x <= 23 ? (y === 36 ? 'nb-pot-rim' : x === 23 ? 'X' : 'o') : null), 'ol-pot');
const sprout = outlined((x, y) => {
  if ((y === 35 && (x === 21 || x === 22)) || (y === 34 && x === 20) || (y === 33 && x === 23)) return y === 35 ? 'V' : 'v';
  return y === 34 && (x === 21 || x === 23) ? 'i' : null;
}, 'ol-leaf');
const mug = outlined(stamp(24, 36, ['lmm.', 'mmmh', 'MMM.'], { l: 'ol-mug-l', m: 'ol-mug', M: 'ol-mug-d', h: 'ol-mug' }), 'ol-mug-edge');

// Window seat under the sill: a mustard pillow and a knitted blanket draped over the cushion.
const pillow = outlined(stamp(5, 36, ['.ppp.', 'pplpp', 'ppppp', '.qqq.'], { p: 'ol-pillow', l: 'ol-pillow-l', q: 'ol-pillow-d' }), 'ol-pillow-edge');
const blanket = outlined((x, y) => {
  if (x < 5 || x > 14 || y < 40 || y > 45) return null;
  if (y === 45) return x % 2 === 1 ? 'ol-knit-d' : null; // fringe
  return (x + (y % 2)) % 2 === 0 ? 'ol-knit' : 'ol-knit-d'; // little knit Vs
}, 'ol-knit-edge');
const seat = outlined((x, y) => {
  if (x < 5 || x > 42 || y < 40 || y > 43) return null;
  if (y === 40) return 'ol-seat-l';
  if (y === 41) return 'ol-seat';
  return x % 8 === 4 ? 'F' : 'f';
}, 'ol-wood');
// A soft navy rug scattered with gold stars.
const rug = outlined((x, y) => {
  if (x < 7 || y < 45) return null;
  return (x * 5 + y * 3) % 9 === 0 ? 'ol-gold' : 'ol-starrug';
}, 'ol-starrug-edge');

// Floor lamp on the left: shade, then pole and base.
const shade = outlined((x, y) => {
  const rows: Partial<Record<number, readonly [number, number]>> = { 17: [1, 4], 18: [1, 4], 19: [0, 5], 20: [0, 5] };
  const row = rows[y];
  return row && x >= row[0] && x <= row[1] ? 'Y' : null;
}, 'ol-lamp');
const pole = outlined((x, y) => ((x === 2 && y >= 21 && y <= 45) || (y >= 46 && x >= 0 && x <= 4) ? 'k' : null), 'J');

// Right wall: a telescope on a little shelf, aimed out at the stars, under a constellation print.
const telescope = outlined(stamp(42, 15, [
  'At....', 'ttT...', '.ttT..', '..ttT.', '...tTK', '...k..', '...k..', '..kkk.', '.k.k.k', '.k.k.k',
], { A: 'A', t: 'ol-scope', T: 'ol-scope-d', K: 'K', k: 'k' }), 'ol-ink');
const shelf = outlined((x, y) => (x >= 42 && (y === 25 || y === 26) ? (y === 25 ? 'f' : 'F') : null), 'ol-wood');
const PRINT: Record<string, CellClass> = { f: 'f', q: 'q', s: 'ol-gold', c: 'ol-const', m: 'm' };
const starPrint = outlined(stamp(43, 4, ['fffff', 'fsqqf', 'fqcqf', 'fqqsf', 'fqcqf', 'fsqqf', 'fffff'], PRINT), 'ol-wood');
// Left wall: a little crescent-moon print above the lamp.
const moonPrint = outlined(stamp(0, 4, ['fffff', 'fqqqf', 'fqmqf', 'fmqqf', 'fmqqf', 'fqmqf', 'fqqqf', 'fffff'], PRINT), 'ol-wood');

// Warm light pooled around the lamp shade.
const glow: Shape = (x, y) => (inCircle(x, y, 2.5, 19, 8) ? 'y' : null);

const scene: Scene = {
  name: 'City Lights',
  size: [48, 48],
  paint: layers(
    shade, pole, leftPlant, rightPlant, pillow, blanket,
    wick, candle, books, sprout, pot, mug,
    wire, rod, curtains, telescope, shelf, starPrint, moonPrint,
    seat, rug, windowAndSill, glow,
  ),
  // Stars twinkle (bright 'm', dim 'd', a few cross-shaped), bulbs blink, a star shoots, the candle flickers, cocoa steams.
  moving: [
    [24, 6, 'm'], [11, 7, 'm'], [33, 9, 'm'], [12, 17, 'm'], [35, 18, 'm'], [20, 21, 'm'],
    [30, 5, 'd'], [21, 18, 'd'], [26, 22, 'd'], [36, 13, 'd'], [10, 22, 'd'], [29, 12, 'd'], [31, 16, 'd'],
    [27, 8, 'nb-star'], [26, 8, 'd'], [28, 8, 'd'], [27, 7, 'd'], [27, 9, 'd'],
    [34, 23, 'nb-star'], [33, 23, 'd'], [35, 23, 'd'], [34, 22, 'd'], [34, 24, 'd'],
    [14, 23, 'nb-beacon'],
    [22, 9, 'nb-shoot'], [23, 8, 'nb-trail'], [24, 8, 'nb-trail'], [25, 7, 'nb-trail-faint'], [26, 7, 'nb-trail-faint'],
    ...bulbs,
    [11, 33, 'nb-flame'], [11, 32, 'nb-flame-tip'],
    [25, 34, 'ol-steam'], [26, 33, 'ol-steam'],
  ],
};
export default scene;

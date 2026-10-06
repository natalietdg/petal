// A blazing sun high over a deep sea fading to the shore, a windsurfer out on the water, and a crab on the sand.
import {
  NEIGHBOURS, cellsOf, inCircle, inEllipse, layers, outlined, stamp, tidy, sprite, type Cell, type CellClass, type Scene, type Shape,
} from './kit';

const HORIZON = 24;
// The waterline wanders a row up or down so the shore doesn't look ruled.
const shoreAt = (x: number): number => 37 + Math.round(Math.sin(x * 0.45));
const WINDSURFER = [
  '.....m....',
  '....rm....',
  '...rrm....',
  '...rrm....',
  '..yyym.h..',
  '..yyymaU..',
  '.rrrrm.U..',
  '.rrrrm.U..',
  'rrrrrmu.u.',
  '..bbbbbbbb',
  'ww........',
];
const CRAB = [
  '.hh.......hh.',
  'h..h.e.e.h..h',
  'h4.h.5.5.h.4h',
  '.dd4hhhhh4dd.',
  '...4hhhhh4...',
  '..44p444p44..',
  '...d44444d...',
  '..d.d...d.d..',
];
// Sky objects, each with its own outline: sun, cloud, and the far island on the horizon.
const sunDisc = tidy((x, y) => inCircle(x, y, 8, 7, 5));
const sun = outlined((x, y) => {
  if (!sunDisc(x, y)) return null;
  if (inCircle(x, y, 8, 7, 2)) return 'U';
  return inCircle(x, y, 8, 7, 3.6) ? 'u' : 'z';
}, 'ol-sun');
// One fair-weather cloud, flat-bottomed and shaded along its base.
const cloudMask = tidy((x, y) => y <= 8 && ([[29, 7, 2.5], [32, 6, 3], [35, 7.5, 2]] as const).some(([cx, cy, r]) => inCircle(x, y, cx, cy, r)));
const cloud = outlined((x, y) => (cloudMask(x, y) ? (y === 8 ? 'nb-cloud-shade' : 'nb-cloud') : null), 'ol-cloud');
const isleMask = tidy((x, y) => y >= HORIZON - 2 && y < HORIZON && inEllipse(x, y, 41, HORIZON, 5, 2.2));
const isle = outlined((x, y) => (isleMask(x, y) ? 'nb-isle' : null), 'ol-isle');
const sky = layers(sun, cloud, isle);
const CRAB_LEGEND: Record<string, CellClass> = { h: 'nb-crab-lit', 4: '4', d: 'nb-crab-dark', e: 'nb-crab-eye', 5: '5', p: 'nb-crab-cheek' };
// Outline only the crab's outside, skipping the legs and eye stalks so they stay crisp.
const crabBody = stamp(0, 39, CRAB, CRAB_LEGEND);
const crabOutside = new Set<string>();
const queue: [number, number][] = [[-1, 38]];
for (let next = queue.pop(); next; next = queue.pop()) {
  const [x, y] = next;
  const key = `${x},${y}`;
  if (x < -1 || x > 13 || y < 38 || y > 47 || crabOutside.has(key) || crabBody(x, y)) continue;
  crabOutside.add(key);
  NEIGHBOURS.forEach(([dx, dy]) => queue.push([x + dx, y + dy]));
}
const crab: Shape = (x, y) => crabBody(x, y) ?? (y < 46 && !(x >= 4 && x <= 8 && y <= 41) && crabOutside.has(`${x},${y}`) && NEIGHBOURS.some(([dx, dy]) => crabBody(x + dx, y + dy)) ? 'ol-crab' : null);
const WINDSURFER_LEGEND: Record<string, CellClass> = { m: 'nb-mast', r: 'nb-sail', y: 'nb-sail-band', h: 'nb-skin', a: 'nb-skin', U: 'nb-suit', u: 'nb-suit', b: 'nb-board' };
// Wake ('w') stays loose; everything else on the windsurfer gets one outline.
const windsurfer = outlined(stamp(12, 15, WINDSURFER, WINDSURFER_LEGEND), 'ol-surf');
const scene: Scene = {
  name: 'Beach',
  size: [48, 48],
  paint(x, y) {
    const shore = shoreAt(x);
    // Sand: wet and darker right at the waterline, a couple of shells further up.
    if (y > shore) {
      if (y === shore + 1) return 'nb-wet';
      if ((x === 24 && y === 44) || (x === 4 && y === 46)) return 'nb-shell';
      return (x * 7 + y * 3) % 11 === 0 ? 'N' : 'n';
    }
    if (y === shore) return 'nb-foam';
    if (y === shore - 1 && x % 5 < 2) return 'nb-foam';
    // Sea bands, deepest at the horizon and paling toward the shore.
    if (y > HORIZON) {
      if (y <= 27) return 'nb-deep';
      if (y <= 30) return 'S';
      if (y <= 33) return 's';
      return 'nb-shallow';
    }
    if (y === HORIZON) return 'nb-horizon';
    return sky(x, y);
  },
  // A round little crab with open claws, big eyes on stalks and pink cheeks.
  crab: cellsOf(crab, -1, 38, 13, 47),
  // Rays pulse, crests roll, the water glints, and the windsurfer rides along.
  moving: [
    [8, 0, 'u'], [8, 1, 'u'], [8, 13, 'u'], [8, 14, 'u'], [1, 7, 'u'], [2, 7, 'u'], [14, 7, 'u'], [15, 7, 'u'],
    [3, 2, 'u'], [13, 2, 'u'], [3, 12, 'u'], [13, 12, 'u'],
    ...Array.from({ length: 48 }, (_, x) => x).filter((x) => x % 6 < 2).map((x): Cell => [x, 29, 'w']),
    ...Array.from({ length: 48 }, (_, x) => x).filter((x) => x % 7 === 3 || x % 7 === 4).map((x): Cell => [x, 33, 'w']),
    ...[[23, 13], [24, 12], [25, 13], [26, 12], [27, 13]].map(([x, y]): Cell => [x, y, 'nb-gull']),
    ...[[22, 26], [5, 27], [33, 26], [26, 31], [12, 32], [3, 35], [19, 35]].map(([x, y]): Cell => [x, y, 'nb-glint']),
    ...cellsOf(windsurfer, 11, 14, 22, 25),
    ...sprite(WINDSURFER, 12, 15, { w: 'w' }),
  ],
};
export default scene;

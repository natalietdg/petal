// Twice the cats' height, with a long branch reaching out over the cat; that canopy is drawn in front of her.
// Sakura picnic: gingham blanket and wicker basket at the tree's foot, a far torii on rolling hills.
import {
  NEIGHBOURS, inCircle, layers, onSegments, outlined, stamp, tidy, barkCell, type CellClass, type Scene, type Segment, type Shape, type Circle, type Trunk,
} from './kit';

// Cherry bark: a trunk that curves, flares at the roots and forks into thick limbs,
// lit on its left edge and shaded on its right, with a few dark knots.
const CHERRY_LIMBS: readonly Segment[] = [[7.5, 20, 3, 13], [8, 20, 13, 14], [13, 14, 18, 11]];
const CHERRY_TRUNK: Trunk = { cx: 7.5, top: 19, bottom: 37, sway: 1.4, limbs: CHERRY_LIMBS };
const cherryBark: Shape = (x, y) => barkCell(x, y, CHERRY_TRUNK);

// Cherry limbs as line segments from the trunk out into the crown; the long one reaches over the cat.
const BRANCHES: readonly Segment[] = [
  [9, 20, 30, 12], [8, 18, 3, 12], [8, 22, 1, 17], [12, 18, 16, 11], [20, 16, 22, 10],
  [26, 14, 33, 15], [28, 13, 36, 11], [7, 17, 9, 9], [16, 11, 14, 6], [4, 13, 2, 9],
];
const onBranch = (x: number, y: number): boolean => onSegments(x, y, BRANCHES);

const CANOPY: readonly Circle[] = [[7, 12, 7], [14, 8, 6], [22, 7, 6], [30, 9, 5], [36, 12, 4], [33, 15, 3], [2, 15, 4]];
const inCanopy = tidy((x, y) => CANOPY.some(([cx, cy, r]) => inCircle(x, y, cx, cy, r)));
// Limbs show through the blossom, except where a cluster of flowers covers them.
const blossom = outlined((x, y) => {
  if (!inCanopy(x, y)) return null;
  if (onBranch(x, y) && (x * 5 + y * 3) % 4 !== 0) return 'k';
  if ((x * 3 + y * 5) % 7 === 0) return 'B';
  return y < 7 || inCircle(x, y, 9, 7, 3) || inCircle(x, y, 21, 4, 2.5) ? 'l' : 'b';
}, 'ol-rose');
const trunk: Shape = (x, y) => (y >= 13 ? cherryBark(x, y) : null);
const trunkEdge: Shape = (x, y) => (NEIGHBOURS.some(([dx, dy]) => trunk(x + dx, y + dy)) ? 'K' : null);
const branches: Shape = (x, y) => cherryBark(x, y) ?? (onBranch(x, y) ? 'k' : null);
// Gingham blanket lying on the grass, under the toy and the pet.
const blanket = outlined((x, y) => {
  if (x < 0 || x > 25 || y < 36 || y > 38) return null;
  const band = Math.floor(x / 2) % 2 === 1;
  const row = y === 37;
  if (band && row) return 'ol-check-d';
  return band || row ? 'ol-check' : 'ol-cream';
}, 'ol-check-edge');
// Wicker basket by the trunk; the gap under its handle stays see-through.
const basketArt = stamp(0, 29, ['.hhh.', 'h...h', 'h...h', 'eeeee', 'wWwWw', 'WwWwW', '.WWW.'], {
  h: 'ol-wicker-d', e: 'ol-wicker-l', w: 'ol-wicker', W: 'ol-wicker-d',
});
const basket = outlined(basketArt, 'ol-wicker-edge', (x, y) => basketArt(x, y) || (x >= 1 && x <= 3 && (y === 30 || y === 31)));
// A little vermilion torii far off on the hill, framed by the low branches.
const torii = outlined(stamp(12, 23, ['rrrrrrr', '.r...r.', 'RRRRRRR', '.r...r.', '.r...r.', '.r...r.', '.r...r.'], {
  r: 'ol-torii', R: 'ol-torii-d',
}), 'ol-torii-edge');
// Two soft hills behind everything, each with a darker ridge line.
const farTop = (x: number): number => Math.round(29 + 1.5 * Math.sin(x * 0.2 + 0.5));
const nearTop = (x: number): number => Math.round(33 + 1.2 * Math.sin(x * 0.28 + 2.2));
const hills: Shape = (x, y) => {
  if (y > 37) return null;
  if (y >= nearTop(x)) return y === nearTop(x) ? 'ol-ridge' : 'ol-hill';
  if (y >= farTop(x)) return y === farTop(x) ? 'ol-ridge-far' : 'ol-hill-far';
  return null;
};
const FALLEN: Record<string, CellClass> = { '27,39': 'l', '31,39': 'B', '36,39': 'l', '39,39': 'B', '29,38': 'B', '38,38': 'l' };
const grass: Shape = (x, y) => (y >= 38 ? FALLEN[`${x},${y}`] ?? (y === 39 ? 'G' : 'g') : null);
const butterfly = (left: number, top: number): Shape => stamp(left, top, ['w.w', '.d.'], { w: 'ol-fly', d: 'ol-fly-d' });
// Falling petals in the open air under the branches: 16 two-pixel petals in four waves (pa..pd), each wave on its own timing so they never fall in step.
const PETALS: [number, number][] = [
  [2, 18], [10, 17], [16, 19], [24, 18], [13, 23], [5, 24], [21, 22], [18, 27],
  [9, 29], [26, 25], [1, 30], [14, 31], [22, 30], [7, 21], [19, 15], [11, 26],
];
const WAVES = ['pa', 'pb', 'pc', 'pd'];
const fallingPetals = PETALS.flatMap(([x, y], i): [number, number, CellClass][] => [[x, y, WAVES[i % 4]], [x + 1, y, WAVES[i % 4]]]);

const scene: Scene = {
  name: 'Cherry Blossom',
  size: [40, 40],
  paint: layers(butterfly(1, 23), butterfly(35, 3), basket, blanket, grass, trunk, blossom, trunkEdge, branches, torii, hills),
  // Anything over the cat's half of the canvas sits in front of her.
  front: (x, y) => x >= 20 && y <= 19,
  moving: fallingPetals,
};
export default scene;

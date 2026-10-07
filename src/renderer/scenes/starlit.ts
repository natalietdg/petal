// Starlit Window: a four-pane window onto a clear night. A full moon is the focal point, the milky way
// crosses the glass as one clean band, and stars are crisp dots in three brightnesses.
import {
  distanceToSegment, inCircle, layers, outlined, sprite, stamp, type Cell, type CellClass, type Scene, type Shape,
} from './kit';

// Glass inside a 2-cell frame; one mullion and one transom split it into four panes.
const GLASS = { left: 10, right: 37, top: 6, bottom: 32 };
const MULLION = { left: 23, right: 24 };
const TRANSOM = { top: 18, bottom: 19 };
const FRAME = { left: GLASS.left - 2, right: GLASS.right + 2, top: GLASS.top - 2, bottom: GLASS.bottom + 2 };
const inGlass = (x: number, y: number): boolean => x >= GLASS.left && x <= GLASS.right && y >= GLASS.top && y <= GLASS.bottom;
const onBar = (x: number, y: number): boolean => (x >= MULLION.left && x <= MULLION.right) || (y >= TRANSOM.top && y <= TRANSOM.bottom);
const inPane = (x: number, y: number): boolean => inGlass(x, y) && !onBar(x, y);

// Sky: deep navy up top, a touch lighter in the lower panes, a flat horizon glow.
const sky = (y: number): CellClass => (y < TRANSOM.top ? 'st-sky1' : y < GLASS.bottom - 2 ? 'st-sky2' : 'st-sky3');

// The milky way: one flat band, lower left to upper right, with a brighter core.
const BAND = [GLASS.left - 2, GLASS.bottom - 4, GLASS.right + 2, GLASS.top - 1] as const;
function milkyWay(x: number, y: number): CellClass | null {
  const d = distanceToSegment(x + 0.5, y + 0.5, ...BAND);
  if (d <= 1.1) return 'st-band-hi';
  if (d <= 2.6) return 'st-band-core';
  if (d <= 4.6) return 'st-band';
  return null;
}

// Full moon, the brightest thing in the scene: lit face, a shaded lower-right rim, three craters, a soft halo.
const MOON = { cx: 16, cy: 11.5, r: 4.2 };
const CRATERS = ['14,10', '17,13', '18,9'];
function moon(x: number, y: number): CellClass | null {
  const px = x + 0.5;
  const py = y + 0.5;
  if (!inCircle(px, py, MOON.cx, MOON.cy, MOON.r + 1)) return null;
  if (!inCircle(px, py, MOON.cx, MOON.cy, MOON.r)) return 'st-halo';
  if (!inCircle(px, py, MOON.cx - 0.8, MOON.cy - 0.8, MOON.r - 0.4)) return 'st-moon-d';
  return CRATERS.includes(`${x},${y}`) ? 'st-moon-c' : 'st-moon';
}

// Static stars, hand placed: bright, mid and dim.
const STARS: Record<string, CellClass> = {};
const place = (cell: CellClass, at: readonly (readonly [number, number])[]): void => {
  for (const [x, y] of at) STARS[`${x},${y}`] = cell;
};
place('st-star', [[27, 8], [11, 21], [34, 23]]);
place('st-star-mid', [[31, 13], [21, 7], [13, 28], [36, 29], [26, 14], [21, 16], [29, 30]]);
place('st-star-dim', [[11, 7], [35, 6], [28, 11], [33, 16], [12, 17], [20, 23], [16, 25], [26, 26], [31, 21], [36, 11]]);
const star = (x: number, y: number): CellClass | null => STARS[`${x},${y}`] ?? null;

const space: Shape = (x, y) => (inPane(x, y) ? moon(x, y) ?? star(x, y) ?? milkyWay(x, y) ?? sky(y) : null);

// Painted frame: lit on top and left faces, shaded on bottom and right, so it reads as one solid piece.
function frameCell(x: number, y: number): CellClass | null {
  if (x < FRAME.left || x > FRAME.right || y < FRAME.top || y > FRAME.bottom) return null;
  if (inPane(x, y)) return null;
  if (y === FRAME.top || x === FRAME.left || x === MULLION.left || y === TRANSOM.top) return 'st-frame-l';
  if (y === FRAME.bottom || x === FRAME.right || x === MULLION.right || y === TRANSOM.bottom) return 'st-frame-d';
  return 'st-frame';
}
// Deep sill: lit top edge, shaded front.
const SILL = { left: FRAME.left - 2, right: FRAME.right + 2, top: FRAME.bottom + 1 };
const sillCell: Shape = (x, y) => {
  if (x < SILL.left || x > SILL.right || y < SILL.top || y > SILL.top + 1) return null;
  return y === SILL.top ? 'st-sill-l' : 'st-sill';
};
const windowAndSill = outlined(layers(frameCell, sillCell), 'st-frame-o');

// Plain plum curtains either side, one fold line each, hung from a brass rod.
const CURTAIN_BOTTOM = FRAME.bottom - 1;
const rod: Shape = (x, y) => (y === 2 && x >= 1 && x <= 46 ? 'st-rod' : null);
const curtains = outlined((x, y) => {
  if (y < 3 || y > CURTAIN_BOTTOM) return null;
  const left = x >= 2 && x <= 6;
  const right = x >= 41 && x <= 45;
  if (!left && !right) return null;
  const fold = left ? x === 4 : x === 43;
  const lit = left ? x === 2 : x === 41;
  return fold ? 'st-curtain-d' : lit ? 'st-curtain-l' : 'st-curtain';
}, 'st-curtain-o');

// A potted plant on the sill, a dark silhouette against the sky.
const plant = outlined(stamp(11, 23, [
  '...g...',
  '..gG.g.',
  '..gG.gG',
  'g.gG.gG',
  'gG.gGgG',
  'gGgGgG.',
  '.gGgGg.',
  '..gGg..',
  'rrrrrrr',
  '.ppppP.',
  '.ppppP.',
  '..ppP..',
], { g: 'st-leaf', G: 'st-leaf-d', r: 'st-pot-l', p: 'st-pot', P: 'st-pot-d' }), 'st-plant-o');

// A flat indigo rug with a lit top edge where the pet and her toy sit.
const rug = outlined((x, y) => {
  if (x < 3 || y < 45) return null;
  return y === 45 ? 'st-rug-l' : 'st-rug';
}, 'st-rug-o');

// Moving cells: staggered twinkles, three 4-point sparkles, a shooting star in the top-right pane.
type Group = 1 | 2 | 3;
const tw = (group: Group, at: readonly (readonly [number, number])[]): Cell[] => at.map(([x, y]) => [x, y, `st-tw${group}`]);
const sparkle = (x: number, y: number, group: Group): Cell[] => sprite(['.a.', 'aca', '.a.'], x - 1, y - 1, { a: `st-spark${group}`, c: `st-tw${group}` });
const SHOOTING = sprite(['..f', '.t.', 'h..'], 34, 7, { h: 'st-shoot', t: 'st-trail', f: 'st-trail-faint' });

const scene: Scene = {
  name: 'Starlit Window',
  size: [48, 48],
  paint: layers(plant, curtains, rod, windowAndSill, space, rug),
  moving: [
    ...tw(1, [[33, 9], [21, 31], [22, 12]]),
    ...tw(2, [[12, 14], [35, 26], [19, 21]]),
    ...tw(3, [[30, 7], [27, 23], [26, 30]]),
    ...sparkle(30, 16, 1), ...sparkle(19, 25, 2), ...sparkle(35, 20, 3),
    ...SHOOTING,
  ],
};
export default scene;

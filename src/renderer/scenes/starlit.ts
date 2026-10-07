// Starlit Window: a four-pane window onto a planetarium sky. A spiral galaxy is the focal point, a pink and
// teal nebula crosses the glass, constellations are dotted figures, and stars are crisp dots in three brightnesses.
import {
  distanceToSegment, layers, outlined, sprite, stamp, type Cell, type CellClass, type Scene, type Shape,
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

// The focal point: a tilted two-armed spiral galaxy in the top-left pane, white core, pink arms.
const GALAXY = { cx: 16.5, cy: 12, tilt: 1.4, radius: 5.6, wind: 2, turn: 0.8 };
function galaxy(x: number, y: number): CellClass | null {
  const dx = x + 0.5 - GALAXY.cx;
  const dy = (y + 0.5 - GALAXY.cy) * GALAXY.tilt;
  const r = Math.hypot(dx, dy);
  if (r > GALAXY.radius) return null;
  if (r < 1.2) return 'st-gx-core';
  if (r < 2.4) return 'st-gx-bulge';
  const arm = Math.cos(2 * (Math.atan2(dy, dx) + GALAXY.turn - GALAXY.wind * Math.log(r)));
  if (arm > 0.4) return r < 4.2 ? 'st-gx-arm-hi' : 'st-gx-arm';
  return arm > -0.2 ? 'st-gx-glow' : null;
}

// A nebula band, lower left to upper right: bright pink spine, magenta body, teal on its upper edge.
const BAND = [GLASS.left - 2, GLASS.bottom - 1, GLASS.right + 2, GLASS.top + 6] as const;
function nebula(x: number, y: number): CellClass | null {
  const d = distanceToSegment(x + 0.5, y + 0.5, ...BAND);
  const [x1, y1, x2, y2] = BAND;
  const above = (x2 - x1) * (y + 0.5 - y1) - (y2 - y1) * (x + 0.5 - x1) < 0;
  if (d <= 0.9) return 'st-neb-hi';
  if (d <= 2) return 'st-neb';
  if (d <= 3.2) return above ? 'st-neb-teal' : 'st-neb-plum';
  if (d <= 4.4) return above ? 'st-neb-teal-d' : 'st-neb-haze';
  return null;
}

// Constellations: bright stars joined by thin muted lines, as a planetarium draws them.
const FIGURES: readonly (readonly (readonly [number, number])[])[] = [
  [[26, 8], [28, 11], [30, 8], [32, 11], [35, 8]],
  [[29, 25], [32, 22], [36, 24], [35, 27]],
];
const LINE = new Set<string>();
const FIGURE_STARS = new Set<string>();
for (const figure of FIGURES) {
  figure.forEach(([x, y], i) => {
    FIGURE_STARS.add(`${x},${y}`);
    const next = figure[i + 1];
    if (!next) return;
    const steps = Math.max(Math.abs(next[0] - x), Math.abs(next[1] - y));
    for (let k = 1; k < steps; k += 1) LINE.add(`${Math.round(x + ((next[0] - x) * k) / steps)},${Math.round(y + ((next[1] - y) * k) / steps)}`);
  });
}
const constellation = (x: number, y: number): CellClass | null => {
  const key = `${x},${y}`;
  if (FIGURE_STARS.has(key)) return 'st-star';
  return LINE.has(key) ? 'st-line' : null;
};

// Loose stars, hand placed: bright, mid and dim.
const STARS: Record<string, CellClass> = {};
const place = (cell: CellClass, at: readonly (readonly [number, number])[]): void => {
  for (const [x, y] of at) STARS[`${x},${y}`] = cell;
};
place('st-star', [[11, 21], [21, 30]]);
place('st-star-mid', [[21, 7], [13, 28], [21, 16], [11, 7], [34, 13]]);
place('st-star-dim', [[28, 14], [12, 17], [20, 23], [16, 25], [36, 30], [26, 30]]);
const star = (x: number, y: number): CellClass | null => STARS[`${x},${y}`] ?? null;

const space: Shape = (x, y) => (inPane(x, y)
  ? galaxy(x, y) ?? constellation(x, y) ?? star(x, y) ?? nebula(x, y) ?? sky(y)
  : null);

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
    ...tw(1, [[36, 15], [21, 31], [12, 8]]),
    ...tw(2, [[22, 16], [27, 23], [19, 21]]),
    ...tw(3, [[33, 15], [11, 21], [26, 27]]),
    ...sparkle(28, 15, 1), ...sparkle(20, 26, 2), ...sparkle(35, 30, 3),
    ...SHOOTING,
  ],
};
export default scene;

// Planetarium: the whole canvas is the dome. A spiral galaxy is the focal point,
// teal and pink nebulae glow either side, constellations are joined by thin lines, and the cat sits by the projector.
import {
  inCircle, inEllipse, layers, NEIGHBOURS, outlined, sprite, stamp, type Cell, type CellClass, type Scene, type Shape,
} from './kit';

// The dome: a big circle cut off by the horizon, so the top corners show the room behind it.
const DOME = { cx: 24, cy: 40, r: 41.2 };
const HORIZON = 37;
const inDome = (x: number, y: number): boolean => y <= HORIZON && inCircle(x + 0.5, y + 0.5, DOME.cx, DOME.cy, DOME.r);
const domeDistance = (x: number, y: number): number => Math.hypot(x + 0.5 - DOME.cx, y + 0.5 - DOME.cy);

// Sky in three flat rings: deepest at the zenith, lighter toward the horizon.
const sky = (x: number, y: number): CellClass => {
  const d = domeDistance(x, y);
  return d > 33 ? 'pl-sky1' : d > 24 ? 'pl-sky2' : 'pl-sky3';
};

// The focal point: a tilted two-armed spiral galaxy, white core, pink inner arms fading to violet.
const GALAXY = { cx: 24, cy: 17, tilt: 1.5, radius: 9, wind: 2, turn: 0.8 };
function galaxy(x: number, y: number): CellClass | null {
  const dx = x + 0.5 - GALAXY.cx;
  const dy = (y + 0.5 - GALAXY.cy) * GALAXY.tilt;
  const r = Math.hypot(dx, dy);
  if (r > GALAXY.radius) return null;
  if (r < 1.2) return 'pl-gx-core';
  if (r < 2.4) return 'pl-gx-bulge';
  const arm = Math.cos(2 * (Math.atan2(dy, dx) + GALAXY.turn - GALAXY.wind * Math.log(r)));
  if (arm > 0.4) return r < 5 ? 'pl-gx-arm-hi' : r < 7.5 ? 'pl-gx-arm' : 'pl-gx-arm-out';
  return arm > -0.2 ? 'pl-gx-glow' : null;
}

// Two nebulae, each a few overlapping ovals in three flat tones: teal upper left, pink lower right.
type Blob = readonly [cx: number, cy: number, rx: number, ry: number];
interface Nebula { blobs: readonly Blob[]; tones: readonly [CellClass, CellClass, CellClass] }
const NEBULAE: readonly Nebula[] = [
  { blobs: [[9, 14, 5, 3.5], [5, 17, 4, 3], [13, 11, 4, 2.5]], tones: ['pl-teal-l', 'pl-teal', 'pl-teal-d'] },
  { blobs: [[39, 25, 5, 3.5], [43, 22, 4, 3], [35, 28, 4, 2.5]], tones: ['pl-pink-l', 'pl-pink', 'pl-pink-d'] },
];
// Only the first blob gets the bright core, so each nebula has one heart.
const inBlobs = (x: number, y: number, blobs: readonly Blob[], scale: number): boolean =>
  blobs.some(([cx, cy, rx, ry]) => inEllipse(x + 0.5, y + 0.5, cx, cy, rx * scale, ry * scale));
function nebula(x: number, y: number): CellClass | null {
  for (const { blobs, tones } of NEBULAE) {
    if (inBlobs(x, y, blobs.slice(0, 1), 0.4)) return tones[0];
    if (inBlobs(x, y, blobs, 0.7)) return tones[1];
    if (inBlobs(x, y, blobs, 1)) return tones[2];
  }
  return null;
}

// Constellations: bright stars joined by thin muted lines, as a planetarium draws them.
const FIGURES: readonly (readonly (readonly [number, number])[])[] = [
  [[33, 6], [36, 10], [39, 7], [42, 11], [45, 8]],
  [[2, 25], [6, 22], [10, 24], [14, 21], [17, 25]],
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
  if (FIGURE_STARS.has(key)) return 'pl-star';
  return LINE.has(key) ? 'pl-line' : null;
};

// Loose stars, hand placed: bright, mid and dim.
const STARS: Record<string, CellClass> = {};
const place = (cell: CellClass, at: readonly (readonly [number, number])[]): void => {
  for (const [x, y] of at) STARS[`${x},${y}`] = cell;
};
place('pl-star', [[17, 5], [30, 30]]);
place('pl-star-mid', [[12, 6], [28, 4], [40, 16], [23, 30], [35, 33], [44, 17]]);
place('pl-star-dim', [[20, 8], [31, 12], [8, 8], [26, 33], [41, 31], [18, 3], [32, 25], [45, 13], [16, 34]]);
const star = (x: number, y: number): CellClass | null => STARS[`${x},${y}`] ?? null;

const domeSky: Shape = (x, y) => (inDome(x, y)
  ? galaxy(x, y) ?? constellation(x, y) ?? star(x, y) ?? nebula(x, y) ?? sky(x, y)
  : null);
// The dome's edge: a lit rim just inside, a dark line outside, so the curve shows on light and dark themes.
const onRim = (x: number, y: number): boolean => inDome(x, y)
  && NEIGHBOURS.some(([dx, dy]) => y + dy <= HORIZON && !inDome(x + dx, y + dy));
const rimmed: Shape = (x, y) => (onRim(x, y) ? 'pl-rim' : domeSky(x, y));
const dome = outlined(rimmed, 'pl-dome-o', (x, y) => inDome(x, y) || y > HORIZON);

// Below the horizon: a glowing cove strip, a row of seat backs, then the floor.
const SEAT_TOPS = 'aa.aa.aa.aa.aa.aa.aa.aa.aa.aa.aa.aa.aa.aa.aa.aa.';
function room(x: number, y: number): CellClass | null {
  if (y <= HORIZON) return null;
  if (y === HORIZON + 1) return 'pl-cove';
  if (y === HORIZON + 2) return SEAT_TOPS[x] === 'a' ? 'pl-seat-l' : 'pl-wall';
  if (y <= HORIZON + 4) return 'pl-seat';
  return y === HORIZON + 5 ? 'pl-floor-l' : 'pl-floor';
}

// The star projector: two dark globes on a stalk, low on the left.
const projector = outlined(stamp(5, 27, [
  '.gGg......',
  'gGGGg.....',
  'GGGGG.....',
  '.gGGsg....',
  '....sss...',
  '.....sgGg.',
  '....gGGGGg',
  '....GGGGGG',
  '.....GGGG.',
  '......s...',
  '......s...',
  '.....sss..',
  '....sssss.',
], { g: 'pl-proj-l', G: 'pl-proj', s: 'pl-proj-d' }), 'pl-proj-o');

// Moving cells: staggered twinkles, three 4-point sparkles, a shooting star across the upper right.
type Group = 1 | 2 | 3;
const tw = (group: Group, at: readonly (readonly [number, number])[]): Cell[] => at.map(([x, y]) => [x, y, `pl-tw${group}`]);
const sparkle = (x: number, y: number, group: Group): Cell[] => sprite(['.a.', 'aca', '.a.'], x - 1, y - 1, { a: `pl-spark${group}`, c: `pl-tw${group}` });
const SHOOTING = sprite(['..f', '.t.', 'h..'], 38, 3, { h: 'pl-shoot', t: 'pl-trail', f: 'pl-trail-faint' });

const scene: Scene = {
  name: 'Planetarium',
  size: [48, 48],
  paint: layers(projector, dome, room),
  moving: [
    ...tw(1, [[14, 9], [37, 31], [26, 6]]),
    ...tw(2, [[33, 15], [19, 31], [3, 30]]),
    ...tw(3, [[42, 22], [21, 35], [31, 3]]),
    ...sparkle(36, 18, 1), ...sparkle(18, 28, 2), ...sparkle(22, 6, 3),
    ...SHOOTING,
  ],
};
export default scene;

// Planetarium: the whole canvas is the dome. A spiral galaxy is the focal point, a huge planet looms behind it
// (Mars and Neptune on alternate days), faint nebulae sit far back, and the cat sits by the projector.
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

// Two small, faint nebulae far back: teal top left, pink low right.
type Blob = readonly [cx: number, cy: number, rx: number, ry: number];
interface Nebula { blobs: readonly Blob[]; tones: readonly [CellClass, CellClass, CellClass] }
const NEBULAE: readonly Nebula[] = [
  { blobs: [[12, 6, 3.5, 2], [9, 7.5, 2.5, 1.5], [15, 4.5, 2.5, 1.5]], tones: ['pl-teal-l', 'pl-teal', 'pl-teal-d'] },
  { blobs: [[40, 30, 3.5, 2], [43, 28, 2.5, 1.5], [37, 32, 2.5, 1.5]], tones: ['pl-pink-l', 'pl-pink', 'pl-pink-d'] },
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
  [[3, 16], [7, 12], [11, 14], [14, 10], [18, 11]],
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

// Loose stars, hand placed: bright, mid and dim, white and a few gold.
const STARS: Record<string, CellClass> = {};
const place = (cell: CellClass, at: readonly (readonly [number, number])[]): void => {
  for (const [x, y] of at) STARS[`${x},${y}`] = cell;
};
place('pl-star', [[17, 5], [30, 30]]);
place('pl-star-gold', [[5, 8], [27, 27]]);
place('pl-star-mid', [[12, 6], [21, 25], [23, 30], [35, 33], [46, 27]]);
place('pl-star-gold-mid', [[9, 19], [45, 31]]);
place('pl-star-dim', [[20, 8], [31, 12], [8, 8], [26, 33], [41, 31], [18, 3], [32, 25], [45, 13], [16, 34]]);
place('pl-star-gold-dim', [[3, 20], [38, 35], [13, 26]]);
const star = (x: number, y: number): CellClass | null => STARS[`${x},${y}`] ?? null;

// The day's planet: Mars and Neptune alternate by local calendar day, Mars on 2026-10-07.
export type Planet = 'mars' | 'neptune';
const DAY_MS = 86_400_000;
const FIRST_MARS_DAY = Date.UTC(2026, 9, 7);
export function planetFor(date: Date): Planet {
  // The local date as a UTC day count, so a DST shift never skips or repeats a day.
  const days = Math.round((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - FIRST_MARS_DAY) / DAY_MS);
  return days % 2 === 0 ? 'mars' : 'neptune';
}

// A huge disc behind the galaxy, mostly cropped by the dome: dim limb, face, then each planet's markings.
const PLANET = { cx: 42, cy: 8, r: 18 };
type Painter = (dx: number, dy: number) => CellClass;
const marsCell: Painter = (dx, dy) => {
  if (inEllipse(dx, dy, -3, 18, 9, 5)) return 'pl-mars-cap';
  const sea = inEllipse(dx, dy, -6, 5, 4.5, 2) || inEllipse(dx, dy, -1, 9, 5, 1.6) || inEllipse(dx, dy, -12, 1, 2, 3);
  if (sea) return 'pl-mars-sea';
  return Math.hypot(dx + 4, dy - 4) < 9 ? 'pl-mars-lit' : 'pl-mars-body';
};
const neptuneCell: Painter = (dx, dy) => {
  if (inEllipse(dx, dy, -7, 8.5, 3, 1.4)) return 'pl-nep-spot';
  if (inEllipse(dx, dy, -2.5, 9.5, 1.4, 0.7)) return 'pl-nep-cloud';
  if ((dy > 1 && dy < 3) || dy > 13.5) return 'pl-nep-belt';
  if ((dy > -5 && dy < -3) || (dy > 4.5 && dy < 6)) return 'pl-nep-band';
  return Math.hypot(dx + 4, dy - 4) < 9 ? 'pl-nep-lit' : 'pl-nep-body';
};
function planetCell(x: number, y: number, paint: Painter, limb: CellClass): CellClass | null {
  const dx = x + 0.5 - PLANET.cx;
  const dy = y + 0.5 - PLANET.cy;
  const d = Math.hypot(dx, dy);
  if (d > PLANET.r) return null;
  return d > PLANET.r - 1.5 ? limb : paint(dx, dy);
}

const foreground = (x: number, y: number): CellClass | null => galaxy(x, y) ?? constellation(x, y) ?? star(x, y);
const domeSky: Shape = (x, y) => (inDome(x, y) ? foreground(x, y) ?? nebula(x, y) ?? sky(x, y) : null);
// The dome's edge: a lit rim just inside, a dark line outside, so the curve shows on light and dark themes.
const onRim = (x: number, y: number): boolean => inDome(x, y)
  && NEIGHBOURS.some(([dx, dy]) => y + dy <= HORIZON && !inDome(x + dx, y + dy));
const rimmed: Shape = (x, y) => (onRim(x, y) ? 'pl-rim' : domeSky(x, y));
const dome = outlined(rimmed, 'pl-dome-o', (x, y) => inDome(x, y) || y > HORIZON);

// Both planets are drawn over open sky only, so stars and galaxy stay in front; CSS shows the day's one.
const planets: Cell[] = [];
for (let y = 0; y <= HORIZON; y += 1) {
  for (let x = 0; x < 48; x += 1) {
    if (!inDome(x, y) || onRim(x, y) || foreground(x, y)) continue;
    const mars = planetCell(x, y, marsCell, 'pl-mars-limb');
    const neptune = planetCell(x, y, neptuneCell, 'pl-nep-limb');
    if (mars) planets.push([x, y, mars]);
    if (neptune) planets.push([x, y, neptune]);
  }
}

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

// Moving cells: staggered twinkles (some gold), three 4-point sparkles, a shooting star across the upper right.
type Group = 1 | 2 | 3;
const tw = (group: Group, at: readonly (readonly [number, number])[], tint = ''): Cell[] => at.map(([x, y]) => [x, y, `pl-tw${group}${tint}`]);
const sparkle = (x: number, y: number, group: Group): Cell[] => sprite(['.a.', 'aca', '.a.'], x - 1, y - 1, { a: `pl-spark${group}`, c: `pl-tw${group}` });
const SHOOTING = sprite(['..f', '.t.', 'h..'], 38, 3, { h: 'pl-shoot', t: 'pl-trail', f: 'pl-trail-faint' });

const scene: Scene = {
  name: 'Planetarium',
  size: [48, 48],
  paint: layers(projector, dome, room),
  // Planets go first so every moving cell draws over them.
  moving: [
    ...planets,
    ...tw(1, [[11, 9], [37, 31], [22, 3]]), ...tw(1, [[2, 33]], '-gold'),
    ...tw(2, [[29, 23], [19, 31], [3, 30]]), ...tw(2, [[44, 36]], '-gold'),
    ...tw(3, [[46, 33], [21, 35], [14, 2]]), ...tw(3, [[8, 4]], '-gold'),
    ...sparkle(37, 27, 1), ...sparkle(18, 28, 2), ...sparkle(22, 6, 3),
    ...SHOOTING,
  ],
};
export default scene;

// Typed loosely: tests import this file without the DOM, so the timer only starts in the app.
type Page = { documentElement: { dataset: Record<string, string | undefined> } };
const page = (globalThis as { document?: Page }).document;
// Checked each minute rather than timed to midnight: a sleeping laptop delays timers.
const showTodaysPlanet = (root: Page['documentElement']): void => {
  const planet = planetFor(new Date());
  if (root.dataset.plPlanet !== planet) root.dataset.plPlanet = planet;
};
if (page) {
  showTodaysPlanet(page.documentElement);
  setInterval(() => showTodaysPlanet(page.documentElement), 60_000);
}

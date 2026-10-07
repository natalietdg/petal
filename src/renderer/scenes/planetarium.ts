// Planetarium: the whole canvas is the dome. A spiral galaxy is the focal point, a huge planet looms behind it
// (a different one each day), faint nebulae sit far back, and the cat sits by the projector.
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

// Two tiny, faint nebulae, far off in the distance: teal top right, pink low left.
type Blob = readonly [cx: number, cy: number, rx: number, ry: number];
interface Nebula { blobs: readonly Blob[]; tones: readonly [CellClass, CellClass, CellClass] }
const NEBULAE: readonly Nebula[] = [
  { blobs: [[38, 5, 2, 1.2], [36.5, 6, 1.5, 1]], tones: ['pl-teal-l', 'pl-teal', 'pl-teal-d'] },
  { blobs: [[10, 31, 2, 1.2], [11.5, 30, 1.5, 1]], tones: ['pl-pink-l', 'pl-pink', 'pl-pink-d'] },
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
  [[44, 16], [40, 12], [36, 14], [33, 10], [29, 11]],
  [[45, 25], [41, 22], [37, 24], [33, 21], [30, 25]],
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
place('pl-star', [[30, 5], [17, 30]]);
place('pl-star-gold', [[42, 8], [20, 27]]);
place('pl-star-mid', [[35, 6], [26, 25], [24, 30], [12, 33], [1, 27]]);
place('pl-star-gold-mid', [[38, 19], [2, 31]]);
place('pl-star-dim', [[27, 8], [39, 8], [21, 33], [6, 31], [29, 3], [15, 25], [4, 28], [31, 34]]);
place('pl-star-gold-dim', [[44, 20], [9, 35], [34, 26]]);
const star = (x: number, y: number): CellClass | null => STARS[`${x},${y}`] ?? null;

// The day's planet: all eight in solar order, one per local calendar day, Mars on 2026-10-07.
export const PLANETS = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'] as const;
export type Planet = (typeof PLANETS)[number];
const DAY_MS = 86_400_000;
const MARS_DAY = Date.UTC(2026, 9, 7);
export function planetFor(date: Date): Planet {
  // The local date as a UTC day count, so a DST shift never skips or repeats a day.
  const days = Math.round((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - MARS_DAY) / DAY_MS);
  const index = (((days + PLANETS.indexOf('mars')) % PLANETS.length) + PLANETS.length) % PLANETS.length;
  return PLANETS[index] ?? 'mars';
}

// Huge, low-contrast discs on the left behind the galaxy, cropped by the dome; (dx, dy) is from the centre.
const PLANET_CENTRE = { cx: 5, cy: 8 };
type Painter = (dx: number, dy: number) => CellClass | null;
// The face is lit toward the galaxy, so a soft highlight sits lower right of centre.
const lit = (dx: number, dy: number, size: number): boolean => Math.hypot(dx - size * 0.25, dy - size * 0.25) < size * 0.5;
// A plain disc with a dim limb; `face` paints the markings, `name` prefixes every class.
const disc = (name: Planet, r: number, face: (dx: number, dy: number) => string): Painter => (dx, dy) => {
  const d = Math.hypot(dx, dy);
  if (d > r) return null;
  return `pl-${name}-${d > r - 1.5 ? 'limb' : face(dx, dy)}`;
};
// A ring as an annulus of a tilted ellipse (plus an optional inner ring): the near half draws over the body.
const ring = (name: Planet, rx: number, ry: number, tilt: number, body: Painter, inner = true): Painter => (dx, dy) => {
  const u = dx * Math.cos(tilt) + dy * Math.sin(tilt);
  const v = -dx * Math.sin(tilt) + dy * Math.cos(tilt);
  const e = Math.hypot(u / rx, v / ry);
  const band = e <= 1 && e >= 0.86 ? 'ring' : inner && e < 0.76 && e >= 0.6 ? 'ring-in' : null;
  const front = band && (rx > ry ? v > 0 : u > 0);
  if (band && front) return `pl-${name}-${band}`;
  return body(dx, dy) ?? (band ? `pl-${name}-${band}` : null);
};

const PAINTERS: Record<Planet, Painter> = {
  mercury: disc('mercury', 18, (dx, dy) => {
    const craters: readonly Blob[] = [[6, 2, 3, 2.5], [-2, 10, 2.5, 2], [10, 10, 2, 1.6], [1, -6, 2, 1.6], [12, -2, 1.5, 1.3]];
    for (const [cx, cy, rx, ry] of craters) {
      if (inEllipse(dx, dy, cx + 0.6, cy + 0.6, rx * 0.6, ry * 0.6)) return 'crater-lit';
      if (inEllipse(dx, dy, cx, cy, rx, ry)) return 'crater';
    }
    return lit(dx, dy, 18) ? 'lit' : 'body';
  }),
  venus: disc('venus', 18, (dx, dy) => {
    const wave = dy + Math.sin(dx / 3) * 1.2;
    if ((wave > -6 && wave < -4) || (wave > 3 && wave < 5) || wave > 12) return 'band';
    if (wave > 8 && wave < 9.5) return 'haze';
    return lit(dx, dy, 18) ? 'lit' : 'body';
  }),
  earth: disc('earth', 18, (dx, dy) => {
    if (dy > 15 || dy < -15) return 'ice';
    const wisps: readonly Blob[] = [[3, -9, 5, 0.8], [12, 3, 3, 0.7], [-4, 3, 4, 0.8], [6, 12, 4, 0.7], [-6, -4, 3, 0.7]];
    if (wisps.some(([cx, cy, rx, ry]) => inEllipse(dx, dy, cx, cy, rx, ry))) return 'cloud';
    if (inEllipse(dx, dy, 8, -2, 4, 6) || inEllipse(dx, dy, 11, 6, 3, 3)) return inEllipse(dx, dy, 9, 1, 2, 2) ? 'desert' : 'land';
    if (inEllipse(dx, dy, -2, 9, 3, 4)) return 'land';
    return lit(dx, dy, 18) ? 'lit' : 'body';
  }),
  mars: disc('mars', 18, (dx, dy) => {
    if (inEllipse(dx, dy, 3, 18, 9, 5)) return 'cap';
    if (inEllipse(dx, dy, 6, 5, 4.5, 2) || inEllipse(dx, dy, 1, 9, 5, 1.6) || inEllipse(dx, dy, 12, 1, 2, 3)) return 'sea';
    return lit(dx, dy, 18) ? 'lit' : 'body';
  }),
  jupiter: disc('jupiter', 18, (dx, dy) => {
    if (inEllipse(dx, dy, 8, 7.5, 3, 1.6)) return 'spot';
    if ((dy > -4 && dy < -1.5) || (dy > 3 && dy < 5.5)) return 'belt';
    if ((dy > -9 && dy < -7.5) || (dy > 10 && dy < 11.5)) return 'belt-d';
    if (dy > 14 || dy < -13) return 'pole';
    return lit(dx, dy, 18) ? 'lit' : 'body';
  }),
  // Saturn sits a little lower so its rings cross open sky.
  saturn: (dx, dy) => ring('saturn', 22, 7, -0.35, disc('saturn', 12, (bx, by) => {
    if ((by > -4 && by < -2.5) || (by > 3 && by < 4.5)) return 'band';
    return lit(bx, by, 12) ? 'lit' : 'body';
  }))(dx + 1, dy - 4),
  uranus: ring('uranus', 7, 21, 0.1, disc('uranus', 15, (dx, dy) => {
    if ((dy > -5 && dy < -3.5) || (dy > 5 && dy < 6.5)) return 'band';
    return lit(dx, dy, 15) ? 'lit' : 'body';
  }), false),
  neptune: disc('neptune', 18, (dx, dy) => {
    if (inEllipse(dx, dy, 7, 8.5, 3, 1.4)) return 'spot';
    if (inEllipse(dx, dy, 2.5, 9.5, 1.4, 0.7)) return 'cloud';
    if ((dy > 1 && dy < 3) || dy > 13.5) return 'belt';
    if ((dy > -5 && dy < -3) || (dy > 4.5 && dy < 6)) return 'band';
    return lit(dx, dy, 18) ? 'lit' : 'body';
  }),
};

const foreground = (x: number, y: number): CellClass | null => galaxy(x, y) ?? constellation(x, y) ?? star(x, y);
const domeSky: Shape = (x, y) => (inDome(x, y) ? foreground(x, y) ?? nebula(x, y) ?? sky(x, y) : null);
// The dome's edge: a lit rim just inside, a dark line outside, so the curve shows on light and dark themes.
const onRim = (x: number, y: number): boolean => inDome(x, y)
  && NEIGHBOURS.some(([dx, dy]) => y + dy <= HORIZON && !inDome(x + dx, y + dy));
const rimmed: Shape = (x, y) => (onRim(x, y) ? 'pl-rim' : domeSky(x, y));
const dome = outlined(rimmed, 'pl-dome-o', (x, y) => inDome(x, y) || y > HORIZON);

// Every planet is drawn over open sky only, so stars and galaxy stay in front; CSS shows the day's one.
const planets: Cell[] = [];
for (let y = 0; y <= HORIZON; y += 1) {
  for (let x = 0; x < 48; x += 1) {
    if (!inDome(x, y) || onRim(x, y) || foreground(x, y)) continue;
    for (const name of PLANETS) {
      const cell = PAINTERS[name](x + 0.5 - PLANET_CENTRE.cx, y + 0.5 - PLANET_CENTRE.cy);
      if (cell) planets.push([x, y, cell]);
    }
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

// The star projector: two dark globes on a stalk, low and right of centre, clear of the planet.
const projector = outlined(stamp(14, 26, [
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
    ...tw(1, [[36, 9], [10, 31], [25, 3]]), ...tw(1, [[45, 33]], '-gold'),
    ...tw(2, [[18, 23], [28, 31], [44, 30]]), ...tw(2, [[3, 36]], '-gold'),
    ...tw(3, [[1, 33], [26, 35], [33, 2]]), ...tw(3, [[39, 4]], '-gold'),
    ...sparkle(10, 27, 1), ...sparkle(29, 28, 2), ...sparkle(25, 6, 3),
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

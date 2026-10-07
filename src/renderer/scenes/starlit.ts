// Starlit Window: a big window onto deep space. A dusty milky-way band, magenta and teal nebulae,
// a ringed planet with a little moon, and dense stars, framed by plum curtains and a quiet sill.
import {
  cellsOf, distanceToSegment, inCircle, layers, outlined, sprite, stamp, type Cell, type CellClass, type Scene, type Shape,
} from './kit';

// Glass inside the frame; the frame is one cell wider on every side.
const GLASS = { left: 9, right: 38, top: 4, bottom: 36 };
const inGlass = (x: number, y: number): boolean => x >= GLASS.left && x <= GLASS.right && y >= GLASS.top && y <= GLASS.bottom;

// Fixed per-cell grain in 0..99, so dithering looks scattered but never changes between renders.
const grain = (x: number, y: number): number => (((x * 374761393 + y * 668265263) ^ (x * y * 2246822519)) >>> 0) % 100;

// Sky: four bands from indigo to violet, each seam dithered so there are no hard stripes.
const SKY = ['st-sky1', 'st-sky2', 'st-sky3', 'st-sky4'];
const BAND_ROWS = 9;
function sky(x: number, y: number): CellClass {
  const row = y - GLASS.top;
  const band = Math.floor(row / BAND_ROWS);
  const seam = row % BAND_ROWS >= BAND_ROWS - 2 && (x + y) % 2 === 0;
  return SKY[Math.min(SKY.length - 1, band + (seam ? 1 : 0))] ?? 'st-sky4';
}

// The milky way runs corner to corner, lower left to upper right, with a dark dust lane along its core.
const BAND = [GLASS.left - 1, GLASS.bottom - 2, GLASS.right + 1, GLASS.top + 1] as const;
const toBand = (x: number, y: number): number => distanceToSegment(x + 0.5, y + 0.5, ...BAND);
function milkyWay(x: number, y: number): CellClass | null {
  const d = toBand(x, y);
  const g = grain(x, y);
  const above = (x - BAND[0]) * (BAND[3] - BAND[1]) - (y - BAND[1]) * (BAND[2] - BAND[0]) > 0;
  if (d >= 0.6 && d <= 1.4 && above && g < 55) return 'st-lane';
  if (d <= 1.6) return g < 55 ? 'st-band-hi' : 'st-band-core';
  if (d <= 3) return g < 80 ? 'st-band-core' : 'st-band';
  if (d <= 4.6) return g < 75 ? 'st-band' : null;
  if (d <= 6.2) return g < 25 ? 'st-band' : null;
  return null;
}

// A nebula is a soft ellipse: a dense core, a dithered middle, then scattered wisps.
interface Nebula { cx: number; cy: number; rx: number; ry: number; core: CellClass; mid: CellClass; wisp: CellClass }
const NEBULAE: readonly Nebula[] = [
  { cx: 31, cy: 15, rx: 7.5, ry: 5.5, core: 'st-neb-rose', mid: 'st-neb-magenta', wisp: 'st-neb-plum' },
  { cx: 16, cy: 26, rx: 7.5, ry: 4.5, core: 'st-neb-teal-l', mid: 'st-neb-teal', wisp: 'st-neb-teal-d' },
];
function nebula(x: number, y: number): CellClass | null {
  const g = grain(x, y);
  for (const n of NEBULAE) {
    // A little wobble so the edge is ragged, not a clean oval.
    const r = Math.hypot((x + 0.5 - n.cx) / n.rx, (y + 0.5 - n.cy) / n.ry) + (grain(y, x) % 20) / 100;
    if (r <= 0.25) return g < 60 ? n.core : n.mid;
    if (r <= 0.6) return g < 55 ? n.mid : g < 90 ? n.wisp : null;
    if (r <= 1) return g < 40 ? n.wisp : null;
  }
  return null;
}

// Background stars: denser inside the milky way, sparser in the pet's corner.
function dust(x: number, y: number): CellClass | null {
  const g = grain(y * 3 + 1, x * 5 + 2);
  const petCorner = x >= 28 && y >= 28;
  if (g < (toBand(x, y) <= 4 ? 12 : petCorner ? 2 : 4)) return g % 4 === 0 ? 'st-star' : 'st-star-dim';
  return null;
}

// Ringed planet, hand-drawn: lit upper left, shaded lower right, two cloud bands. The ring's back arc
// shows either side of the globe; its front arc (lit top, shaded underside) crosses in front.
const PLANET: Record<string, CellClass> = {
  L: 'st-planet-l', P: 'st-planet', b: 'st-planet-band', D: 'st-planet-d', R: 'st-ring', r: 'st-ring-d',
};
const planet = stamp(11, 7, [
  '.......LLLPP.......',
  '......LLPPPPP....rR',
  '.....LLPPPPPPDrrrR.',
  '.....LbbbbbbbD.RR..',
  '.....LPPPPPPDRRr...',
  '...rrPPPPPRRRrr....',
  '.rr..PbRRRrrrD.....',
  'RRRRRRRrrrDDD......',
  '..rrrrrPDDDD.......',
], PLANET);
// A small crescent moon keeping the planet company.
const moon: Shape = (x, y) => {
  if (!inCircle(x + 0.5, y + 0.5, 33.5, 6, 2.1)) return null;
  return inCircle(x + 0.5, y + 0.5, 34.4, 5.3, 1.8) ? 'st-moon-d' : 'st-moon';
};

// The glass, back to front: sky, milky way, nebulae, background stars, moon. The planet lives in `moving`.
const space: Shape = (x, y) => {
  if (!inGlass(x, y)) return null;
  return moon(x, y) ?? dust(x, y) ?? nebula(x, y) ?? milkyWay(x, y) ?? sky(x, y);
};
const frame: Shape = (x, y) => {
  if (x < GLASS.left - 1 || x > GLASS.right + 1 || y < GLASS.top - 1 || y > GLASS.bottom + 1) return null;
  if (inGlass(x, y)) return null;
  return y === GLASS.bottom + 1 ? 'F' : 'f';
};
// Wide sill under the window.
const sill: Shape = (x, y) => (y === GLASS.bottom + 2 && x >= GLASS.left - 2 && x <= GLASS.right + 2 ? 'st-sill' : null);
const windowAndSill = outlined(layers(frame, sill), 'ol-wood', (x, y) => frame(x, y) ?? sill(x, y) ?? (inGlass(x, y) ? 'glass' : null));

// Velvet curtains in plum, gathered by gold tiebacks at row 25, hung from a brass rod.
const TIE = 25;
const rod: Shape = (x, y) => (y === 2 && x >= 5 && x <= 42 ? 'st-rod' : null);
const curtains = outlined((x, y) => {
  if (y < 3 || y > GLASS.bottom + 1) return null;
  const spread = y < TIE ? 0 : Math.floor((y - TIE) / 4);
  const left = x >= 5 && x <= (y < TIE ? 10 : y === TIE ? 7 : 8 + spread);
  const right = x <= 42 && x >= (y < TIE ? 37 : y === TIE ? 40 : 39 - spread);
  if (!left && !right) return null;
  if (y === TIE) return 'T';
  const fold = (left ? x - 5 : 42 - x) % 3;
  return fold === 0 ? 'st-curtain-d' : fold === 1 ? 'st-curtain' : 'st-curtain-l';
}, 'st-curtain-o');

// On the sill, kept small so the sky stays the star: a brass telescope on a tripod and a little star-jar lamp.
const telescope = outlined(stamp(11, 32, [
  '.....AA', '....tT.', '...tT..', '..tT...', '..k....', '.k.k...',
], { A: 'st-brass-l', t: 'st-brass', T: 'st-brass-d', k: 'k' }), 'ol-ink');
const jar = outlined(stamp(20, 35, ['.LL.', 'jgjj', 'jjgj'], { L: 'st-brass', j: 'st-jar', g: 'st-jar-glow' }), 'st-jar-o');

// A low indigo rug with a few gold stars, nothing tall where the pet and her toy sit.
const rug = outlined((x, y) => {
  if (x < 3 || y < 45) return null;
  return grain(x, y) < 9 ? 'ol-gold' : 'st-rug';
}, 'st-rug-o');

// Moving cells: staggered twinkles (1px, 2px and 4-point sparkles), a shooting star, the drifting planet.
type Group = 1 | 2 | 3;
const tw = (group: Group, at: readonly (readonly [number, number])[]): Cell[] => at.map(([x, y]) => [x, y, `st-tw${group}`]);
const big = (x: number, y: number, group: Group): Cell[] => sprite(['ca', 'aa'], x, y, { a: `st-spark${group}`, c: `st-tw${group}` });
const sparkle = (x: number, y: number, group: Group): Cell[] => sprite(['.a.', 'aca', '.a.'], x - 1, y - 1, { a: `st-spark${group}`, c: `st-tw${group}` });
const SHOOTING = sprite(['..f', '.t.', 'h..'], 34, 8, { h: 'st-shoot', t: 'st-trail', f: 'st-trail-faint' });

const scene: Scene = {
  name: 'Starlit Window',
  size: [48, 48],
  paint: layers(telescope, jar, curtains, rod, windowAndSill, space, rug),
  moving: [
    ...tw(1, [[11, 6], [27, 4], [36, 16], [22, 22], [13, 30], [33, 26]]),
    ...tw(2, [[20, 4], [12, 19], [29, 21], [37, 31], [24, 30], [19, 17]]),
    ...tw(3, [[36, 4], [12, 9], [27, 13], [21, 27], [30, 33], [16, 21]]),
    ...big(24, 17, 1), ...big(35, 20, 3), ...big(31, 23, 2),
    ...sparkle(24, 5, 1), ...sparkle(19, 32, 2), ...sparkle(35, 12, 3), ...sparkle(12, 23, 3),
    ...SHOOTING,
    ...cellsOf(planet, 11, 7, 29, 15),
  ],
};
export default scene;

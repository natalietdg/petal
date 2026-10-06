// Winter Fireplace: a brick fireplace with stockings and a crackling fire, and a snowy window behind the pet.
// Clarity rules: every object is ringed by a 1px outline in a darker tone of its own material, lit top-left.
import { inCircle, inEllipse, type CellClass, type Cell, type Scene, type Shape } from './kit';

// Layout in sprite pixels on the 48x48 canvas.
const OPENING = { left: 8, right: 19, top: 25, bottom: 43 };
const FIRE_BASE = 38;
const GLASS = { left: 28, right: 46, top: 3, bottom: 20 };
const ARCH = { cx: 37, cy: 12, r: 9.45 };
const GROUND = 19; // first row of snowy ground inside the window

// Wraps a shape so every empty cell touching it (4-way) becomes its outline colour.
const NEIGHBOURS: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
function outlined(shape: Shape, ink: CellClass): Shape {
  return (x, y) => shape(x, y) ?? (NEIGHBOURS.some(([dx, dy]) => shape(x + dx, y + dy)) ? ink : null);
}
// Stacks layers front to back: the first one with a colour at (x, y) wins.
const stack = (...layers: Shape[]): Shape => (x, y) => {
  for (const layer of layers) {
    const cell = layer(x, y);
    if (cell) return cell;
  }
  return null;
};
const inBox = (x: number, y: number, left: number, right: number, top: number, bottom: number): boolean => x >= left && x <= right && y >= top && y <= bottom;

// Bricks are 6x3 with mortar, every other row offset by half a brick; lit top row, a few darker bricks.
function brick(x: number, y: number, shadedFrom: number): CellClass {
  const row = Math.floor(y / 3);
  const shifted = x + (row % 2) * 3;
  if (y % 3 === 2 || shifted % 6 === 5) return x >= shadedFrom ? 'w-mortar-d' : 'w-mortar';
  const id = Math.floor(shifted / 6) * 7 + row * 13;
  const tone = id % 5 === 0 ? 'w-brick-d' : 'w-brick';
  if (x >= shadedFrom) return 'w-brick-d';
  return y % 3 === 0 && tone === 'w-brick' ? 'w-brick-l' : tone;
}
const chimney = outlined((x, y) => (inBox(x, y, 4, 23, 0, 14) ? brick(x, y, 22) : null), 'w-brick-ink');
const body = outlined((x, y) => (inBox(x, y, 2, 25, 20, 42) ? brick(x, y, 24) : null), 'w-brick-ink');

// Candles on the mantel: lit left column, shaded right column.
const CANDLES = [5, 21];
const candles = outlined((x, y) => {
  const cx = CANDLES.find((left) => x === left || x === left + 1);
  if (cx === undefined || y < 11 || y > 14) return null;
  return x === cx ? 'w-candle' : 'w-candle-d';
}, 'w-candle-ink');

// Garland draped along the mantel top, with a sprig every third pixel.
function garland(x: number, y: number): CellClass | null {
  if (y === 15 && x >= 2 && x <= 25) return (x * 3) % 5 === 0 ? 'w-berry' : x % 2 ? 'w-leaf' : 'w-leaf-d';
  if (y === 14 && x >= 6 && x <= 21 && x % 3 === 0) return 'w-leaf-l';
  return null;
}
const garlandInk = outlined(garland, 'w-green-ink');

// Mantel: lit top, face, shadowed underside.
const mantel = outlined((x, y) => (inBox(x, y, 1, 25, 16, 18) ? (['w-wood-l', 'w-wood', 'w-wood-d'] as const)[y - 16] : null), 'w-wood-ink');

// Stockings: w cuff, r body, t toe. Shading comes from the shape: lit left edge, shaded right and bottom.
const STOCKING = [
  'wwwww..',
  'wwwww..',
  '.rrr...',
  '.rrr...',
  '.rrr...',
  '.rrr...',
  '.rrrr..',
  '.rrrrtt',
  '.rrrrtt',
];
function stockingShape(left: number, top: number, colour: string, mirrored: boolean): Shape {
  const at = (x: number, y: number): string | null => {
    const row = STOCKING[y - top];
    const cell = row?.[mirrored ? left + 6 - x : x - left];
    return cell && cell !== '.' ? cell : null;
  };
  const shape: Shape = (x, y) => {
    const cell = at(x, y);
    if (!cell) return null;
    const row = y - top;
    if (cell === 'w') return row === 0 && at(x + 1, y) ? 'w-cuff' : 'w-cuff-d';
    if (cell === 't') return row === STOCKING.length - 1 ? 'w-cuff-d' : 'w-cuff';
    if (at(x + 1, y) !== 'r' || !at(x, y + 1)) return `${colour}-d`;
    return at(x - 1, y) !== 'r' ? `${colour}-l` : colour;
  };
  return outlined(shape, `${colour}-ink`);
}
const stockings = stack(stockingShape(2, 20, 'w-red', false), stockingShape(19, 20, 'w-green', true));

// Wreath on the chimney breast: a ring of leaves lit top-left, four berries, a red bow at the bottom.
const WREATH = { cx: 14, cy: 7, outer: 4.4, inner: 2.1 };
const BERRIES: readonly (readonly [number, number])[] = [[11, 4], [17, 6], [11, 9], [16, 10]];
const wreath = outlined((x, y) => {
  const d = Math.hypot(x + 0.5 - WREATH.cx, y + 0.5 - WREATH.cy);
  if (d > WREATH.outer || d <= WREATH.inner) return null;
  if (BERRIES.some(([bx, by]) => bx === x && by === y)) return 'w-berry';
  return x + y < 19 ? 'w-leaf-l' : x + y > 23 ? 'w-leaf-d' : 'w-leaf';
}, 'w-green-ink');
const BOW = ['qr..qr', '.rqqR.', '.r..R.'];
const bow = outlined((x, y) => {
  const cell = BOW[y - 10]?.[x - 11];
  if (!cell || cell === '.') return null;
  return ({ q: 'w-red-l', r: 'w-red', R: 'w-red-d' } as Record<string, CellClass>)[cell];
}, 'w-red-ink');

// Firebox: the arched opening, its stone surround, logs on an iron grate.
const inArch = (x: number, y: number): boolean => {
  const { left, right, top, bottom } = OPENING;
  if (x < left || x > right || y < top || y > bottom) return false;
  return y >= top + 3 || inEllipse(x + 0.5, y + 0.5, 14, top + 3.5, 6.5, 3.6);
};
function grate(x: number, y: number): CellClass | null {
  if (!inArch(x, y)) return null;
  if (y === OPENING.bottom) return 'w-iron';
  return y === 42 && (x === 9 || x === 18) ? 'w-iron' : null; // andiron feet
}
// Two logs: the top one sits in front, its outline crossing the lower log. End grain faces the light.
const topLog = outlined((x, y) => {
  if (!inBox(x, y, 12, 15, 39, 40)) return null;
  return x === 15 ? 'w-logend' : y === 39 ? 'w-log-l' : 'w-log';
}, 'w-log-ink');
const lowLog = outlined((x, y) => {
  if (!inBox(x, y, 10, 17, 41, 42)) return null;
  return x === 10 ? 'w-logend' : y === 41 ? 'w-log-l' : 'w-log';
}, 'w-log-ink');
const logs: Shape = (x, y) => (inArch(x, y) && x > OPENING.left && x < OPENING.right ? topLog(x, y) ?? lowLog(x, y) : null);
function firebox(x: number, y: number): CellClass | null {
  if (!inArch(x, y)) return null;
  if (x === OPENING.left || x === OPENING.right) return 'w-side';
  if (inEllipse(x + 0.5, y + 0.5, 14, 37, 5, 6)) return 'w-box-lit';
  return y < 32 ? 'w-soot' : 'w-box';
}
const AROUND: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
const surround = outlined((x, y) => {
  if (inArch(x, y) || y > OPENING.bottom || !AROUND.some(([dx, dy]) => inArch(x + dx, y + dy))) return null;
  if (y < OPENING.top + 3 || x < 14) return 'w-stone-l';
  return x > OPENING.right ? 'w-stone-d' : 'w-stone';
}, 'w-stone-ink');

// Stone hearth: lit top edge, face, shaded base.
const hearth = outlined((x, y) => (inBox(x, y, 1, 25, 44, 46) ? (['w-stone-l', 'w-stone', 'w-stone-d'] as const)[y - 44] : null), 'w-stone-ink');

// Knitted rug under the pet: red border around cream and red V stitches.
const rug = outlined((x, y) => {
  if (!inEllipse(x + 0.5, y + 0.5, 38, 46, 9.5, 2.2)) return null;
  if (!inEllipse(x + 0.5, y + 0.5, 38, 46, 8.5, 1.4)) return 'w-red-d';
  return (x + y) % 2 ? 'w-knit' : 'w-knit-d';
}, 'w-red-ink');

// Window: a round-topped pane, grown by `grow` pixels (0 glass, 1 frame, 2 outline).
const inWindow = (x: number, y: number, grow: number): boolean => x >= GLASS.left - grow && x <= GLASS.right + grow && y <= GLASS.bottom + grow
  && (y >= ARCH.cy ? true : inCircle(x, y, ARCH.cx, ARCH.cy, ARCH.r + grow));
const insideGlass = (x: number, y: number): boolean => inWindow(x, y, 0);

// Pines: stacked tiers with a snowy tip, shaded right, a short trunk. Front pines first.
const PINE = [
  '..s..',
  '.PPp.',
  '.PPp.',
  'PPPpp',
  '.PPp.',
  'PPPpp',
  '..t..',
];
const PINES: readonly (readonly [number, number])[] = [[30, 12], [44, 13], [34, 13]];
const pine = (cx: number, tipY: number): Shape => outlined((x, y) => {
  const cell = PINE[y - tipY]?.[x - cx + 2];
  if (!cell || cell === '.') return null;
  return ({ s: 'w-snow', P: 'w-pine', p: 'w-pine-d', t: 'w-wood-d' } as Record<string, CellClass>)[cell];
}, 'w-pine-ink');
const pines = stack(...PINES.map(([cx, tipY]) => pine(cx, tipY)));

// Mountains: 45-degree slopes, snow caps, a lit left face and shaded right face, a dark ridge line.
const PEAKS: readonly (readonly [number, number])[] = [[30, 8], [41, 10], [46, 7]];
function mountain(x: number, y: number): CellClass | null {
  let top = GROUND;
  let peak = null as { px: number; summit: number } | null; // `as`: set inside forEach, which narrowing cannot see
  PEAKS.forEach(([px, height]) => {
    const slopeTop = GROUND - Math.max(0, height - Math.abs(x - px));
    if (slopeTop < top) [top, peak] = [slopeTop, { px, summit: GROUND - height }];
  });
  if (!peak || y < top - 1) return null;
  if (y === top - 1) return 'w-ridge';
  const shaded = x > peak.px;
  if (y <= top + 1 && y <= peak.summit + 3) return shaded ? 'w-snow-d' : 'w-snow'; // cap near the summit only
  return shaded ? 'w-mtn-d' : 'w-mtn';
}

const MOON = ['.mm', 'mm.', 'm..', 'mm.', '.mm']; // crescent, top-left of the pane

function view(x: number, y: number): CellClass {
  if (x === ARCH.cx && y >= 4) return 'w-wood'; // mullion
  // Frost creeping in from the bottom corners.
  if ((x - GLASS.left) + (GLASS.bottom - y) < 3 || (GLASS.right - x) + (GLASS.bottom - y) < 3) return 'w-frost';
  if (MOON[y - 4]?.[x - 33] === 'm') return 'w-moon';
  const tree = pines(x, y);
  if (tree && (tree !== 'w-pine-ink' || y < GROUND)) return tree; // no outline across the snow
  if (y >= GROUND) return y === GROUND && x % 3 === 0 ? 'w-snow-d' : 'w-snow';
  return mountain(x, y) ?? (y <= 7 ? 'w-sky1' : y <= 11 ? 'w-sky2' : y <= 15 ? 'w-sky3' : 'w-sky4');
}
// Glass and frame: frame lit on its top-left half, shaded bottom-right.
function windowPane(x: number, y: number): CellClass | null {
  if (insideGlass(x, y)) return view(x, y);
  if (!inWindow(x, y, 1)) return null;
  return (x - ARCH.cx) + (y - ARCH.cy) < 0 ? 'w-wood-l' : 'w-wood-d';
}
const windowInk: Shape = (x, y) => (inWindow(x, y, 2) && !inWindow(x, y, 1) ? 'w-wood-ink' : null);
const sill = outlined((x, y) => (inBox(x, y, 27, 47, 22, 23) ? (y === 22 ? 'w-wood-l' : 'w-wood-d') : null), 'w-wood-ink');

// Front to back. Fill-only layers sit ahead of outlines that must not cut into them.
const paint = stack(
  windowPane, sill, windowInk,
  candles, bow, wreath, garland, mantel, garlandInk,
  stockings,
  grate, logs, firebox, surround,
  hearth, body, chimney,
  rug,
);

// Warm light spilling over the surround and hearth.
const glow: Cell[] = [];
for (let y = 22; y <= 46; y += 1) {
  for (let x = 2; x <= 25; x += 1) {
    if (inEllipse(x + 0.5, y + 0.5, 14, 40, 12, 9) && !inArch(x, y)) glow.push([x, y, 'w-glow']);
  }
}

// Each tongue is [cx, height, half-width]; two frames alternate so the fire always flickers.
type Tongue = readonly [cx: number, height: number, halfWidth: number];
const TONGUES: Record<'a' | 'b', readonly Tongue[]> = {
  a: [[10.8, 6, 1.7], [14, 10, 2.8], [17, 7, 1.8]],
  b: [[11.2, 8, 1.7], [13.6, 8, 2.8], [16.6, 9, 1.8]],
};
const LAYERS = [1, 0.75, 0.52, 0.3]; // red, orange, yellow, white-hot core
function flameLayer(x: number, y: number, tongues: readonly Tongue[]): number {
  let deepest = -1;
  tongues.forEach(([cx, height, halfWidth]) => {
    LAYERS.forEach((scale, layer) => {
      const h = height * scale;
      const t = (FIRE_BASE + 1 - y) / (h + 1);
      if (t <= 0 || t > 1) return;
      const width = halfWidth * scale * (1 - t) ** 0.7 + 0.35;
      if (Math.abs(x + 0.5 - cx) <= width) deepest = Math.max(deepest, layer);
    });
  });
  return deepest;
}
const flameCells = (frame: 'a' | 'b'): Cell[] => {
  const cells: Cell[] = [];
  for (let y = FIRE_BASE - 11; y <= FIRE_BASE + 1; y += 1) {
    for (let x = OPENING.left + 1; x < OPENING.right; x += 1) {
      const layer = flameLayer(x, y, TONGUES[frame]);
      if (layer >= 0) cells.push([x, y, `w-f${frame}${layer + 1}`]);
    }
  }
  return cells;
};

const scene: Scene = {
  name: 'Winter Fireplace',
  size: [48, 48],
  paint,
  moving: [
    ...glow,
    ...flameCells('a'),
    ...flameCells('b'),
    // Sparks rising off the fire.
    [12, 29, 'w-spark'], [15, 27, 'w-spark2'], [17, 30, 'w-spark'],
    // Candle flames, over each candle's lit column.
    ...CANDLES.map((x): Cell => [x, 10, 'w-cf']),
    // Snowflakes in three staggered waves.
    [31, 4, 'w-sn1'], [35, 6, 'w-sn2'], [40, 4, 'w-sn3'], [44, 7, 'w-sn1'],
    [30, 9, 'w-sn3'], [39, 9, 'w-sn2'], [34, 13, 'w-sn1'], [43, 13, 'w-sn3'], [38, 14, 'w-sn2'],
  ],
};
export default scene;

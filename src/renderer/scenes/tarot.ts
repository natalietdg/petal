// Tarot Room: a reader's velvet-draped room. The day's card stands lit on a round table, the focal point,
// with a crystal ball, two candles and a few face-down cards; a gold moon and stars are stencilled on the wall.
import { inCircle, inEllipse, layers, outlined, sprite, type Cell, type CellClass, type Scene, type Shape } from './kit';
import { faces } from './tarot-emblems';

// The face-up card, standing on the table: gold edge, cream face.
const CARD = { left: 7, right: 21, top: 9, bottom: 29 };
const inCard = (x: number, y: number): boolean => x >= CARD.left && x <= CARD.right && y >= CARD.top && y <= CARD.bottom;
const card = outlined((x, y) => {
  if (!inCard(x, y)) return null;
  return x === CARD.left || x === CARD.right || y === CARD.top || y === CARD.bottom ? 'tr-card-edge' : 'tr-card-face';
}, 'tr-card-o');

// Its warm light on the wall, in two soft rings around the card's middle.
const GLOW = { cx: 14.5, cy: 19, rx: 11.5, ry: 14 };
function cardGlow(x: number, y: number): CellClass | null {
  if (inEllipse(x + 0.5, y + 0.5, GLOW.cx, GLOW.cy, GLOW.rx - 2.5, GLOW.ry - 2.5)) return 'tr-glow1';
  return inEllipse(x + 0.5, y + 0.5, GLOW.cx, GLOW.cy, GLOW.rx, GLOW.ry) ? 'tr-glow2' : null;
}

// A crystal ball on a gold stand, right of the card: lit upper left, shaded lower right.
const BALL = { cx: 26, cy: 25, r: 3.3 };
const ball = outlined(layers(
  (x, y) => {
    if (!inCircle(x + 0.5, y + 0.5, BALL.cx, BALL.cy, BALL.r)) return null;
    const dx = x + 0.5 - BALL.cx;
    const dy = y + 0.5 - BALL.cy;
    if (dx < -1 && dy < -1) return 'tr-ball-l';
    return dx + dy > 1.6 ? 'tr-ball-d' : 'tr-ball';
  },
  (x, y) => (y === 28 && x >= 24 && x <= 27 ? 'tr-gold' : y === 29 && x >= 23 && x <= 28 ? 'tr-gold-d' : null),
), 'tr-ball-o');

// Two cream candles on the left, a tall one and a short one, each lit on its left face.
const CANDLES = [{ left: 0, top: 20 }, { left: 3, top: 25 }] as const;
const CANDLE_BOTTOM = 30;
const candles: Shape = (x, y) => {
  const candle = CANDLES.find(({ left, top }) => x >= left && x <= left + 2 && y >= top && y <= CANDLE_BOTTOM);
  if (!candle) return null;
  if (y === candle.top || x === candle.left) return 'tr-wax-l';
  return x === candle.left + 2 ? 'tr-wax-d' : 'tr-wax';
};
// Warm candlelight on the wall around each flame.
const candleGlow: Shape = (x, y) => (CANDLES.some(({ left, top }) => inCircle(x + 0.5, y + 0.5, left + 1.5, top - 2.5, 3.6)) ? 'tr-candle-glow' : null);

// Round table under an indigo velvet cloth: lit top with a gold rim, a drape with folds, a hem that curves round the front.
const TABLE = { cx: 14, cy: 31, rx: 15.5, ry: 3, hem: 41 };
const onTop = (x: number, y: number): boolean => inEllipse(x + 0.5, y + 0.5, TABLE.cx, TABLE.cy, TABLE.rx, TABLE.ry);
const across = (x: number): number => Math.max(0, 1 - ((x + 0.5 - TABLE.cx) / TABLE.rx) ** 2);
const hemAt = (x: number): number => TABLE.hem - 2 + Math.round(2 * Math.sqrt(across(x)));
function table(x: number, y: number): CellClass | null {
  if (onTop(x, y)) return onTop(x, y + 1) ? 'tr-cloth-top' : 'tr-trim';
  if (y < TABLE.cy || across(x) === 0 || y > hemAt(x)) return null;
  if (y === hemAt(x)) return 'tr-trim';
  const fold = (x + 2) % 6;
  if (y >= TABLE.cy + 4 && fold === 0) return 'tr-cloth-fold';
  return fold === 5 ? 'tr-cloth-l' : 'tr-cloth';
}

// Two spare cards face down on the cloth, front left, one overlapping the other: gold border, plum back.
const SPARES = [{ left: 4, top: 32 }, { left: 1, top: 31 }] as const;
const spares: Shape = (x, y) => {
  const spare = SPARES.find(({ left, top }) => x >= left && x <= left + 6 && y >= top && y <= top + 2);
  if (!spare) return null;
  return y === spare.top + 1 && x > spare.left && x < spare.left + 6 ? 'tr-back' : 'tr-back-l';
};

// A plum velvet valance along the top: lit lower fold, gold trim, a tassel every eight cells.
function valance(x: number, y: number): CellClass | null {
  if (y <= 1) return 'tr-velvet';
  if (y === 2) return 'tr-velvet-l';
  if (y === 3) return 'tr-trim';
  return x % 8 === 4 && y <= 5 ? 'tr-tassel' : null;
}

// A plum curtain on the right, gathered by a gold tieback, falling behind the cat.
const TIE = 20;
const curtainLeft = (y: number): number => (y <= TIE ? 40 + Math.round((y / TIE) * 3) : 43 - Math.min(2, Math.round((y - TIE) / 4)));
const curtain = outlined((x, y) => {
  if (y < 1 || y > 40 || x < curtainLeft(y)) return null;
  if (y === TIE || y === TIE + 1) return 'tr-gold';
  if (x === curtainLeft(y)) return 'tr-velvet-l';
  return (x - curtainLeft(y)) % 3 === 2 ? 'tr-velvet-d' : 'tr-velvet';
}, 'tr-velvet-o');

// Stencilled on the wall in muted gold: a crescent moon and a few four-point stars.
const MOON = { cx: 32.5, cy: 12.5, r: 4.6, bite: [34.6, 11.2, 4] as const };
const moon: Shape = (x, y) => {
  const [px, py] = [x + 0.5, y + 0.5];
  return inCircle(px, py, MOON.cx, MOON.cy, MOON.r) && !inCircle(px, py, ...MOON.bite) ? 'tr-motif' : null;
};
const STARS: readonly (readonly [number, number])[] = [[26, 7], [37, 19], [29, 21], [3, 9]];
const stars: Shape = (x, y) => (STARS.some(([sx, sy]) => Math.abs(x - sx) + Math.abs(y - sy) === 1) ? 'tr-motif-d' : null);

const wall: Shape = (_x, y) => (y < 41 ? 'tr-wall' : null);
// Dark floorboards with a lit front edge of the room and the table's shadow.
const floor: Shape = (x, y) => {
  if (y < 41) return null;
  if (y === 41) return across(x) > 0 ? 'tr-floor-d' : 'tr-floor-l';
  return 'tr-floor';
};

// Flames flicker on their own, so they are moving cells: tip, body, hot core over a dark wick.
const flame = (left: number, top: number, n: 1 | 2): Cell[] => sprite(['.t.', 'tft', 'fcf', '.c.', '.k.'], left, top - 5, {
  t: `tr-flame-tip${n}`, f: `tr-flame${n}`, c: 'tr-flame-core', k: 'tr-wick',
});
// The ball's mist swirls and its glint winks.
const MIST: readonly (readonly [number, number])[] = [[25, 25], [26, 24], [27, 25], [26, 26], [24, 26]];
const TWINKLES: Cell[] = STARS.map(([x, y]) => [x, y, 'tr-twinkle']);

const scene: Scene = {
  name: 'Tarot Room',
  size: [48, 48],
  paint: layers(card, spares, ball, candles, table, valance, curtain, moon, stars, candleGlow, cardGlow, floor, wall),
  moving: [
    ...flame(CANDLES[0].left, CANDLES[0].top, 1),
    ...flame(CANDLES[1].left, CANDLES[1].top, 2),
    ...MIST.map(([x, y]): Cell => [x, y, 'tr-mist']),
    [24, 23, 'tr-glint'],
    ...TWINKLES,
  ],
  // Every card's face; tarot.css shows the day's one (data-tr-card on the root).
  variants: faces({ left: CARD.left + 1, right: CARD.right - 1, numeralTop: CARD.top + 2, emblemTop: CARD.top + 8 }),
};
export default scene;

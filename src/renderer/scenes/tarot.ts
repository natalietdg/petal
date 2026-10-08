// Tarot Room: a veiled reader sits at a round table with her crystal ball and a spread of face-down cards.
// The day's card glows on a shelf on the right, above the cat; a gold moon and stars are stencilled on the wall.
import { inCircle, inEllipse, layers, outlined, sprite, type Cell, type CellClass, type Scene, type Shape } from './kit';
import { faces } from './tarot-emblems';

// The face-up card, propped on the shelf above the cat: gold edge, cream face.
const CARD = { left: 29, right: 43, top: 5, bottom: 25 };
const inCard = (x: number, y: number): boolean => x >= CARD.left && x <= CARD.right && y >= CARD.top && y <= CARD.bottom;
const card = outlined((x, y) => {
  if (!inCard(x, y)) return null;
  return x === CARD.left || x === CARD.right || y === CARD.top || y === CARD.bottom ? 'tr-card-edge' : 'tr-card-face';
}, 'tr-card-o');

// Its warm light on the wall, in two soft rings around the card's middle.
const GLOW = { cx: 36.5, cy: 15.5, rx: 13, ry: 15.5 };
function cardGlow(x: number, y: number): CellClass | null {
  if (inEllipse(x + 0.5, y + 0.5, GLOW.cx, GLOW.cy, GLOW.rx - 3, GLOW.ry - 3)) return 'tr-glow1';
  return inEllipse(x + 0.5, y + 0.5, GLOW.cx, GLOW.cy, GLOW.rx, GLOW.ry) ? 'tr-glow2' : null;
}

// A shelf under the card: gold lip, dark wood, two small brackets clear of the cat's ears.
const SHELF = { left: 27, right: 45, top: 26 };
const shelf: Shape = (x, y) => {
  if (x < SHELF.left || x > SHELF.right) return null;
  if (y === SHELF.top) return 'tr-gold';
  if (y === SHELF.top + 1) return 'tr-shelf';
  const bracket = x === SHELF.left + 1 || x === SHELF.right - 1;
  return bracket && y === SHELF.top + 2 ? 'tr-gold-d' : null;
};

// The reader sits centred on this column, behind the table.
const MID = 14.5;

// Her bandana: a dome with a lit left edge and shaded right, coins along the band, a knot and tails on her left.
const inDome = (x: number, y: number): boolean => y <= 11 && inEllipse(x + 0.5, y + 0.5, MID, 12, 6.2, 6);
const TAILS: readonly (readonly [number, number])[] = [[6, 13], [6, 14], [5, 15], [7, 13], [7, 14], [7, 15], [6, 16]];
function bandana(x: number, y: number): CellClass | null {
  if (inDome(x, y)) {
    if (y === 10) return 'tr-rd-scarf-d';
    if (y === 11) return x % 2 === 0 ? 'tr-gold' : null;
    if (!inDome(x + 1, y)) return 'tr-rd-scarf-d';
    return (!inDome(x - 1, y) || !inDome(x, y - 1)) && x < MID ? 'tr-rd-scarf-l' : 'tr-rd-scarf';
  }
  if (inCircle(x + 0.5, y + 0.5, 7.5, 11.5, 1.3)) return 'tr-rd-scarf-d';
  return TAILS.some(([tx, ty]) => tx === x && ty === y) ? 'tr-rd-scarf' : null;
}

// A sheer veil from the band, flaring as it falls to a point below the chin; her face is a darker shape behind it.
// Dark hair shows at her temples, outside the veil.
const VEIL = { top: 11, halfWidth: [4, 4, 4, 5, 5, 5, 6, 6, 6, 6, 6] };
const veilHalf = (y: number): number => VEIL.halfWidth[y - VEIL.top] ?? -1;
const veilHem = (x: number): number => 21 - Math.floor(Math.abs(x - 14) / 3);
function veil(x: number, y: number): CellClass | null {
  const half = veilHalf(y);
  if (y < VEIL.top || y > veilHem(x) || Math.abs(x - 14) > half) return null;
  if (y === veilHem(x)) return 'tr-rd-veil-l';
  if (inEllipse(x + 0.5, y + 0.5, MID, 15.5, 2.8, 3.6)) return 'tr-rd-face';
  if (x === 14 - half) return 'tr-rd-veil-l';
  return x === 14 + half ? 'tr-rd-veil-d' : 'tr-rd-veil';
}
const hair: Shape = (x, y) => (y >= VEIL.top && y <= 13 && (x === 9 || x === 19) ? 'tr-rd-hair' : null);

// Her robe: round shoulders, lit on the candle side, with a fold down the inside of each arm.
function robe(x: number, y: number): CellClass | null {
  if (y < 18 || !inEllipse(x + 0.5, y + 0.5, MID, 30.5, 10, 12)) return null;
  if (!inEllipse(x - 0.5, y + 0.5, MID, 30.5, 10, 12)) return 'tr-rd-robe-l';
  if (!inEllipse(x + 1.5, y + 0.5, MID, 30.5, 10, 12)) return 'tr-rd-robe-d';
  return y >= 22 && (x === 10 || x === 18) ? 'tr-rd-robe-d' : 'tr-rd-robe';
}
const reader = outlined(layers(bandana, veil, hair, robe), 'tr-rd-o');

// Her hands rest on the cloth either side of the ball, gold cuffs at the wrists.
const HANDS = [7, 19] as const;
const hands = outlined((x, y) => {
  const left = HANDS.find((h) => x >= h && x <= h + 2);
  if (left === undefined || y < 28 || y > 30) return null;
  if (y === 28) return 'tr-trim';
  return y === 30 && x === left + 2 ? 'tr-rd-hand-d' : 'tr-rd-hand';
}, 'tr-rd-o');

// A crystal ball on a gold stand between her hands: lit upper left, shaded lower right.
const BALL = { cx: MID, cy: 26, r: 3.2 };
const ball = outlined(layers(
  (x, y) => {
    if (!inCircle(x + 0.5, y + 0.5, BALL.cx, BALL.cy, BALL.r)) return null;
    const dx = x + 0.5 - BALL.cx;
    const dy = y + 0.5 - BALL.cy;
    if (dx < -1 && dy < -1) return 'tr-ball-l';
    return dx + dy > 1.6 ? 'tr-ball-d' : 'tr-ball';
  },
  (x, y) => (y === 29 && x >= 12 && x <= 16 ? 'tr-gold' : y === 30 && x >= 11 && x <= 17 ? 'tr-gold-d' : null),
), 'tr-ball-o');

// A spread of three face-down cards in front of her: gold border, plum back.
const SPREAD = [6, 12, 18] as const;
const SPREAD_TOP = 31;
const spread: Shape = (x, y) => {
  const left = SPREAD.find((s) => x >= s && x <= s + 4);
  if (left === undefined || y < SPREAD_TOP || y > SPREAD_TOP + 2) return null;
  return y === SPREAD_TOP + 1 && x > left && x < left + 4 ? 'tr-back' : 'tr-back-l';
};

// Two cream candles on the left, a tall one and a short one, each lit on its left face.
const CANDLES = [{ left: 0, top: 19 }, { left: 3, top: 24 }] as const;
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
const onDrape = (x: number, y: number): boolean => y > TABLE.cy && across(x) > 0 && y < hemAt(x) && !onTop(x, y);
// Two deep folds fall to the floor, each with a lit ridge on its candle side.
const FOLDS: readonly number[] = [4, 24];
// A soft sheen on the velvet top, right of the cards.
const SHEEN = { y: 30, left: 23, right: 26 };
function cloth(x: number, y: number): CellClass {
  if (!onDrape(x, y - 1)) return 'tr-cloth-d';
  if (FOLDS.includes(x)) return 'tr-cloth-fold';
  return FOLDS.includes(x + 1) ? 'tr-cloth-l' : 'tr-cloth';
}
function table(x: number, y: number): CellClass | null {
  if (onTop(x, y)) {
    if (!onTop(x, y + 1)) return 'tr-trim';
    return y === SHEEN.y && x >= SHEEN.left && x <= SHEEN.right ? 'tr-cloth-sheen' : 'tr-cloth-top';
  }
  if (y < TABLE.cy || across(x) === 0 || y > hemAt(x)) return null;
  return y === hemAt(x) ? 'tr-trim' : cloth(x, y);
}

// Gold embroidery on the front drop: a sun medallion in the middle, a crescent either side, a stitched border above the hem.
const SUN = { cx: 14, cy: 37 };
function sunMedallion(x: number, y: number): CellClass | null {
  const [dx, dy] = [x - SUN.cx, y - SUN.cy];
  const [ax, ay] = [Math.abs(dx), Math.abs(dy)];
  if (Math.max(ax, ay) <= 2 && ax + ay <= 3) {
    if (dx + dy >= 2) return 'tr-emb';
    return dx + dy <= -2 ? 'tr-emb-hi' : 'tr-emb-l';
  }
  return (ax === 3 && dy === 0) || (dx === 0 && dy === 3) ? 'tr-emb-l' : null;
}
const motif = (rows: readonly string[], left: number, top: number): Shape => (x, y) => (rows[y - top]?.[x - left] === '#' ? 'tr-emb' : null);
const crescents = layers(motif(['.##', '#..', '.##'], 7, 35), motif(['##.', '..#', '##.'], 19, 35));
// Border: a stitched line with a dot below it every four cells.
function border(x: number, y: number): CellClass | null {
  if (y === hemAt(x) - 2) return 'tr-emb';
  return y === hemAt(x) - 1 && ((x % 4) + 4) % 4 === 2 ? 'tr-emb' : null;
}
// Gold tassels hang below the hem, one under each border dot.
const tassels: Shape = (x, y) => {
  if (across(x) === 0 || ((x % 4) + 4) % 4 !== 2) return null;
  if (y === hemAt(x) + 1) return 'tr-tassel';
  return y === hemAt(x) + 2 ? 'tr-gold-d' : null;
};
function embroidery(x: number, y: number): CellClass | null {
  if (!onDrape(x, y) || !onDrape(x, y - 1)) return null;
  if (Math.abs(x - SUN.cx) <= 3 && Math.abs(y - SUN.cy) <= 3) return sunMedallion(x, y);
  return border(x, y) ?? crescents(x, y);
}

// A plum velvet valance along the top: lit lower fold, gold trim, a tassel every eight cells.
function valance(x: number, y: number): CellClass | null {
  if (y <= 1) return 'tr-velvet';
  if (y === 2) return 'tr-velvet-l';
  if (y === 3) return 'tr-trim';
  return x % 8 === 4 && y <= 5 ? 'tr-tassel' : null;
}

// A slim plum curtain at the right edge, gathered by a gold tieback.
const TIE = 20;
const curtainLeft = (y: number): number => (y >= TIE - 2 && y <= TIE + 3 ? 46 : 45);
const curtain = outlined((x, y) => {
  if (y < 1 || y > 40 || x < curtainLeft(y)) return null;
  if (y === TIE || y === TIE + 1) return 'tr-gold';
  if (x === curtainLeft(y)) return 'tr-velvet-l';
  return x === 47 ? 'tr-velvet-d' : 'tr-velvet';
}, 'tr-velvet-o');

// Stencilled on the wall in muted gold: a crescent moon between the reader and the card, and a few four-point stars.
const MOON = { cx: 24.5, cy: 9.5, r: 3.2, bite: [25.9, 8.4, 2.7] as const };
const moon: Shape = (x, y) => {
  const [px, py] = [x + 0.5, y + 0.5];
  return inCircle(px, py, MOON.cx, MOON.cy, MOON.r) && !inCircle(px, py, ...MOON.bite) ? 'tr-motif' : null;
};
const STARS: readonly (readonly [number, number])[] = [[3, 9], [24, 17], [7, 5]];
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
const MIST: readonly (readonly [number, number])[] = [[13, 25], [14, 24], [15, 25], [14, 26], [12, 26]];
const TWINKLES: Cell[] = STARS.map(([x, y]) => [x, y, 'tr-twinkle']);
// The veil's beaded hem ripples, her bandana tail sways, and two glints of eyes show through now and then.
const HEM_HALF = 6;
const HEM: Cell[] = Array.from({ length: 2 * HEM_HALF + 1 }, (_, i): Cell => {
  const x = 14 - HEM_HALF + i;
  return [x, veilHem(x), x % 2 === 0 ? 'tr-rd-hem1' : 'tr-rd-hem2'];
});
const READER_MOTION: Cell[] = [...HEM, [5, 16, 'tr-rd-tail1'], [4, 16, 'tr-rd-tail2'], [12, 15, 'tr-rd-eye'], [16, 15, 'tr-rd-eye']];
// A few gold stitches on the cloth catch the candlelight.
const CLOTH_GLINTS: Cell[] = [[SUN.cx - 1, SUN.cy - 1, 'tr-sun-glint'], [6, hemAt(6) - 1, 'tr-stitch-glint1'], [22, hemAt(22) - 1, 'tr-stitch-glint2']];

const scene: Scene = {
  name: 'Tarot Room',
  size: [48, 48],
  paint: layers(spread, hands, ball, candles, embroidery, table, tassels, reader, shelf, card, valance, curtain, moon, stars, candleGlow, cardGlow, floor, wall),
  moving: [
    ...flame(CANDLES[0].left, CANDLES[0].top, 1),
    ...flame(CANDLES[1].left, CANDLES[1].top, 2),
    ...MIST.map(([x, y]): Cell => [x, y, 'tr-mist']),
    [12, 24, 'tr-glint'],
    ...TWINKLES,
    ...READER_MOTION,
    ...CLOTH_GLINTS,
  ],
  // Every card's face; tarot.css shows the day's one (data-tr-card on the root).
  variants: faces({ left: CARD.left + 1, right: CARD.right - 1, numeralTop: CARD.top + 2, emblemTop: CARD.top + 8 }),
};
export default scene;

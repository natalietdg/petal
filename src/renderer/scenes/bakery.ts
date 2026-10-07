// Corner Bakery: the shop seen from the rainy street at night.
// Focal point: the big front window, glowing gold with bread on its shelves and counter.
// Cool blue-grey street and brick outside, warm amber inside; the light spills onto the wet pavement.
import { distanceToSegment, inEllipse, layers, stamp, type Cell, type CellClass, type Scene, type Shape } from './kit';

// Layout on the 48x48 canvas. The pet sits bottom right (x 28+, y 28+) on the doorstep; her toy sits just left of her.
const SIGN = { left: 4, top: 3, width: 5, gap: 2 };
const AWNING = { left: 1, right: 44, top: 11, sagFrom: 13, sagTo: 30 };
const WINDOW = { left: 2, right: 25, top: 18, bottom: 38 };
const DOOR = { left: 30, right: 43, top: 18, bottom: 38 };
const PIPE = 46;
const PAVEMENT = 41;

// Cool brick on clean mortar: 5x2 bricks, half-brick bond; soot darkens the courses under the awning.
function brick(x: number, y: number): CellClass {
  const course = Math.floor(y / 3);
  const shifted = x + (course % 2) * 3;
  if (y % 3 === 2 || shifted % 6 === 5) return 'b-mortar';
  if (y === AWNING.top + 6 || y === AWNING.top + 7) return 'b-soot';
  return y % 3 === 0 ? 'b-brickL' : 'b-brick';
}

// A torn gig poster on the pier between window and door, and the scrap of an older one by the pipe.
const POSTERS = layers(
  stamp(26, 20, [
    'pppp',
    'prrp',
    'prrp',
    'pppp',
    'pkkp',
    'ppp.',
    'pp..',
  ], { p: 'b-paper', r: 'b-print', k: 'b-printD' }),
  stamp(44, 25, [
    'qq',
    'q.',
    'qq',
  ], { q: 'b-paperD' }),
);

const wall: Shape = (x, y) => POSTERS(x, y) ?? brick(x, y);

// Neon BAKERY, 5x5 letters: a 1px pale core, a hot-pink tube around it, a faint glow on the brick.
const LETTERS: Record<string, readonly string[]> = {
  B: ['xxxx.', 'x...x', 'xxxx.', 'x...x', 'xxxx.'],
  A: ['.xxx.', 'x...x', 'xxxxx', 'x...x', 'x...x'],
  K: ['x...x', 'x..x.', 'xxx..', 'x..x.', 'x...x'],
  E: ['xxxxx', 'x....', 'xxxx.', 'x....', 'xxxxx'],
  R: ['xxxx.', 'x...x', 'xxxx.', 'x..x.', 'x...x'],
  Y: ['x...x', 'x...x', '.xxx.', '..x..', '..x..'],
};
const WORD = 'BAKERY';
const neonCore = (x: number, y: number): boolean => {
  const pitch = SIGN.width + SIGN.gap;
  const col = x - SIGN.left;
  if (col < 0 || col % pitch >= SIGN.width) return false;
  const letter = WORD[Math.floor(col / pitch)];
  return letter ? LETTERS[letter]?.[y - SIGN.top]?.[col % pitch] === 'x' : false;
};
const neon: Shape = (x, y) => {
  if (neonCore(x, y)) return 'b-neonCore';
  if (neonCore(x + 1, y) || neonCore(x - 1, y) || neonCore(x, y + 1) || neonCore(x, y - 1)) return 'b-neonTube';
  return neonCore(x + 1, y + 1) || neonCore(x - 1, y - 1) || neonCore(x + 1, y - 1) || neonCore(x - 1, y + 1) ? 'b-neonHalo' : null;
};

// Striped canvas awning: dark rail, teal and cream stripes, scalloped valance that sags in the middle.
const sag = (x: number): number => (x >= AWNING.sagFrom && x <= AWNING.sagTo ? 1 : 0);
const STAINS = ['15,14', '16,14', '16,15', '22,15', '21,16', '22,16', '22,17', '8,13'];
function awning(x: number, y: number): CellClass | null {
  const { left, right, top } = AWNING;
  if (x < left || x > right || y < top) return null;
  const drop = sag(x);
  const stripe = Math.floor((x - left) / 3);
  const teal = stripe % 2 === 0;
  const valance = top + 4 + drop;
  if (y === top) return 'b-rail';
  if (STAINS.includes(`${x},${y}`) && y <= valance + 1) return teal ? 'b-tealStain' : 'b-creamStain';
  if (y < valance) return teal ? (y === top + 1 ? 'b-tealL' : 'b-teal') : (y === top + 1 ? 'b-creamL' : 'b-cream');
  if (y === valance) return teal ? 'b-tealD' : 'b-creamD';
  // Scallop teeth: the middle cell of each stripe hangs one lower, lit warm from the window below.
  if (y === valance + 1 && (x - left) % 3 === 1) return 'b-scallop';
  return null;
}

// Window and door frames: slate-blue paint, lit top-left edge, shaded bottom-right edge.
function frame(x: number, y: number, box: typeof WINDOW): CellClass | null {
  const { left, right, top, bottom } = box;
  if (x < left || x > right || y < top || y > bottom) return null;
  if (y === top || x === left) return 'b-frameL';
  if (y === bottom || x === right) return 'b-frameD';
  return null;
}

// Bread, drawn small and bold: dark crust outline, golden body, pale top highlight and scores.
const BREAD: Record<string, CellClass> = { o: 'b-crustInk', R: 'b-crustL', M: 'b-crust', D: 'b-crustD', s: 'b-score' };
const CROISSANT = [
  '.....ooo.....',
  '...ooRRRoo...',
  '..oRoMMMoRo..',
  '.oRMoMMMoMRo.',
  'oRMDoDDDoDMRo',
  'oMDo.ooo.oDMo',
  '.oo.......oo.',
];
const BOULE = [
  '..ooo..',
  '.oRRRo.',
  'oRsMsRo',
  'oMMMMMo',
  '.ooooo.',
];
const BASKET = [
  'wwwwwwwww',
  'WwWwWwWwW',
  '.WWWWWWW.',
];
const BASKET_KEY: Record<string, CellClass> = { w: 'b-wicker', W: 'b-wickerD' };

// Two baguettes leaning in the basket: pale slashes along the lit side, dark crust ink round them.
const LOAVES: readonly (readonly [number, number, number, number])[] = [[17.5, 31.5, 21, 26.5], [21, 31.5, 24, 27]];
function baguette(x: number, y: number): CellClass | null {
  const px = x + 0.5;
  const py = y + 0.5;
  let near = false;
  for (const [x1, y1, x2, y2] of LOAVES) {
    const d = distanceToSegment(px, py, x1, y1, x2, y2);
    if (d <= 1) return (x + y) % 3 === 0 ? 'b-score' : px < x1 + (x2 - x1) * ((py - y1) / (y2 - y1)) ? 'b-crustL' : 'b-crust';
    if (d <= 1.8) near = true;
  }
  return near ? 'b-crustInk' : null;
}

// The pendant lamp hanging from the ceiling, its shade lit from inside.
const LAMP = stamp(11, 19, [
  '...c...',
  '..sss..',
  '.sSSSs.',
  '...u...',
], { c: 'b-cord', s: 'b-shadeL', S: 'b-shade', u: 'b-bulb' });

const GOODS = layers(
  LAMP,
  stamp(3, 19, BOULE, BREAD),
  stamp(18, 19, BOULE, BREAD),
  stamp(16, 30, BASKET, BASKET_KEY),
  baguette,
  stamp(2, 26, CROISSANT, BREAD),
);
const SHELF_Y = 24;
const COUNTER_Y = 33;

// Inside the shop: warm wall brightest round the lamp, a shelf of boules, a counter of croissants and baguettes.
function interior(x: number, y: number): CellClass {
  const goods = GOODS(x, y);
  if (goods) return goods;
  if (y === SHELF_Y) return 'b-shelfL';
  if (y === SHELF_Y + 1) return 'b-shelfD';
  if (y === COUNTER_Y) return 'b-counterL';
  if (y > COUNTER_Y) return y === WINDOW.bottom - 1 ? 'b-counterD' : 'b-counter';
  if (inEllipse(x, y, 14, 25, 7, 6)) return 'b-wallL';
  if (inEllipse(x, y, 14, 27, 13, 11)) return 'b-wall';
  return 'b-wallD';
}

// Two diagonal glints on the glass, so it reads as a pane in front of the room.
const glint = (x: number, y: number): boolean => {
  const d = WINDOW.right - x + (y - WINDOW.top);
  return (d === 4 || d === 6) && y <= WINDOW.top + 5;
};

function shopWindow(x: number, y: number): CellClass | null {
  const edge = frame(x, y, WINDOW);
  if (edge) return edge;
  if (x <= WINDOW.left || x >= WINDOW.right || y <= WINDOW.top || y >= WINDOW.bottom) return null;
  const room = interior(x, y);
  return glint(x, y) && room.startsWith('b-wall') ? 'b-glint' : room;
}

// The shop door: four amber panes, dimmer than the window.
function door(x: number, y: number): CellClass | null {
  const edge = frame(x, y, DOOR);
  if (edge) return edge;
  if (x <= DOOR.left || x >= DOOR.right || y <= DOOR.top || y >= DOOR.bottom) return null;
  const mullion = Math.floor((DOOR.left + DOOR.right) / 2);
  if (y === DOOR.top + 8 || x === mullion) return 'b-frameD';
  if (x === mullion + 1) return 'b-frameL';
  return y < DOOR.top + 8 ? 'b-doorL' : 'b-door';
}

// Stone sill under the window and a step under the door, top edges lit by the glow.
function stone(x: number, y: number): CellClass | null {
  const underWindow = x >= WINDOW.left - 1 && x <= WINDOW.right + 1;
  const underDoor = x >= DOOR.left - 1 && x <= DOOR.right + 1;
  if (y === WINDOW.bottom + 1 && (underWindow || underDoor)) return 'b-sillL';
  if (y === WINDOW.bottom + 2 && (underWindow || underDoor)) return 'b-sill';
  return null;
}

// Drainpipe down the right edge: lit left side, two clamps, a spout at the foot.
const pipe: Shape = (x, y) => {
  if (x < PIPE || y >= PAVEMENT) return null;
  if (y === 8 || y === 24) return 'b-clamp';
  return x === PIPE ? 'b-pipeL' : 'b-pipe';
};

// Wet slate pavement: a slab joint pattern, the warm spill of window light, a puddle mirroring it.
const PUDDLE = { cx: 9, cy: 44.5, rx: 7, ry: 2 };
const inPuddle = (x: number, y: number): boolean => inEllipse(x + 0.5, y + 0.5, PUDDLE.cx + 0.5, PUDDLE.cy + 0.5, PUDDLE.rx, PUDDLE.ry);
function spill(x: number, y: number): CellClass | null {
  const row = y - PAVEMENT;
  if (row > 3) return null;
  const fromWindow = x >= WINDOW.left + 2 - row && x <= WINDOW.right - 2 + row;
  const fromDoor = x >= DOOR.left + 1 - row && x <= DOOR.right - 1 + row;
  if (!fromWindow && !fromDoor) return null;
  return row <= 1 ? 'b-spillL' : 'b-spill';
}
function pavement(x: number, y: number): CellClass | null {
  if (y < PAVEMENT) return null;
  if (inPuddle(x, y)) return inPuddle(x, y - 1) ? 'b-puddle' : 'b-puddleRim';
  const joint = y === 44 || (y < 44 ? x % 8 === 3 : x % 8 === 7);
  const lit = spill(x, y);
  if (joint) return lit ? 'b-spillJoint' : 'b-joint';
  if (lit) return lit;
  return y === PAVEMENT ? 'b-kerbL' : 'b-slate';
}

// Front to back.
const paint = layers(pipe, neon, awning, shopWindow, door, stone, pavement, wall);

// Moving cells. Rain: thin diagonal streaks in three staggered sets.
const RAIN: readonly (readonly [number, number, CellClass])[] = [
  [3, 0, 'b-rain'], [14, 0, 'b-rain2'], [26, 0, 'b-rain3'], [37, 0, 'b-rain'], [45, 1, 'b-rain2'],
  [9, 10, 'b-rain3'], [20, 9, 'b-rain'], [31, 10, 'b-rain2'], [42, 9, 'b-rain3'],
  [7, 20, 'b-rain2'], [28, 19, 'b-rain3'], [15, 29, 'b-rain'], [27, 32, 'b-rain2'],
  [4, 34, 'b-rain3'], [21, 36, 'b-rain'],
];
const rain: Cell[] = RAIN.flatMap(([x, y, c]): Cell[] => [[x, y, c], [x, y + 1, c], [x - 1, y + 2, c], [x - 1, y + 3, c]]);
// Puddle shimmer: gold and pink reflections that swap places.
const shimmer: Cell[] = [
  [5, 44, 'b-glowA'], [5, 45, 'b-glowB'], [8, 44, 'b-glowB'], [8, 45, 'b-glowA'],
  [11, 44, 'b-glowA'], [11, 45, 'b-glowB'], [13, 45, 'b-glowA'],
  [3, 44, 'b-pinkB'], [14, 44, 'b-pinkA'],
];

const scene: Scene = {
  name: 'Bakery',
  size: [48, 48],
  paint,
  moving: [...shimmer, ...rain],
};
export default scene;

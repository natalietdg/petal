// Pixel scenes behind the cat, at 3px per sprite pixel, drawn from simple shapes.
// The four built-in scenes live here; the others are their own files in scenes/.
import {
  NEIGHBOURS, cellsOf, distanceToSegment, inCircle, inEllipse, layers, onSegments, outlined, stamp, tidy,
  type Cell, type CellClass, type Scene, type Segment, type Shape,
} from './scenes/kit';
import bakery from './scenes/bakery';
import howl from './scenes/howl';
import midcentury from './scenes/midcentury';
import study from './scenes/study';
import winter from './scenes/winter';

// Shape helpers come before SCENES: some scenes build their moving cells with them at load time.
type Circle = readonly [cx: number, cy: number, r: number];
type Oval = readonly [cx: number, cy: number, rx: number, ry: number];
// Rooftop [x1, x2, top].
type Rooftop = readonly [x1: number, x2: number, top: number];
interface Trunk {
  cx: number;
  top: number;
  bottom: number;
  sway: number;
  limbs: readonly Segment[];
}

// Cherry bark: a trunk that curves, flares at the roots and forks into thick limbs,
// lit on its left edge and shaded on its right, with a few dark knots.
const CHERRY_LIMBS: readonly Segment[] = [[7.5, 20, 3, 13], [8, 20, 13, 14], [13, 14, 18, 11]];
// A tree trunk that curves, tapers and flares at the roots, lit on its left edge and shaded on its right,
// with a few dark knots; thick limbs fork off it. Shared by the cherry and the autumn trees.
function barkCell(x: number, y: number, { cx, top, bottom, sway, limbs }: Trunk): CellClass | null {
  const px = x + 0.5;
  if (y >= top && y <= bottom) {
    const centre = cx + sway * Math.sin((bottom - y) / 7);
    const fromBase = bottom - y;
    const half = fromBase <= 1 ? 3 : fromBase <= 5 ? 2 : 1.5;
    const offset = px - centre;
    if (Math.abs(offset) <= half) {
      if (offset < -half + 1) return 't';
      if (offset > half - 1 || (x * 3 + y * 7) % 9 === 0) return 'J';
      return 'k';
    }
  }
  const limb = limbs.find(([x1, y1, x2, y2]) => distanceToSegment(px, y + 0.5, x1, y1, x2, y2) <= 0.9);
  if (limb) return px < limb[0] + (limb[2] - limb[0]) * ((y - limb[1]) / (limb[3] - limb[1])) ? 't' : 'k';
  return null;
}
const CHERRY_TRUNK: Trunk = { cx: 7.5, top: 19, bottom: 37, sway: 1.4, limbs: CHERRY_LIMBS };
const cherryBark: Shape = (x, y) => barkCell(x, y, CHERRY_TRUNK);

// Ruffled-rim vase with wavy vertical sage and cream stripes, on top of the cosy-rug bookshelf.
const VASE_ROWS: Partial<Record<number, readonly [number, number]>> = { 11: [2, 10], 12: [3, 9], 13: [2, 10], 14: [2, 10], 15: [2, 10], 16: [3, 9], 17: [4, 8] };
function vaseCell(x: number, y: number): CellClass | null {
  if (y === 10 && x >= 2 && x <= 10 && x % 2 === 0) return 'vd'; // ruffle peaks
  const row = VASE_ROWS[y];
  if (!row || x < row[0] || x > row[1]) return null;
  if (y === 11 || x === row[0] || x === row[1] || y === 17) return 'vd';
  const wave = Math.floor(y / 2) % 2; // stripes shift every two rows, so they ripple
  return (x + wave) % 2 === 0 ? 'vs' : 'vc';
}
// Monstera: three big split leaves on stems rising from the vase, lit from the top-left.
const MONSTERA: readonly Oval[] = [[2.4, 5.6, 3.8, 2.9], [10.8, 5.2, 3.8, 2.9], [6.5, 2.4, 3.2, 2.5], [0.8, 8.6, 2.2, 1.6], [12.4, 8.4, 2.2, 1.6]];
function monsteraCell(x: number, y: number): CellClass | null {
  if (y > 10) return null;
  const leaf = MONSTERA.find(([cx, cy, rx, ry]) => inEllipse(x, y, cx, cy, rx, ry));
  if (leaf) {
    const [cx, cy, rx, ry] = leaf;
    const edge = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
    if (edge > 0.45 && (x + y * 2) % 3 === 0) return null; // the splits in the leaf
    if (y < cy && x <= cx) return 'i';
    return y > cy ? 'V' : 'v';
  }
  const stems: readonly Segment[] = [[6, 10, 2, 6], [6, 10, 11, 5], [6, 10, 6, 3], [5, 10, 1, 9], [7, 10, 12, 9]];
  return onSegments(x, y, stems) ? 'V' : null;
}

// Autumn trees as clusters of leaf clumps [cx, cy, r].
const MAPLE: readonly Circle[] = [[24, 11, 5], [30, 9, 5], [27, 15, 5], [21, 15, 3.5], [33, 14, 4]];
const GOLDEN: readonly Circle[] = [[40, 18, 4], [43, 16, 3], [38, 15, 2.5]];
const MAPLE_TRUNK: Trunk = { cx: 27.5, top: 16, bottom: 34, sway: 0.8, limbs: [[27, 21, 23, 15], [28, 20, 32, 14], [28, 23, 31, 18]] };
const GOLDEN_TRUNK: Trunk = { cx: 41.5, top: 20, bottom: 34, sway: -0.6, limbs: [[41, 23, 39, 19], [42, 22, 44, 18]] };
// A crown's cell: dark outline on its edge, lit top-left of each clump, shaded bottom-right.
function treeShade(x: number, y: number, clumps: readonly Circle[], [light, mid, dark]: readonly [CellClass, CellClass, CellClass]): CellClass | null {
  const inside = (px: number, py: number) => clumps.some(([cx, cy, r]) => inCircle(px, py, cx, cy, r));
  if (!inside(x, y)) return null;
  if (!inside(x + 1, y) || !inside(x - 1, y) || !inside(x, y + 1) || !inside(x, y - 1)) return '8';
  const clump = clumps.find(([qx, qy, qr]) => inCircle(x, y, qx, qy, qr));
  if (!clump) return null; // unreachable: inside() just found one
  const [cx, cy, r] = clump;
  const lean = (x - cx + y - cy) / r;
  if (lean < -0.55) return light;
  if (lean > 0.45) return (x + y) % 2 ? dark : mid;
  return mid;
}

// A 5x5 maple leaf with a stem, as moving cells at (x, y).
const MAPLE_LEAF = ['..x..', 'x.x.x', 'xxxxx', '.xxx.', '..s..'];
const mapleLeaf = (x: number, y: number, colour: CellClass): Cell[] => MAPLE_LEAF.flatMap((row, dy) => [...row].flatMap((cell, dx): Cell[] => (
  cell === '.' ? [] : [[x + dx, y + dy, cell === 's' ? '8' : colour]]
)));

// Cherry limbs as line segments from the trunk out into the crown; the long one reaches over the cat.
const BRANCHES: readonly Segment[] = [
  [9, 20, 30, 12], [8, 18, 3, 12], [8, 22, 1, 17], [12, 18, 16, 11], [20, 16, 22, 10],
  [26, 14, 33, 15], [28, 13, 36, 11], [7, 17, 9, 9], [16, 11, 14, 6], [4, 13, 2, 9],
];
const onBranch = (x: number, y: number): boolean => onSegments(x, y, BRANCHES);

// Each scene paints a cell with a class letter (see .sc-* in cat.css), or null for empty.
// `moving` cells go in their own group so a scene can animate just those.
const SCENES: Record<string, Scene> = {
  // Twice the cats' height, with a long branch reaching out over the cat; that canopy is drawn in front of her.
  // Sakura picnic: gingham blanket and wicker basket at the tree's foot, a far torii on rolling hills.
  cherry: ((): Scene => {
    const CANOPY: readonly Circle[] = [[7, 12, 7], [14, 8, 6], [22, 7, 6], [30, 9, 5], [36, 12, 4], [33, 15, 3], [2, 15, 4]];
    const inCanopy = tidy((x, y) => CANOPY.some(([cx, cy, r]) => inCircle(x, y, cx, cy, r)));
    // Limbs show through the blossom, except where a cluster of flowers covers them.
    const blossom = outlined((x, y) => {
      if (!inCanopy(x, y)) return null;
      if (onBranch(x, y) && (x * 5 + y * 3) % 4 !== 0) return 'k';
      if ((x * 3 + y * 5) % 7 === 0) return 'B';
      return y < 7 || inCircle(x, y, 9, 7, 3) || inCircle(x, y, 21, 4, 2.5) ? 'l' : 'b';
    }, 'ol-rose');
    const trunk: Shape = (x, y) => (y >= 13 ? cherryBark(x, y) : null);
    const trunkEdge: Shape = (x, y) => (NEIGHBOURS.some(([dx, dy]) => trunk(x + dx, y + dy)) ? 'K' : null);
    const branches: Shape = (x, y) => cherryBark(x, y) ?? (onBranch(x, y) ? 'k' : null);
    // Gingham blanket lying on the grass, under the toy and the pet.
    const blanket = outlined((x, y) => {
      if (x < 0 || x > 25 || y < 36 || y > 38) return null;
      const band = Math.floor(x / 2) % 2 === 1;
      const row = y === 37;
      if (band && row) return 'ol-check-d';
      return band || row ? 'ol-check' : 'ol-cream';
    }, 'ol-check-edge');
    // Wicker basket by the trunk; the gap under its handle stays see-through.
    const basketArt = stamp(0, 29, ['.hhh.', 'h...h', 'h...h', 'eeeee', 'wWwWw', 'WwWwW', '.WWW.'], {
      h: 'ol-wicker-d', e: 'ol-wicker-l', w: 'ol-wicker', W: 'ol-wicker-d',
    });
    const basket = outlined(basketArt, 'ol-wicker-edge', (x, y) => basketArt(x, y) || (x >= 1 && x <= 3 && (y === 30 || y === 31)));
    // A little vermilion torii far off on the hill, framed by the low branches.
    const torii = outlined(stamp(12, 23, ['rrrrrrr', '.r...r.', 'RRRRRRR', '.r...r.', '.r...r.', '.r...r.', '.r...r.'], {
      r: 'ol-torii', R: 'ol-torii-d',
    }), 'ol-torii-edge');
    // Two soft hills behind everything, each with a darker ridge line.
    const farTop = (x: number): number => Math.round(29 + 1.5 * Math.sin(x * 0.2 + 0.5));
    const nearTop = (x: number): number => Math.round(33 + 1.2 * Math.sin(x * 0.28 + 2.2));
    const hills: Shape = (x, y) => {
      if (y > 37) return null;
      if (y >= nearTop(x)) return y === nearTop(x) ? 'ol-ridge' : 'ol-hill';
      if (y >= farTop(x)) return y === farTop(x) ? 'ol-ridge-far' : 'ol-hill-far';
      return null;
    };
    const FALLEN: Record<string, CellClass> = { '27,39': 'l', '31,39': 'B', '36,39': 'l', '39,39': 'B', '29,38': 'B', '38,38': 'l' };
    const grass: Shape = (x, y) => (y >= 38 ? FALLEN[`${x},${y}`] ?? (y === 39 ? 'G' : 'g') : null);
    const butterfly = (left: number, top: number): Shape => stamp(left, top, ['w.w', '.d.'], { w: 'ol-fly', d: 'ol-fly-d' });
    return {
      name: 'Cherry Blossom',
      size: [40, 40],
      paint: layers(butterfly(1, 23), butterfly(35, 3), basket, blanket, grass, trunk, blossom, trunkEdge, branches, torii, hills),
      // Anything over the cat's half of the canvas sits in front of her.
      front: (x, y) => x >= 20 && y <= 19,
      moving: [[24, 18, 'b'], [29, 22, 'l'], [21, 26, 'b'], [35, 20, 'l'], [26, 30, 'b'], [17, 24, 'l']],
    };
  })(),
  // A blazing sun high over a deep sea fading to the shore, a windsurfer out on the water, and a crab on the sand.
  beach: ((): Scene => {
    // Turns a little bitmap into cells at (x0, y0); '.' is empty, other letters map through the legend.
    const sprite = (rows: readonly string[], x0: number, y0: number, legend: Record<string, CellClass>): Cell[] => rows.flatMap((row, dy) => [...row].flatMap((ch, dx): Cell[] => {
      const cell = legend[ch];
      return cell ? [[x0 + dx, y0 + dy, cell]] : [];
    }));
    const HORIZON = 24;
    // The waterline wanders a row up or down so the shore doesn't look ruled.
    const shoreAt = (x: number): number => 37 + Math.round(Math.sin(x * 0.45));
    const WINDSURFER = [
      '.....m....',
      '....rm....',
      '...rrm....',
      '...rrm....',
      '..yyym.h..',
      '..yyymaU..',
      '.rrrrm.U..',
      '.rrrrm.U..',
      'rrrrrmu.u.',
      '..bbbbbbbb',
      'ww........',
    ];
    const CRAB = [
      '.hh.......hh.',
      'h..h.e.e.h..h',
      'h4.h.5.5.h.4h',
      '.dd4hhhhh4dd.',
      '...4hhhhh4...',
      '..44p444p44..',
      '...d44444d...',
      '..d.d...d.d..',
    ];
    // Sky objects, each with its own outline: sun, cloud, and the far island on the horizon.
    const sunDisc = tidy((x, y) => inCircle(x, y, 8, 7, 5));
    const sun = outlined((x, y) => {
      if (!sunDisc(x, y)) return null;
      if (inCircle(x, y, 8, 7, 2)) return 'U';
      return inCircle(x, y, 8, 7, 3.6) ? 'u' : 'z';
    }, 'ol-sun');
    // One fair-weather cloud, flat-bottomed and shaded along its base.
    const cloudMask = tidy((x, y) => y <= 8 && ([[29, 7, 2.5], [32, 6, 3], [35, 7.5, 2]] as const).some(([cx, cy, r]) => inCircle(x, y, cx, cy, r)));
    const cloud = outlined((x, y) => (cloudMask(x, y) ? (y === 8 ? 'nb-cloud-shade' : 'nb-cloud') : null), 'ol-cloud');
    const isleMask = tidy((x, y) => y >= HORIZON - 2 && y < HORIZON && inEllipse(x, y, 41, HORIZON, 5, 2.2));
    const isle = outlined((x, y) => (isleMask(x, y) ? 'nb-isle' : null), 'ol-isle');
    const sky = layers(sun, cloud, isle);
    const CRAB_LEGEND: Record<string, CellClass> = { h: 'nb-crab-lit', 4: '4', d: 'nb-crab-dark', e: 'nb-crab-eye', 5: '5', p: 'nb-crab-cheek' };
    // Outline only the crab's outside, skipping the legs and eye stalks so they stay crisp.
    const crabBody = stamp(0, 39, CRAB, CRAB_LEGEND);
    const crabOutside = new Set<string>();
    const queue: [number, number][] = [[-1, 38]];
    for (let next = queue.pop(); next; next = queue.pop()) {
      const [x, y] = next;
      const key = `${x},${y}`;
      if (x < -1 || x > 13 || y < 38 || y > 47 || crabOutside.has(key) || crabBody(x, y)) continue;
      crabOutside.add(key);
      NEIGHBOURS.forEach(([dx, dy]) => queue.push([x + dx, y + dy]));
    }
    const crab: Shape = (x, y) => crabBody(x, y) ?? (y < 46 && !(x >= 4 && x <= 8 && y <= 41) && crabOutside.has(`${x},${y}`) && NEIGHBOURS.some(([dx, dy]) => crabBody(x + dx, y + dy)) ? 'ol-crab' : null);
    const WINDSURFER_LEGEND: Record<string, CellClass> = { m: 'nb-mast', r: 'nb-sail', y: 'nb-sail-band', h: 'nb-skin', a: 'nb-skin', U: 'nb-suit', u: 'nb-suit', b: 'nb-board' };
    // Wake ('w') stays loose; everything else on the windsurfer gets one outline.
    const windsurfer = outlined(stamp(12, 15, WINDSURFER, WINDSURFER_LEGEND), 'ol-surf');
    return {
      name: 'Beach',
      size: [48, 48],
      paint(x, y) {
        const shore = shoreAt(x);
        // Sand: wet and darker right at the waterline, a couple of shells further up.
        if (y > shore) {
          if (y === shore + 1) return 'nb-wet';
          if ((x === 24 && y === 44) || (x === 4 && y === 46)) return 'nb-shell';
          return (x * 7 + y * 3) % 11 === 0 ? 'N' : 'n';
        }
        if (y === shore) return 'nb-foam';
        if (y === shore - 1 && x % 5 < 2) return 'nb-foam';
        // Sea bands, deepest at the horizon and paling toward the shore.
        if (y > HORIZON) {
          if (y <= 27) return 'nb-deep';
          if (y <= 30) return 'S';
          if (y <= 33) return 's';
          return 'nb-shallow';
        }
        if (y === HORIZON) return 'nb-horizon';
        return sky(x, y);
      },
      // A round little crab with open claws, big eyes on stalks and pink cheeks.
      crab: cellsOf(crab, -1, 38, 13, 47),
      // Rays pulse, crests roll, the water glints, and the windsurfer rides along.
      moving: [
        [8, 0, 'u'], [8, 1, 'u'], [8, 13, 'u'], [8, 14, 'u'], [1, 7, 'u'], [2, 7, 'u'], [14, 7, 'u'], [15, 7, 'u'],
        [3, 2, 'u'], [13, 2, 'u'], [3, 12, 'u'], [13, 12, 'u'],
        ...Array.from({ length: 48 }, (_, x) => x).filter((x) => x % 6 < 2).map((x): Cell => [x, 29, 'w']),
        ...Array.from({ length: 48 }, (_, x) => x).filter((x) => x % 7 === 3 || x % 7 === 4).map((x): Cell => [x, 33, 'w']),
        ...[[23, 13], [24, 12], [25, 13], [26, 12], [27, 13]].map(([x, y]): Cell => [x, y, 'nb-gull']),
        ...[[22, 26], [5, 27], [33, 26], [26, 31], [12, 32], [3, 35], [19, 35]].map(([x, y]): Cell => [x, y, 'nb-glint']),
        ...cellsOf(windsurfer, 11, 14, 22, 25),
        ...sprite(WINDSURFER, 12, 15, { w: 'w' }),
      ],
    };
  })(),
  // Starlit window: night sky over a sleeping city, fairy lights, rose curtains and hanging plants,
  // a cushioned window seat with a knitted blanket, a telescope on a wall shelf, and a floor lamp.
  night: ((): Scene => {
    // Rooftops [x1, x2, top]: a far row in hazy navy, a near row in near-black with warm windows.
    const FAR: readonly Rooftop[] = [[10, 13, 24], [16, 20, 23], [22, 26, 25], [29, 33, 22], [34, 37, 25]];
    const NEAR: readonly Rooftop[] = [[9, 11, 30], [12, 15, 27], [16, 18, 31], [19, 22, 28], [23, 24, 32], [25, 28, 29], [29, 31, 31], [32, 35, 28], [36, 38, 30]];
    const inBuilding = (x: number, y: number, rows: readonly Rooftop[]): Rooftop | undefined => rows.find(([x1, x2, top]) => x >= x1 && x <= x2 && y >= top);
    // The light string droops in four swags under the rod, with a bulb every other cell along each.
    const SWAGS: readonly (readonly [number, number])[] = [[9, 17], [17, 25], [25, 33], [33, 41]];
    const sag = (x: number): number | null => {
      const swag = SWAGS.find(([a, b]) => x >= a && x <= b);
      return swag ? 3 + Math.round(2 * Math.sin((Math.PI * (x - swag[0])) / (swag[1] - swag[0]))) : null;
    };
    const BULBS = ['nb-bulb-gold', 'nb-bulb-rose', 'nb-bulb-mint', 'nb-bulb-sky'];
    const bulbs = Array.from({ length: 16 }, (_, i) => 10 + i * 2).map((x, i): Cell => [x, (sag(x) ?? 0) + 1, BULBS[i % 4] ?? '']); // every x here is on a swag
    // The milky way: a faint dithered band crossing the upper sky.
    const milkyWay: Shape = (x, y) => {
      const d = distanceToSegment(x, y, 21, 3, 39, 23);
      if (d <= 1) return 'nb-milky';
      return d <= 2.6 && (x + y) % 2 === 0 ? 'nb-milky-edge' : null;
    };
    // Faint lines joining one constellation's stars (the stars themselves twinkle in `moving`).
    const CONSTELLATION: readonly Segment[] = [[24, 6, 30, 5], [30, 5, 33, 9], [33, 9, 36, 13]];

    // The window: frame, city, moon, sky. The sill sits under it.
    const glass: Shape = (x, y) => {
      if (x < 8 || x > 39 || y < 3 || y > 38) return null;
      if (x === 8 || x === 39 || y === 3 || y === 38) return 'f';
      // The city, near row in front of far row.
      const near = inBuilding(x, y, NEAR);
      if (near) {
        const [x1, x2, top] = near;
        const pane = (x - x1) % 2 === 1 && (y - top) % 2 === 1 && x < x2 && y < 37;
        const lit = pane && (x * 7 + y * 13) % 5 < 3;
        return lit ? 'nb-window-lit' : 'nb-city-near';
      }
      if (x === 14 && y >= 24 && y < 27) return 'nb-city-near'; // rooftop antenna
      const far = inBuilding(x, y, FAR);
      if (far) return (x - far[0]) % 2 === 1 && (y - far[2]) % 2 === 1 && (x + y * 3) % 4 === 0 ? 'nb-window-dim' : 'nb-city-far';
      // Moon with a soft halo.
      if (inCircle(x, y, 16, 11, 3) && !inCircle(x, y, 17, 10, 2.8)) return 'm';
      if (inCircle(x, y, 16, 11, 4.8)) return 'h';
      // Wisps of lilac cloud.
      const wisps: readonly (readonly [number, number, number])[] = [[22, 13, 18], [24, 14, 20], [11, 23, 16]];
      if (wisps.some(([wy, x1, x2]) => y === wy && x >= x1 && x <= x2)) return 'L';
      if (onSegments(x, y, CONSTELLATION)) return 'ol-const';
      const milky = y <= 22 && milkyWay(x, y);
      if (milky) return milky;
      // Sky deepens from near-black blue at the top to midnight blue above the rooftops.
      return y <= 11 ? 'q' : y <= 20 ? 'Q' : y <= 26 ? 'p' : 'P';
    };
    const windowAndSill = outlined((x, y) => (y === 39 && x >= 7 && x <= 40 ? 'F' : glass(x, y)), 'ol-wood');

    // Curtain rod, fairy-light wire, and curtains gathered by tiebacks at row 24.
    const rod: Shape = (x, y) => (y === 2 && x >= 6 && x <= 41 ? 'k' : null);
    const wire: Shape = (x, y) => (x >= 9 && x <= 41 && sag(x) === y ? 'nb-wire' : null);
    const curtains = outlined((x, y) => {
      if (y < 3 || y > 38) return null;
      const left = x >= 6 && x <= (y < 24 ? 9 : y === 24 ? 7 : 8 + Math.floor((y - 24) / 5));
      const right = x <= 41 && x >= (y < 24 ? 38 : y === 24 ? 40 : 39 - Math.floor((y - 24) / 5));
      if (!left && !right) return null;
      return y === 24 ? 'T' : x % 2 === 0 ? 'c' : 'C';
    }, 'ol-curtain');

    // Trailing plants in terracotta pots, hung from the rod over each curtain.
    const PLANT: Record<string, CellClass> = { w: 'nb-wire', O: 'nb-pot-rim', o: 'o', X: 'X', v: 'v', V: 'V', i: 'i' };
    const potEdge = (cell: CellClass): boolean => (cell === 'nb-pot-rim' || cell === 'o' || cell === 'X');
    const hangingPlant = (left: number, rows: readonly string[]): Shape => {
      const art = stamp(left, 3, rows, PLANT);
      const pot = outlined((x, y) => { const c = art(x, y); return c && potEdge(c) ? c : null; }, 'ol-pot');
      const leaves = outlined((x, y) => { const c = art(x, y); return c && !potEdge(c) && c !== 'nb-wire' ? c : null; }, 'ol-leaf');
      const string: Shape = (x, y) => (art(x, y) === 'nb-wire' ? 'nb-wire' : null);
      return layers(pot, leaves, string);
    };
    const leftPlant = hangingPlant(6, ['.w..', '.w..', 'ivvi', 'OOOO', 'oooX', 'VoXV', 'v..v', 'V..V', '.v..', 'V...']);
    const rightPlant = hangingPlant(38, ['..w.', '..w.', 'ivvi', 'OOOO', 'oooX', 'VoXV', 'v..v', 'V..v', '...V']);

    // On the sill: a candle, a stack of books, the potted sprout and a mug of cocoa.
    const wick: Shape = (x, y) => (x === 11 && y === 34 ? 'nb-wick' : null);
    const candle = outlined((x, y) => (x >= 11 && x <= 12 && y >= 35 && y <= 38 ? (x === 11 ? 'nb-wax' : 'nb-wax-shade') : null), 'ol-wax');
    const books = outlined(stamp(14, 35, ['.AAAw', 'bbbbw', 'aaaaw', 'aaaaw'], {
      A: 'A', b: 'ol-book-rose', a: 'ol-book-blue', w: 'nb-wax',
    }), 'ol-book-edge');
    const pot = outlined((x, y) => (y >= 36 && y <= 38 && x >= 20 && x <= 23 ? (y === 36 ? 'nb-pot-rim' : x === 23 ? 'X' : 'o') : null), 'ol-pot');
    const sprout = outlined((x, y) => {
      if ((y === 35 && (x === 21 || x === 22)) || (y === 34 && x === 20) || (y === 33 && x === 23)) return y === 35 ? 'V' : 'v';
      return y === 34 && (x === 21 || x === 23) ? 'i' : null;
    }, 'ol-leaf');
    const mug = outlined(stamp(24, 36, ['lmm.', 'mmmh', 'MMM.'], { l: 'ol-mug-l', m: 'ol-mug', M: 'ol-mug-d', h: 'ol-mug' }), 'ol-mug-edge');

    // Window seat under the sill: a mustard pillow and a knitted blanket draped over the cushion.
    const pillow = outlined(stamp(5, 36, ['.ppp.', 'pplpp', 'ppppp', '.qqq.'], { p: 'ol-pillow', l: 'ol-pillow-l', q: 'ol-pillow-d' }), 'ol-pillow-edge');
    const blanket = outlined((x, y) => {
      if (x < 5 || x > 14 || y < 40 || y > 45) return null;
      if (y === 45) return x % 2 === 1 ? 'ol-knit-d' : null; // fringe
      return (x + (y % 2)) % 2 === 0 ? 'ol-knit' : 'ol-knit-d'; // little knit Vs
    }, 'ol-knit-edge');
    const seat = outlined((x, y) => {
      if (x < 5 || x > 42 || y < 40 || y > 43) return null;
      if (y === 40) return 'ol-seat-l';
      if (y === 41) return 'ol-seat';
      return x % 8 === 4 ? 'F' : 'f';
    }, 'ol-wood');
    // A soft navy rug scattered with gold stars.
    const rug = outlined((x, y) => {
      if (x < 7 || y < 45) return null;
      return (x * 5 + y * 3) % 9 === 0 ? 'ol-gold' : 'ol-starrug';
    }, 'ol-starrug-edge');

    // Floor lamp on the left: shade, then pole and base.
    const shade = outlined((x, y) => {
      const rows: Partial<Record<number, readonly [number, number]>> = { 17: [1, 4], 18: [1, 4], 19: [0, 5], 20: [0, 5] };
      const row = rows[y];
      return row && x >= row[0] && x <= row[1] ? 'Y' : null;
    }, 'ol-lamp');
    const pole = outlined((x, y) => ((x === 2 && y >= 21 && y <= 45) || (y >= 46 && x >= 0 && x <= 4) ? 'k' : null), 'J');

    // Right wall: a telescope on a little shelf, aimed out at the stars, under a constellation print.
    const telescope = outlined(stamp(42, 15, [
      'At....', 'ttT...', '.ttT..', '..ttT.', '...tTK', '...k..', '...k..', '..kkk.', '.k.k.k', '.k.k.k',
    ], { A: 'A', t: 'ol-scope', T: 'ol-scope-d', K: 'K', k: 'k' }), 'ol-ink');
    const shelf = outlined((x, y) => (x >= 42 && (y === 25 || y === 26) ? (y === 25 ? 'f' : 'F') : null), 'ol-wood');
    const PRINT: Record<string, CellClass> = { f: 'f', q: 'q', s: 'ol-gold', c: 'ol-const', m: 'm' };
    const starPrint = outlined(stamp(43, 4, ['fffff', 'fsqqf', 'fqcqf', 'fqqsf', 'fqcqf', 'fsqqf', 'fffff'], PRINT), 'ol-wood');
    // Left wall: a little crescent-moon print above the lamp.
    const moonPrint = outlined(stamp(0, 4, ['fffff', 'fqqqf', 'fqmqf', 'fmqqf', 'fmqqf', 'fqmqf', 'fqqqf', 'fffff'], PRINT), 'ol-wood');

    // Warm light pooled around the lamp shade.
    const glow: Shape = (x, y) => (inCircle(x, y, 2.5, 19, 8) ? 'y' : null);

    return {
      name: 'Night Window',
      size: [48, 48],
      paint: layers(
        shade, pole, leftPlant, rightPlant, pillow, blanket,
        wick, candle, books, sprout, pot, mug,
        wire, rod, curtains, telescope, shelf, starPrint, moonPrint,
        seat, rug, windowAndSill, glow,
      ),
      // Stars twinkle (bright 'm', dim 'd', a few cross-shaped), bulbs blink, a star shoots, the candle flickers, cocoa steams.
      moving: [
        [24, 6, 'm'], [11, 7, 'm'], [33, 9, 'm'], [12, 17, 'm'], [35, 18, 'm'], [20, 21, 'm'],
        [30, 5, 'd'], [21, 18, 'd'], [26, 22, 'd'], [36, 13, 'd'], [10, 22, 'd'], [29, 12, 'd'], [31, 16, 'd'],
        [27, 8, 'nb-star'], [26, 8, 'd'], [28, 8, 'd'], [27, 7, 'd'], [27, 9, 'd'],
        [34, 23, 'nb-star'], [33, 23, 'd'], [35, 23, 'd'], [34, 22, 'd'], [34, 24, 'd'],
        [14, 23, 'nb-beacon'],
        [22, 9, 'nb-shoot'], [23, 8, 'nb-trail'], [24, 8, 'nb-trail'], [25, 7, 'nb-trail-faint'], [26, 7, 'nb-trail-faint'],
        ...bulbs,
        [11, 33, 'nb-flame'], [11, 32, 'nb-flame-tip'],
        [25, 34, 'ol-steam'], [26, 33, 'ol-steam'],
      ],
    };
  })(),
  // A cosy room: patterned rug, plant, tall bookshelf, and an autumn window behind the cat.
  rug: ((): Scene => {
    // Big oval rug with a dark border and a diamond pattern.
    const rugMask = tidy((x, y) => inEllipse(x, y, 25, 44, 22, 3.6));
    const rug = outlined((x, y) => {
      if (!rugMask(x, y)) return null;
      if (!inEllipse(x, y, 25, 44, 20, 2.5)) return 'R';
      return (x + y * 2) % 6 === 0 || (x - y * 2) % 6 === 0 ? 'x' : 'r';
    }, 'ol-rug');
    // Bookshelf on the left with depth: lit top, shaded side, shadows under shelves, jewel-toned books.
    const bookshelf = outlined((x, y) => {
      if (y === 18 && x >= 2 && x <= 14) return 'H';
      if (x === 14 && y >= 19 && y <= 40) return 'J';
      if (x < 1 || x > 13 || y < 19 || y > 40) return null;
      if (x === 1 || x === 13 || [19, 26, 33, 40].includes(y)) return 'k';
      const shelfTop = y < 26 ? 20 : y < 33 ? 27 : 34;
      if (y === shelfTop) return 'Z';
      if ((x + shelfTop) % 6 === 0) return 'K';
      const height = 3 + ((x * 3 + shelfTop) % 3);
      if (y < shelfTop + 6 - height) return 'K';
      const book = (x * 7 + shelfTop) % 6;
      if (y === shelfTop + 4 && book % 2 === 0) return 'A';
      return 'abcdef'[book] ?? null;
    }, 'Z');
    // On the shelf: a wavy-striped sage and cream vase with a ruffled rim, holding a big-leaf monstera.
    const plantMask = tidy((x, y) => Boolean(vaseCell(x, y) || monsteraCell(x, y)
      || (y <= 10 && MONSTERA.some(([cx, cy, rx, ry]) => inEllipse(x, y, cx, cy, rx, ry)))));
    const plant = outlined((x, y) => vaseCell(x, y) ?? monsteraCell(x, y), 'ol-leaf', plantMask);
    // Big autumn window behind the cat, the same size as the night window.
    const autumnWindow = outlined((x, y) => {
      if (y === 37 && x >= 15 && x <= 47) return 'F';
      if (x < 16 || x > 46 || y < 3 || y > 36) return null;
      // Frame uses the lit-wood colour: 'f' is a book colour in this scene.
      if (x === 16 || x === 46 || y === 3 || y === 36 || x === 31 || y === 19) return 'H';
      // Two distinct trees: a big red maple in front, a smaller golden one further back.
      const tree = treeShade(x, y, MAPLE, ['1', '6', '2']) ?? barkCell(x, y, MAPLE_TRUNK)
        ?? treeShade(x, y, GOLDEN, ['3', '7', '9']) ?? barkCell(x, y, GOLDEN_TRUNK);
      if (tree) return tree;
      if (y >= 33) return '13'[(x * 31 + y) % 2] ?? null; // fallen leaves on the ground
      return y <= 18 ? 'E' : 'M';
    }, 'ol-wood');
    return {
      name: 'Cosy Rug',
      size: [48, 48],
      paint: layers(bookshelf, rug, plant, autumnWindow),
      // Leaves drifting down past the glass while Claude works.
      moving: [...mapleLeaf(20, 22, '1'), ...mapleLeaf(33, 26, '6'), ...mapleLeaf(42, 6, '3'), ...mapleLeaf(17, 39, '7'), ...mapleLeaf(26, 41, '2')],
    };
  })(),
  // The rest are their own files in scenes/.
  winter,
  bakery,
  howl,
  study,
  midcentury,
};

const rect = (x: number, y: number, cell: CellClass): string => `<rect x="${x}" y="${y}" width="1" height="1" class="sc-${cell}"/>`;

export interface SceneLayers {
  back: string;
  front: string;
}

// Returns the scene as two layers: `back` sits behind the cat, `front` (if the scene has one) in front of her.
export function svg(id: string): SceneLayers {
  const scene = has(id) ? SCENES[id] : undefined;
  if (!scene) return { back: '', front: '' };
  const [width, height] = scene.size;
  const back: string[] = [];
  const front: string[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const cell = scene.paint(x, y);
      if (cell) (scene.front?.(x, y) ? front : back).push(rect(x, y, cell));
    }
  }
  const moving = scene.moving.map(([x, y, cell]) => rect(x, y, cell)).join('');
  const crab = (scene.crab ?? []).map(([x, y, cell]) => rect(x, y, cell)).join('');
  const open = (layer: string) => `<svg class="scene scene-${id} scene-${layer}" viewBox="0 0 ${width} ${height}" width="${width * 3}" height="${height * 3}" shape-rendering="crispEdges" aria-hidden="true">`;
  return {
    back: `${open('back')}${back.join('')}<g class="scene-moving">${moving}</g>${crab ? `<g class="scene-crab">${crab}</g>` : ''}</svg>`,
    front: front.length ? `${open('front')}${front.join('')}</svg>` : '',
  };
}

export const has = (id: string): boolean => Object.hasOwn(SCENES, id);

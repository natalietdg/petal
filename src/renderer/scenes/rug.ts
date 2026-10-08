// A cosy room: patterned rug, plant, tall bookshelf, and an autumn window behind the cat.
import {
  inCircle, inEllipse, layers, onSegments, outlined, tidy, barkCell, type Cell, type CellClass, type Scene, type Segment, type Circle, type Trunk,
} from './kit';

type Oval = readonly [cx: number, cy: number, rx: number, ry: number];

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
const scene: Scene = {
  name: 'Cosy Rug',
  size: [48, 48],
  paint: layers(bookshelf, rug, plant, autumnWindow),
  // Leaves drifting down past the glass while Claude works.
  moving: [...mapleLeaf(20, 22, '1'), ...mapleLeaf(33, 26, '6'), ...mapleLeaf(42, 6, '3'), ...mapleLeaf(17, 39, '7'), ...mapleLeaf(26, 41, '2')],
};
export default scene;

// A cosy room: patterned rug, plant, tall bookshelf, and an autumn window behind the cat.
import {
  inCircle, inEllipse, layers, onSegments, outlined, stamp, tidy, barkCell, type Cell, type CellClass, type Scene, type Segment, type Circle, type Trunk,
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
const MAPLE: readonly Circle[] = [[24, 15, 5], [30, 13, 5], [27, 19, 5], [21, 19, 3.5], [33, 18, 4]];
const GOLDEN: readonly Circle[] = [[40, 18, 4], [43, 16, 3], [38, 15, 2.5]];
const MAPLE_TRUNK: Trunk = { cx: 27.5, top: 20, bottom: 34, sway: 0.8, limbs: [[27, 25, 23, 19], [28, 24, 32, 18], [28, 27, 31, 22]] };
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
// Book bitmaps: capital = lit top edge, lower case = spine, digit = shaded side, = gold band, - dark band.
const BOOK_INK: Record<string, CellClass> = {
  R: 'nk-rust-l', r: 'nk-rust', 1: 'nk-rust-d', M: 'nk-mus-l', m: 'nk-mus', 2: 'nk-mus-d',
  O: 'nk-olive-l', o: 'nk-olive', 3: 'nk-olive-d', B: 'nk-burg-l', b: 'nk-burg', 4: 'nk-burg-d',
  C: 'nk-cream-l', c: 'nk-cream', 5: 'nk-cream-d', T: 'nk-teal-l', t: 'nk-teal', 6: 'nk-teal-d',
  '=': 'nk-band', '-': 'nk-band-d',
};
// The bookcase's three shelves, each 11 wide and 5 tall; '.' shows the dark back.
const CASE_SHELVES: readonly (readonly string[])[] = [
  ['RR1..MM2B4.', 'rr1T6--2b4.', '==1t6mm2b4.', 'rr1=6mm2.b4', 'rr1t6mm2.b4'],
  ['C5BB4......', 'c5==4O3TT6.', '-5bb4o3tt6.', 'c5bb4=3MMM2', 'c5bb4o3mmm2'],
  ['TT6..M2..C5', 'tt6R1m2O3c5', '==6r1-2o3c5', 'tt6=1m2o3-5', 'tt6r1m2o3c5'],
];
const caseBooks = CASE_SHELVES.map((rows, i) => stamp(2, 21 + i * 7, rows, BOOK_INK));
// Bookcase on the left: lit top, shaded side, a shadow under each shelf, autumn-toned books.
const bookshelf = outlined((x, y) => {
  if (y === 18 && x >= 2 && x <= 14) return 'H';
  if (x === 14 && y >= 19 && y <= 40) return 'J';
  if (x < 1 || x > 13 || y < 19 || y > 40) return null;
  if (x === 1 || x === 13 || [19, 26, 33, 40].includes(y)) return 'k';
  if ([20, 27, 34].includes(y)) return 'Z';
  return caseBooks.map((shelf) => shelf(x, y)).find(Boolean) ?? 'K';
}, 'Z');
// A long shelf over the window: a row of books, one leaning, and a flat stack at the end.
const WALL_SHELF_BOOKS = stamp(17, 2, [
  'BB4..OO3....RR1...C5MM2...RRR1',
  'bb4M2==3..T6rr1...c5mm2B4.rrr1',
  '==4m2oo3C5t6rr1..-5.mm2b4TTT6.',
  'bb4-2oo3c5=6==1..c5.--2b4ttt6.',
  'bb4m2oo3-5t6rr1.c5..mm2=4OOOO3',
  'bb4m2oo3c5t6rr1.c5..mm2b4oooo3',
], BOOK_INK);
// Outlined round the books only, so the plank sits straight on the window frame.
const wallShelf = outlined((x, y) => {
  if ((y === 8 || y === 9) && x >= 15) return x === 15 ? 'Z' : y === 8 ? 'H' : 'J';
  return WALL_SHELF_BOOKS(x, y);
}, 'Z', WALL_SHELF_BOOKS);
// Books stacked flat on the floor by the bookcase.
const bookStack = outlined(stamp(0, 42, [
  '..TTTTTTT6.',
  '..ttttttt6.',
  '.MMMMMMMM2.',
  '.mmmm-mmm2.',
  'BBBB=BBBBB4',
  'bbbb=bbbbb4',
], BOOK_INK), 'Z');
// An open book lying on the rug: two lit pages, a gutter, the rust cover under them.
const openBook = outlined(stamp(12, 45, ['.CC.CC.', 'Ccc5ccC', 'rrrrrr1'], BOOK_INK), 'Z');
// On the shelf: a wavy-striped sage and cream vase with a ruffled rim, holding a big-leaf monstera.
const plantMask = tidy((x, y) => Boolean(vaseCell(x, y) || monsteraCell(x, y)
  || (y <= 10 && MONSTERA.some(([cx, cy, rx, ry]) => inEllipse(x, y, cx, cy, rx, ry)))));
const plant = outlined((x, y) => vaseCell(x, y) ?? monsteraCell(x, y), 'ol-leaf', plantMask);
// Big autumn window behind the cat, under the book shelf.
const autumnWindow = outlined((x, y) => {
  if (y === 37 && x >= 15 && x <= 47) return 'F';
  if (x < 16 || x > 46 || y < 10 || y > 36) return null;
  if (x === 16 || x === 46 || y === 10 || y === 36 || x === 31 || y === 22) return 'H';
  // Two distinct trees: a big red maple in front, a smaller golden one further back.
  const tree = treeShade(x, y, MAPLE, ['1', '6', '2']) ?? barkCell(x, y, MAPLE_TRUNK)
    ?? treeShade(x, y, GOLDEN, ['3', '7', '9']) ?? barkCell(x, y, GOLDEN_TRUNK);
  if (tree) return tree;
  if (y >= 33) return '13'[(x * 31 + y) % 2] ?? null; // fallen leaves on the ground
  return y <= 21 ? 'E' : 'M';
}, 'ol-wood');
const scene: Scene = {
  name: 'Cosy Rug',
  size: [48, 48],
  paint: layers(openBook, bookStack, bookshelf, rug, plant, wallShelf, autumnWindow),
  // Leaves drifting down past the glass while Claude works.
  moving: [...mapleLeaf(20, 22, '1'), ...mapleLeaf(33, 26, '6'), ...mapleLeaf(40, 12, '3'), ...mapleLeaf(17, 39, '7'), ...mapleLeaf(26, 41, '2')],
};
export default scene;

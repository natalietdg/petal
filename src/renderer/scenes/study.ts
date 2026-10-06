// Wizard's Study: the calmer, uncluttered take on the wizard's room (Wizard's Loft is the crammed one).
// Clarity rules: calm flat wall, a few large hero objects, each ringed by a 1px dark outline.
import { outlined, type CellClass, type Scene } from './kit';
import { wizardKit, type ShelfItem } from './wizard-kit';

const kit = wizardKit('hs');
const { art, wall, rug, hearth, strand } = kit;
const OUT = 'hs-out';

// Sun mask, top left.
const sunMask = kit.sunMask({ cx: 6, cy: 6, face: 3.9, ring: 4.8, rays: 6.6 }, OUT);

// Caged green lantern hanging from the ceiling.
const LANTERN_LEFT = 21;
const lantern = kit.lantern(LANTERN_LEFT, OUT);

// Golden gramophone, its long tube curving down into the base.
const gramophone = kit.gramophone(12, 12, ['....bbbBB...', '.....bbB....', '......bB....', '......bbB...', '.......bB...'], OUT);

// Treasure chest under the gramophone.
const chest = kit.chest({ left: 14, right: 25, lock: 19 }, OUT);

// Little candle on the chest, by the gramophone.
const candle = outlined(art(14, 27, ['c', 'C', 'B']), OUT);

// Wizard's staff leaning by the bookcase.
const staff = kit.staff(27, 16, 14, OUT);

// Bookcase on the right: three shelves of chunky books and curios.
const SHELF_ITEMS: readonly (readonly ShelfItem[])[] = [
  [[2, 5, 'r'], [2, 4, 't'], [3, 4, 'jar'], [1, 5, 'b'], [2, 5, 'n'], [2, 4, 'c']],
  [[1, 5, 'b'], [2, 5, 't'], [2, 4, 'c'], [3, 4, 'skull'], [2, 5, 'r'], [2, 3, 'n']],
  [[2, 5, 'n'], [2, 4, 'r'], [3, 4, 'orb'], [2, 5, 't'], [1, 4, 'b'], [2, 5, 'c']],
];
const bookcase = kit.bookcase(SHELF_ITEMS);

// Front to back: the first layer that paints a cell wins.
function paint(x: number, y: number): CellClass | null {
  return candle(x, y)
    ?? gramophone(x, y)
    ?? chest(x, y)
    ?? staff(x, y)
    ?? lantern(x, y)
    ?? hearth(x, y)
    ?? sunMask(x, y)
    ?? bookcase(x, y)
    ?? rug(x, y)
    ?? wall(x, y);
}

// Talisman strings that sway while Claude works.
const strands = [
  // Brass crescent between the sun and the gramophone.
  ...strand(1, 15, 0, ['s', 's', 't', 's', 'r', 's', 'b', 's'], ['.b.', 'b..', 'b.y', '.bb']),
  // Teal evil-eye charm beside the lantern.
  ...strand(2, 18, 0, ['s', 'r', 's', 'b', 's'], ['ttt', 'tot', 'ttt', '.r.']),
  // Red tassel between the lantern and the bookcase.
  ...strand(3, 30, 0, ['s', 's', 'b', 's', 't', 's', 's', 'b', 's', 's'], ['.b.', '.r.', 'rRr', 'r.R']),
];

const scene: Scene = {
  name: "Wizard's Study",
  size: [48, 48],
  paint,
  moving: [
    ...kit.lanternGlow(paint, LANTERN_LEFT),
    ...kit.fireGlow(paint),
    ...kit.fireSpirit,
    ...strands,
    // Candle flames on the mantel and the chest, two frames each.
    [8, 16, 'hs-fa'], [8, 15, 'hs-fb'], [14, 26, 'hs-fa'], [14, 25, 'hs-fb'],
    // Glints: the bookcase's red gem, the lantern glass, the staff crystal and the horn rim.
    [39, 3, 'hs-glint'], [22, 6, 'hs-glint2'], [27, 17, 'hs-glint'], [15, 13, 'hs-glint2'],
  ],
};
export default scene;

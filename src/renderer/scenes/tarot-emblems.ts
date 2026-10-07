// One small emblem per Major Arcana card, drawn on the Tarot Room's face-up card, plus its roman numeral.
// Each emblem fits 11x11; letters map to the tr-em-* colours in tarot.css.
import { DECK } from './tarot-deck';
import { sprite, type Cell, type CellClass } from './kit';

const INK: Record<string, CellClass> = {
  k: 'tr-em-ink', r: 'tr-em-red', o: 'tr-em-orange', y: 'tr-em-gold', l: 'tr-em-lamp', b: 'tr-em-blue',
  s: 'tr-em-sky', g: 'tr-em-green', p: 'tr-em-pink', v: 'tr-em-violet', n: 'tr-em-brown', w: 'tr-em-white',
};

const SIZE = 11;
const MID = (SIZE - 1) / 2;
// Builds an 11x11 emblem from a rule over offsets from its centre.
const drawn = (paint: (dx: number, dy: number, d: number) => string | null): string[] => Array.from({ length: SIZE }, (_, y) => Array.from({ length: SIZE }, (_, x) => {
  const dx = x - MID;
  const dy = y - MID;
  return paint(dx, dy, Math.hypot(dx, dy)) ?? '.';
}).join(''));

const wheel = drawn((dx, dy, d) => {
  if (d >= 4.1 && d <= 5.3) return 'o';
  if (d < 1.2) return 'y';
  return d < 4.1 && (dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy)) ? 'k' : null;
});

const star = drawn((dx, dy) => {
  const [ax, ay] = [Math.abs(dx), Math.abs(dy)];
  if (ax + ay <= 1) return 'l';
  const onAxisPoint = (ax === 0 && ay <= 5) || (ay === 0 && ax <= 5) || (ax === 1 && ay <= 2) || (ay === 1 && ax <= 2);
  if (onAxisPoint) return 'o';
  return ax === ay && ax <= 3 ? 'o' : null;
});

const moon = drawn((dx, dy, d) => (d <= 4.7 && Math.hypot(dx - 2.2, dy + 1.4) > 3.9 ? 'b' : null));

const sun = drawn((dx, dy, d) => {
  if (d < 1.5) return 'l';
  if (d <= 2.9) return 'o';
  const ray = dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy);
  return ray && d >= 3.9 && d <= 5.1 ? 'o' : null;
});

const LAND = [
  '...........',
  '....gg.....',
  '..ggggg....',
  '..gggg...g.',
  '...gg...gg.',
  '....g..ggg.',
  '.......gg..',
  '...g...g...',
  '..ggg......',
  '...gg......',
  '...........',
];
const world = drawn((dx, dy, d) => (d > 5.2 ? null : LAND[dy + MID]?.[dx + MID] === 'g' ? 'g' : 'b'));

// In deck order, 0 The Fool to XXI The World.
const EMBLEMS: readonly (readonly string[])[] = [
  // 0 The Fool: a bundle on a stick, off on an adventure.
  ['......rrrr.', '.....rrwrrr', '.....rrrrrr', '......rrrr.', '.....n.....', '....n......', '...n.......', '..n........', '.n.........', 'n..........'],
  // I The Magician: the infinity sign.
  ['.vvv...vvv.', 'v...v.v...v', 'v....v....v', 'v...v.v...v', '.vvv...vvv.'],
  // II The High Priestess: two pillars and a crescent between.
  ['kkkk...ssss', '.kk.....ss.', '.kk..bb.ss.', '.kk.bb..ss.', '.kk.bb..ss.', '.kk..bb.ss.', '.kk.....ss.', 'kkkk...ssss'],
  // III The Empress: the Venus sign.
  ['...ggggg...', '..gg...gg..', '..g.....g..', '..g.....g..', '..gg...gg..', '...ggggg...', '.....g.....', '...ggggg...', '.....g.....', '.....g.....'],
  // IV The Emperor: a crown.
  ['o...o...o', 'oo.ooo.oo', 'ooooooooo', 'oroobooro', 'ooooooooo', 'nnnnnnnnn'],
  // V The Hierophant: a key.
  ['.yyy.......', 'y...y......', 'y...yyyyyyy', 'y...y...y.y', '.yyy....y.y'],
  // VI The Lovers: a heart.
  ['.rr...rr.', 'rpwr.rrrr', 'rprrrrrrr', 'rrrrrrrrr', '.rrrrrrr.', '..rrrrr..', '...rrr...', '....r....'],
  // VII The Chariot: a cart with a pennant.
  ['....r......', '....rr.....', '....k......', '.bbbbbbbbb.', '.bsbbbbbbb.', '.bbbbbbbbb.', '..kk...kk..', '.k..k.k..k.', '.k..k.k..k.', '..kk...kk..'],
  // VIII Strength: a lion's paw.
  ['..oo.oo..', '..oo.oo..', 'oo.....oo', 'oo.ooo.oo', '..ooooo..', '.ooooooo.', '.ooooooo.', '..ooooo..'],
  // IX The Hermit: a lantern.
  ['....k....', '...k.k...', '..kkkkk..', '..klllk..', '..klwlk..', '..klllk..', '..kkkkk..', '...kkk...'],
  // X Wheel of Fortune: an eight-spoked wheel.
  wheel,
  // XI Justice: the scales.
  ['.....y.....', '.kkkkkkkkk.', '.k...k...k.', 'k.k..k..k.k', 'k.k..k..k.k', 'ooo..k..ooo', '.....k.....', '...kkkkk...'],
  // XII The Hanged Man: an hourglass, for waiting it out.
  ['nnnnnnnnn', '.k.....k.', '.koooook.', '..koook..', '...kok...', '....k....', '...k.k...', '..k.o.k..', '.k.ooo.k.', '.koooook.', 'nnnnnnnnn'],
  // XIII Death: a butterfly, for change.
  ['..k.....k..', '...k...k...', 'vvv.k.k.vvv', 'vpvv.k.vvpv', 'vvvvvkvvvvv', '.vvvvkvvvv.', '...vvkvv...', '..vvvkvvv..', '.vpvvkvvpv.', '.vvv.k.vvv.'],
  // XIV Temperance: a full cup.
  ['kkkkkkkkk', 'kbbbbbbbk', 'ksbbbbbbk', '.kbbbbbk.', '..kkkkk..', '....k....', '....k....', '..kkkkk..'],
  // XV The Devil: a trident.
  ['r...r...r', 'r..rrr..r', 'r...r...r', '.rrrrrrr.', '....r....', '....r....', '....r....', '...rrr...'],
  // XVI The Tower: struck by lightning.
  ['........oo.', '.......oo..', '.k.k.k.ooo.', '.kkkkk..oo.', '.kklkk.oo..', '.kkkkk.o...', '.kkkkk.....', '.kklkk.....', '.kkkkk.....', 'kkkkkkk....'],
  // XVII The Star: an eight-pointed star.
  star,
  // XVIII The Moon: a crescent.
  moon,
  // XIX The Sun: a disc and its rays.
  sun,
  // XX Judgement: a bell, the wake-up call.
  ['....k....', '...kyk...', '..kyyyk..', '..kyyyk..', '..kyyyk..', '.kyyyyyk.', 'kkkkkkkkk', '....k....'],
  // XXI The World: a little globe.
  world,
];

// Roman numerals, 5 rows tall.
const GLYPHS: Record<string, readonly string[]> = {
  I: ['k', 'k', 'k', 'k', 'k'],
  V: ['k.k', 'k.k', 'k.k', 'k.k', '.k.'],
  X: ['k.k', 'k.k', '.k.', 'k.k', 'k.k'],
  0: ['kkk', 'k.k', 'k.k', 'k.k', 'kkk'],
};
const numeralRows = (numeral: string): string[] => GLYPHS.I.map((_, row) => [...numeral].map((ch) => GLYPHS[ch]?.[row] ?? '').join('.'));

// The card face's free area, inside its gold edge: numeral on top, emblem below.
export interface Face { left: number; right: number; numeralTop: number; emblemTop: number }

// Every card's numeral and emblem as cells, centred on the face; keyed by card number.
export function faces({ left, right, numeralTop, emblemTop }: Face): Record<string, Cell[]> {
  const centred = (rows: readonly string[], top: number, box = SIZE): Cell[] => {
    const width = Math.max(...rows.map((row) => row.length));
    const x0 = left + Math.floor((right - left + 1 - width) / 2);
    return sprite(rows, x0, top + Math.floor((box - rows.length) / 2), INK);
  };
  return Object.fromEntries(DECK.map((card) => [String(card.number), [
    ...centred(numeralRows(card.numeral), numeralTop, 5),
    ...centred(EMBLEMS[card.number] ?? [], emblemTop),
  ]]));
}

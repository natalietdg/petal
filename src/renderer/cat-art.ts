// The pets' pixel art: four cats sharing one silhouette, the corgi, and each pet's toy. cat.ts draws them.
// One row of a sprite drawn over the base at row y.
export type Line = readonly [y: number, row: string];

export interface Pet {
  name: string;
  // Her own silhouette; the cats share SITTING.
  base?: readonly string[];
  eyesOpen: readonly Line[];
  eyesClosed?: readonly Line[];
  sitting: readonly Line[];
  // Drawn behind the body in their own group, so they can flutter.
  wings?: readonly Line[];
  // false for none; her own two frames, or the shared TAIL_UP/TAIL_DOWN.
  tail?: false | { up: readonly Line[]; down: readonly Line[] };
}

export interface Prop {
  name: string;
  rows: readonly string[];
}

// O outline · B fur · L belly · P pink (ears, nose, beans) · K blush · E eye · W eye sparkle.
export const SITTING = [
  '...O..........O.....',
  '..OPO........OPO....',
  '..OPPO......OPPO....',
  '..OBBBOOOOOOBBBO....',
  '.OBBBBBBBBBBBBBBO...',
  '.OBBBBBBBBBBBBBBO...',
  'OBBBBBBBBBBBBBBBBO..',
  'OBBBBBBBBBBBBBBBBO..',
  'OBBBBBBBPPBBBBBBBO..',
  'OBBKKBBOBBOBBKKBBO..',
  'OBBBBBBBOOBBBBBBBO..',
  '.OBBBBBBBBBBBBBBO...',
  '..OOBBBBBBBBBBOO....',
  '...OBLLLLLLLLBO.....',
  '...OBLLLLLLLLBO.....',
  '...OBBLLLLLLBBO.....',
  '...OBBBBBBBBBBO.....',
  '...OBPBOOOOBPBO.....',
  '...OOOOO..OOOOO.....',
  '....................',
];
// Round 2x2 pupil with a sparkle in the iris.
const EYES_OPEN: readonly Line[] = [
  [6, '...EEE......EEE.....'],
  [7, '...EWO......EWO.....'],
  [8, '...EOO......EOO.....'],
];
// Closed eyes sit on the open eyes' middle row, 3 wide, so a dozing face matches the awake one.
export const EYES_CLOSED: readonly Line[] = [
  [7, '...OOO......OOO.....'],
];
export const TAIL_UP: readonly Line[] = [
  [12, '.................O..'],
  [13, '................OBO.'],
  [14, '................OBO.'],
  [15, '...............OBO..'],
  [16, '..............OBO...'],
];
export const TAIL_DOWN: readonly Line[] = [
  [16, '...............OOO..'],
  [17, '..............OBBBO.'],
  [18, '...............OOO..'],
];

// Markings drawn over the shared silhouette.
// S stripe · R orange patch · M white fur · C collar · T collar tag · H petal · Y star charm · V/U wing and its shade.
export const CATS = {
  // Mika, an orange tabby: forehead and cheek stripes, green eyes, cream chest, brown outline.
  mika: {
    name: 'Mika',
    eyesOpen: EYES_OPEN,
    sitting: [
      [1, '...L..........L.....'],
      [2, '...LL........LL.....'],
      [4, '...SS........SS.....'],
      [5, '..SS..........SS....'],
      [13, '....S........S......'],
      [15, '....S........S......'],
    ],
  },
  // Corgi: her own silhouette: big upright pink-lined ears, tan forehead, a white blaze into a white muzzle,
  // dark 2x2 eyes set low, black nose over a tongue, a white bib, a stocky tan body and white socks. No tail.
  corgi: {
    name: 'Corgi',
    base: [
      '...O..........O',
      '..OPO........OPO',
      '..OPBO......OBPO',
      '.OPPPBO....OBPPPO',
      '.OPPPPBOOOOBPPPPO',
      '.OBBBBBBBBBBBBBBO',
      '.OBBBBBBMMBBBBBBO',
      '.OBBBBBBMMBBBBBBO',
      '.OBBBBBBMMBBBBBBO',
      '.OBBBBBMMMMBBBBBO',
      '.OBBBBMMMMMMBBBBO',
      '.OBKKMMMOOMMMKKBO',
      '..OBMMMOPPOMMMBO',
      '...OBMMMMMMMMBO',
      '...OBBMMMMMMBBO',
      '..OBBBBMMMMBBBBO',
      '..OBBBBBBBBBBBBO',
      '..OMMOBBBBBBOMMO',
      '..OOOO......OOOO',
      '',
    ].map((row) => row.padEnd(20, '.')),
    // Eyes two rows lower than the cats', so there's tan forehead between the ears and the eyes.
    eyesOpen: [
      [9, '....WE......WE......'],
      [10, '....EE......EE......'],
    ],
    eyesClosed: [
      [9, '...OOO......OOO.....'],
    ],
    sitting: [],
    tail: false,
  },
  // Near-black grey tabby: M on the forehead, white muzzle, amber eyes, collar with a white tag.
  miki: {
    name: 'Miki',
    eyesOpen: EYES_OPEN,
    sitting: [
      [4, '......S.SS.S........'],
      [5, '.......S..S.........'],
      [8, '......MM..MM........'],
      [9, '.....MM.MM.MM.......'],
      [10, '......MM..MM........'],
      [12, '....CCCCCTCCCC......'],
      [13, '.........T..........'],
      [15, '....S........S......'],
    ],
  },
  // Calico: grey tabby with orange and dark patches, white muzzle, belly and paws, green eyes.
  kira: {
    name: 'Kira',
    eyesOpen: EYES_OPEN,
    sitting: [
      [4, '..RRR...R.S..SSS....'],
      [5, '..RRRR..S....SSS....'],
      [6, '.RR.............S...'],
      [8, '......MM..MM........'],
      [9, '.....MM.MM.MM.......'],
      [10, '......MM..MM........'],
      [11, '..RR.........SS.....'],
      [14, '....R.......S.......'],
      [15, '....RR.......S......'],
      [16, '....R.......SS......'],
      [17, '....M.M....M.M......'],
    ],
  },
  // Hoshi, an original sakura-season cat: pink fur, cream muzzle and belly, violet eyes, tiny white wings,
  // a petal by her right ear and a ribbon collar with a gold star charm. No tail: the wings take its place.
  hoshi: {
    name: 'Hoshi',
    eyesOpen: EYES_OPEN,
    sitting: [
      [0, '................H...'],
      [1, '................HH..'],
      [2, '.................H..'],
      [8, '......MM..MM........'],
      [9, '.....MM.MM.MM.......'],
      [10, '......MM..MM........'],
      [12, '....CCCCYCCCCC......'],
      [13, '.......YYY..........'],
      [14, '........Y...........'],
    ],
    wings: [
      [11, 'O................O..'],
      [12, 'OV..............VO..'],
      [13, 'OVV............VVO..'],
      [14, 'OUV............VUO..'],
      [15, 'OUU............UUO..'],
      [16, '.OO............OO...'],
    ],
    tail: false,
  },
} satisfies Record<string, Pet>;

// Each cat's toy, on the same 3px grid. r/d ball · c/g cup and tea · s steam · f/D fish and its outline · e bone
// · y/n star and its shade · p wand · k sparkle.
export const PROPS = {
  mika: {
    name: 'fish',
    rows: [
      '..DDDD....',
      '.DffffD.DD',
      'DfwffffDfD',
      'DffffffffD',
      'DffffffDfD',
      '.DffffD.DD',
      '..DDDD....',
    ],
  },
  corgi: {
    name: 'bone',
    rows: [
      'DD....DD',
      'DeDDDDeD',
      'DeeeeeeD',
      'DeDDDDeD',
      'DD....DD',
    ],
  },
  miki: {
    name: 'ball',
    rows: [
      '.rrrr.',
      'rwwrrr',
      'rwrrrr',
      'rrrrrd',
      'rrrrdd',
      '.dddd.',
    ],
  },
  kira: {
    name: 'tea',
    rows: [
      '..s..s..',
      '...s..s.',
      '..s..s..',
      'OOOOOO..',
      'OggggOO.',
      'OccccO.O',
      'OccccO.O',
      'OccccOO.',
      '.OOOO...',
    ],
  },
  hoshi: {
    name: 'wand',
    rows: [
      '...y..k',
      '..yyy..',
      'yyywyyy',
      '.yyyyn.',
      '..yyn..',
      '.yn.yn.',
      'k..p...',
      '...p...',
      '..rpr..',
      '...p...',
      '...p...',
      '...p...',
    ],
  },
} satisfies Record<string, Prop>;

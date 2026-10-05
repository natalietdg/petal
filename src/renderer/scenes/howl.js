// Wizard's Room: a crammed treasure-trove bedroom (after Howl's), drawn behind the pet.
// Maximalist but readable: a calm dark wall, every object ringed by a dark tone of its own material.
(() => {
  const { inEllipse, distanceToSegment } = PastelTerm.scenes.kit;

  // One letter per colour so the hand-drawn sprites below stay readable. '.' is see-through.
  const LEGEND = {
    o: 'h-out', K: 'h-void',
    W: 'h-wood-d', w: 'h-wood', v: 'h-wood-l',
    B: 'h-brass-d', b: 'h-brass', y: 'h-brass-l', '*': 'h-shine',
    R: 'h-red-d', r: 'h-red', q: 'h-red-l',
    T: 'h-teal-d', t: 'h-teal', u: 'h-teal-l',
    G: 'h-lan-d', g: 'h-lan', z: 'h-lan-l',
    C: 'h-paper-d', c: 'h-paper',
    P: 'h-plum', p: 'h-plum-l', N: 'h-navy', n: 'h-navy-l',
  };

  // Stamps a hand-drawn sprite: returns its colour at (x, y), or null when off it or see-through.
  function sprite(x, y, left, top, art) {
    const row = art[y - top];
    const cell = row?.[x - left];
    return cell && cell !== '.' ? LEGEND[cell] : null;
  }
  const art = (left, top, rows) => (x, y) => sprite(x, y, left, top, rows);

  // Wraps a shape so every empty cell touching it (4-way) becomes its outline colour.
  // `mask` (default: the shape) picks which cells get ringed, so a string can stay un-outlined.
  const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  function outlined(shape, edge = 'h-out', mask = shape) {
    return (x, y) => shape(x, y)
      ?? (NEIGHBOURS.some(([dx, dy]) => mask(x + dx, y + dy)) ? edge : null);
  }

  // Back wall: flat and dark so objects pop. Floor: plank boards under a woven rug.
  const FLOOR = 36;
  function wall(x, y) {
    if (y < FLOOR - 1) return y >= 30 ? 'h-wall-d' : 'h-wall';
    if (y === FLOOR - 1) return 'h-wood-d';
    if (y === FLOOR) return 'h-wood-l';
    const seam = (y - FLOOR) % 3 === 0 || (x + ((y - FLOOR) / 3 | 0) * 7) % 11 === 0;
    return seam ? 'h-floor-d' : 'h-floor';
  }

  // Woven rug under the pet: red field, brass border, big teal diamonds.
  const RUG = { left: 5, right: 47, top: 40, bottom: 47 };
  function rug(x, y) {
    const { left, right, top, bottom } = RUG;
    if (x < left || x > right || y < top || y > bottom) return null;
    if (y === top || x === left) return 'h-out';
    if (x === left + 1 || y === top + 1) return 'h-brass';
    const dx = Math.abs(((x - left) % 10) - 5);
    const dy = Math.abs(y - 44);
    if (dx + dy <= 1) return 'h-brass-l';
    if (dx + dy === 2) return 'h-teal';
    return 'h-red';
  }

  // Bunting sagging across the top: red, teal, brass, cream and plum pennants on a cream cord.
  const PENNANTS = [['h-red-l', 'h-red-d'], ['h-teal-l', 'h-teal-d'], ['h-brass-l', 'h-brass-d'], ['h-paper', 'h-paper-d'], ['h-plum-l', 'h-plum']];
  // The cord is tied off at the sun's ray and at the bookcase crown.
  const CORD = { left: 10, right: 31 };
  const ropeY = (x) => Math.round(0.4 + 1.6 * Math.sin((Math.PI * (x - CORD.left)) / (CORD.right - CORD.left)));
  function pennant(x, y) {
    if (x <= CORD.left || x >= CORD.right) return null;
    const slot = Math.floor((x - CORD.left - 1) / 5);
    const left = CORD.left + 1 + slot * 5;
    const top = ropeY(left + 1) + 1;
    const [light, dark] = PENNANTS[slot % PENNANTS.length];
    if (y === top && x <= left + 3) return x === left + 3 ? dark : light;
    if (y === top + 1 && x >= left + 1 && x <= left + 2) return x === left + 2 ? dark : light;
    return null;
  }
  const cord = (x, y) => (x >= CORD.left && x <= CORD.right && y === ropeY(x) ? 'h-paper-d' : null);
  const bunting = outlined((x, y) => cord(x, y) ?? pennant(x, y), 'h-out', pennant);

  // Sun mask, top left: orange face in a dark ring, eight brass rays, rosy cheeks and a grin.
  const SUN = { cx: 5, cy: 8 };
  function sunShape(x, y) {
    const dx = x - SUN.cx;
    const dy = y - SUN.cy;
    const d = Math.hypot(dx, dy);
    if (d <= 3.6) {
      if ((dx === -2 || dx === 2) && dy === -1) return 'h-out';
      if ((dx === -3 || dx === 3) && dy === 1) return 'h-red-l';
      if ((Math.abs(dx) <= 1 && dy === 2) || (Math.abs(dx) === 2 && dy === 1)) return 'h-red-d';
      if (dx + dy <= -3) return 'h-brass-l';
      if (dx + dy >= 3) return 'h-brass-d';
      return 'h-sun';
    }
    if (d <= 4.5) return 'h-out';
    if (d > 6.1) return null;
    const turns = Math.atan2(dy, dx) / (Math.PI / 4);
    const lateral = Math.abs(turns - Math.round(turns)) * (Math.PI / 4) * d;
    if (lateral > 0.35 + (6.1 - d) * 0.55) return null;
    return dx + dy < 0 ? 'h-brass-l' : 'h-brass';
  }
  const sunMask = outlined(sunShape, 'h-o-brass');

  // Red tapestry with a teal diamond medallion, brass bands and a fringe of brass tassels.
  const TAPESTRY = outlined(art(13, 5, [
    'ybbbbbbB',
    'qrrrrrrR',
    'qrruTrrR',
    'qruyyTrR',
    'qrrTTrrR',
    'qrrrrrrR',
    'yybbbbBB',
    'qRrRrRrR',
    'y.b..y.b',
    'b.B..b.B',
  ]), 'h-o-red');

  // Caged green lantern hanging from the ceiling: brass cage, four glowing panes.
  const LANTERN_AT = [24, 0];
  const LANTERN = [
    '...b...',
    '...B...',
    '..yby..',
    '.ybbbB.',
    'ybbbbbB',
    'bzzbggB',
    'bz*bgGB',
    'bzgbgGB',
    'ybbbbbB',
    'bzgbgGB',
    'bggbGGB',
    'ybbbbbB',
    '.bbbbB.',
    '..bBb..',
    '...B...',
  ];
  const lantern = outlined(art(...LANTERN_AT, LANTERN), 'h-o-brass');

  // Brass wall clock under the lantern: cream face, navy hands at ten to twelve.
  const clock = outlined(art(25, 16, [
    '..ybB..',
    '.ycNcB.',
    'yccNccB',
    'yNNNccB',
    'ycccCCB',
    '.bCCCB.',
    '..bBB..',
  ]), 'h-o-brass');

  // Golden gramophone: a big flared bell with a dark throat, its tube curving down into a base.
  const HORN = [
    '...yyyyy....',
    '.yy*yyybb...',
    'yy*ybbbbbb..',
    'yybbBKKBbbB.',
    'ybbBKKKKBbB.',
    'ybbBKKKKBbB.',
    'ybbbBKKBbBB.',
    '.bbbbBBbbBB.',
    '..bbbbbbBB..',
    '....bbbBB...',
    '.....bbB....',
    '......bbB...',
    '..vvvvvvvwW.',
    '..wwbybwwwW.',
    '..WWWWWWWWW.',
  ];
  const gramophone = outlined(art(13, 14, HORN), 'h-o-brass');

  // Treasure chest under the gramophone: wooden body, heavy brass straps and a lock.
  const CHEST = { left: 15, right: 24, top: 30, bottom: 36, lock: 19 };
  function chestShape(x, y) {
    const { left, right, top, bottom, lock } = CHEST;
    if (x < left || x > right || y < top || y > bottom) return null;
    if (y === top && (x === left || x === right)) return null;
    if ((x === lock || x === lock + 1) && (y === 32 || y === 33)) return y === 33 && x === lock ? 'h-out' : 'h-brass-l';
    if (y === 32) return 'h-o-wood';
    if (x === left + 2 || x === right - 2) return y <= 31 ? 'h-brass-l' : 'h-brass';
    if (y === top || x === left) return 'h-wood-l';
    if (x === right || y === bottom) return 'h-wood-d';
    return 'h-wood';
  }
  const chest = outlined(chestShape, 'h-o-wood');

  // Wizard's staff leaning on the bookcase, topped with a teal crystal in brass claws.
  const STAFF = [
    '.u.', 'uuT', 'utT', '.T.', 'bBb', '.B.',
    ...Array.from({ length: 18 }, (_, i) => (i % 3 === 2 ? '.W.' : '.w.')),
  ];
  const staff = outlined(art(31, 12, STAFF), 'h-o-wood');

  // Leaning tower of books by the clock, a candle in a brass dish on top. Dark lines part the books.
  const tower = outlined(art(26, 25, [
    '...c.',
    '..ybB',
    '.qqqR',
    '.rrrR',
    '.oooo',
    'uuuuT',
    'tttTT',
    'ooooo',
    '.pppP',
    '.PPPP',
    'oooo.',
    'ccccC',
  ]), 'h-out');

  // Red feathered fan plant in a brass pot, beside the hearth. Each frond has its own outline,
  // layered outside-in, so overlapping fronds stay separate: lit left, shaded right, golden tips.
  const FROND_BASE = [12.5, 31];
  const FROND_TIPS = [[8.2, 24], [17, 24.5], [9.6, 20.2], [15.6, 20.6], [12.6, 18.6]];
  const frond = ([tipX, tipY]) => outlined((x, y) => {
    const [baseX, baseY] = FROND_BASE;
    const px = x + 0.5;
    const py = y + 0.5;
    const t = (baseY - py) / (baseY - tipY);
    if (t <= 0 || t > 1.04) return null;
    const halfWidth = 0.4 + 0.75 * Math.sin(Math.PI * Math.min(t, 1) * 0.85); // leaf: slim stem, full middle, sharp tip
    if (distanceToSegment(px, py, baseX, baseY, tipX, tipY) > halfWidth) return null;
    if (t > 0.82) return 'h-sun';
    return px < baseX + (tipX - baseX) * t ? 'h-red-l' : 'h-red';
  }, 'h-o-red');
  const fronds = FROND_TIPS.map(frond).reverse(); // centre frond in front
  const POT = { left: 11, right: 14, top: 31, bottom: 35 };
  function potShape(x, y) {
    const { left, right, top, bottom } = POT;
    if (x < left || x > right || y < top || y > bottom) return null;
    if (y === top) return x === right ? 'h-brass' : 'h-brass-l';
    if (y === top + 2) return x === right ? 'h-teal-d' : 'h-teal';
    if (y === bottom && (x === left || x === right)) return null;
    return x === left ? 'h-brass-l' : x === right ? 'h-brass-d' : 'h-brass';
  }
  const pot = outlined(potShape, 'h-o-brass');
  const plant = (x, y) => pot(x, y) ?? fronds.reduce((hit, shape) => hit ?? shape(x, y), null);

  // Floor clutter, kept low and clear of the pet's toy: a green jar and a teal bottle, scrolls, a coin heap.
  const jars = outlined(art(11, 35, [
    '.WW..u.',
    'zggGutT',
    'zggGutT',
    'gggGttT',
    '.GG.tTT',
  ]), 'h-o-green');
  const scrolls = outlined(art(18, 37, [
    '.cccrcC',
    'cccccrC',
    'CcccCCC',
  ]), 'h-o-paper');
  const coins = outlined(art(25, 37, [
    '.yb.',
    'y*bB',
    'ybBB',
  ]), 'h-o-brass');

  // Hand drum in front of the hearth: cream skin, brass rim, red body laced with a brass zigzag.
  const drum = outlined(art(0, 39, [
    '.cccccCC.',
    'ccccccCCC',
    'yybbbbbBB',
    'qrrrrrrRR',
    'qryrrryRR',
    'yrrryrrrB',
    'qrrrrrrRR',
    'qrrrrrrRR',
    'yybbbbbBB',
  ]), 'h-o-red');

  // Mantel over the hearth: a round green-glass flask, a tall teal bottle and a candle.
  const POTIONS = [
    '..v...v....',
    '..g..uT....',
    '.zgG.uT.c..',
    'zzgGGtT.c..',
    'zggGGtT.C..',
    '.gGG.tTbbB.',
    'vvvvvvvvvvv',
    'WWWWWWWWWWW',
  ];
  const mantel = art(0, 15, POTIONS);

  // Stone hearth under the mantel: brick face, arched opening, logs for the fire spirit, a slab.
  const HEARTH = { left: 0, right: 10, top: 23, bottom: 38 };
  const OPENING = { left: 1, right: 9, top: 24, bottom: 36 };
  function inOpening(x, y) {
    const { left, right, top, bottom } = OPENING;
    if (x < left || x > right || y < top || y > bottom) return false;
    return !(y === top && (x === left || x === right)); // rounded arch corners
  }
  function hearthShape(x, y) {
    const { left, right, top, bottom } = HEARTH;
    if (x < left || x > right || y < top || y > bottom) return null;
    if (y >= bottom - 1) return y === bottom - 1 ? 'h-stone-l' : 'h-stone-d';
    if (inOpening(x, y)) {
      if (y === 35) return x === 1 || x === 9 ? 'h-wood-l' : 'h-wood';
      if (y === 36) return x === 3 || x === 5 || x === 7 ? 'h-red-l' : 'h-wood-d'; // embers between logs
      return 'h-soot';
    }
    const row = y - top;
    if (row % 3 === 2) return 'h-stone-d'; // mortar line
    const shift = Math.floor(row / 3) % 2 ? 2 : 0;
    if ((x + shift) % 4 === 3) return 'h-stone-d';
    return row % 3 === 0 ? 'h-stone-l' : 'h-stone';
  }
  const hearth = outlined((x, y) => mantel(x, y) ?? hearthShape(x, y));

  // Ornate carved bookcase, right: arched crown with a big red gem, three shelves of chunky books.
  const CASE = { left: 32, right: 47, mid: 39.5 };
  const SHELVES = [8, 15, 22]; // first book row of each shelf; each shelf is 5 rows tall
  const BOOK_TONES = {
    r: ['h-red-l', 'h-red', 'h-red-d'], t: ['h-teal-l', 'h-teal', 'h-teal-d'],
    n: ['h-navy-l', 'h-navy', 'h-out'], b: ['h-brass-l', 'h-brass', 'h-brass-d'],
    c: ['h-paper', 'h-paper', 'h-paper-d'], p: ['h-plum-l', 'h-plum', 'h-out'],
  };
  // Books as [width, height, tone]; curios take a sprite instead of a tone.
  const CURIOS = {
    jar: ['vwW', 'zgG', 'zgG', 'gGG'],
    skull: ['ccc', 'oco', 'cCC', '.C.'],
    orb: ['.p.', 'ppP', 'pPP', 'bBB'],
    scroll: ['cC.', 'CcC', 'ccC', 'CcC'],
  };
  const SHELF_ITEMS = [
    [[2, 5, 'r'], [1, 4, 't'], [3, 4, 'jar'], [1, 5, 'b'], [1, 4, 'p'], [2, 5, 'n'], [2, 4, 'c']],
    [[1, 5, 'b'], [2, 5, 't'], [1, 4, 'c'], [3, 4, 'skull'], [1, 5, 'p'], [2, 5, 'r'], [2, 3, 'n']],
    [[2, 5, 'n'], [1, 4, 'r'], [3, 4, 'orb'], [1, 5, 't'], [3, 4, 'scroll'], [1, 4, 'b'], [1, 5, 'c']],
  ];
  function shelfItem(x, y, shelfTop, items) {
    let left = CASE.left + 2;
    const floor = shelfTop + 4;
    for (const [width, height, kind] of items) {
      if (x < left + width) {
        const top = floor - height + 1;
        if (CURIOS[kind]) return sprite(x, y, left, top, CURIOS[kind]) ?? 'h-void';
        if (y < top) return 'h-void';
        const [light, mid, dark] = BOOK_TONES[kind];
        const col = x - left;
        if (y === top + 1 && height >= 5) return 'h-brass-l';
        if (width > 1 && col === width - 1) return dark;
        return col === 0 ? light : mid;
      }
      left += width;
    }
    return 'h-void';
  }
  function bookcase(x, y) {
    const { left, right, mid } = CASE;
    if (x < left || x > right || y > 33) return null;
    // Crown: an arch peaking over the centre, with the red gem in a brass setting.
    const archTop = Math.round(Math.abs(x - mid) / 3);
    if (y < archTop) return null;
    if (y <= 6) {
      if (y === archTop || x === left || x === right) return 'h-out';
      const gem = Math.hypot((x - mid) / 1.6, (y - 3.5) / 1.5);
      if (gem <= 1) return x < mid && y < 4 ? 'h-red-l' : 'h-red';
      if (gem <= 1.6) return 'h-brass-l';
      if (gem <= 2.1) return 'h-out';
      if (y === 6) return 'h-brass-d';
      return y === archTop + 1 ? 'h-wood-l' : 'h-wood';
    }
    // Side posts with a teal stud each.
    if (x === left || x === right) return 'h-out';
    if (x === left + 1 || x === right - 1) {
      if (y === 11 || y === 18) return 'h-teal-l';
      return x === left + 1 ? 'h-wood-l' : 'h-wood-d';
    }
    const shelf = SHELVES.findIndex((top) => y >= top && y <= top + 4);
    if (shelf >= 0) return shelfItem(x, y, SHELVES[shelf], SHELF_ITEMS[shelf]);
    if (y === 7) return 'h-wood-d';
    if ([13, 20, 27].includes(y)) return 'h-wood-l';
    if ([14, 21, 28].includes(y)) return 'h-wood-d';
    // Lower cupboard, behind the pet.
    if (y === 33) return 'h-out';
    return y === 29 ? 'h-wood-l' : 'h-wood';
  }

  // Front to back: the first layer that paints a cell wins. Each layer brings its own outline.
  function paint(x, y) {
    return drum(x, y)
      ?? jars(x, y)
      ?? scrolls(x, y)
      ?? coins(x, y)
      ?? tower(x, y)
      ?? plant(x, y)
      ?? gramophone(x, y)
      ?? chest(x, y)
      ?? clock(x, y)
      ?? lantern(x, y)
      ?? staff(x, y)
      ?? hearth(x, y)
      ?? bunting(x, y)
      ?? sunMask(x, y)
      ?? TAPESTRY(x, y)
      ?? bookcase(x, y)
      ?? rug(x, y)
      ?? wall(x, y);
  }

  // Talisman strings that sway while Claude works; each string has its own code group.
  // Charms carry their own dark outline ('o') so they read over the wall and over objects.
  const strand = (group, x, top, beads, charm) => {
    const cells = [];
    const charmTop = top + beads.length;
    const half = (charm[0].length - 1) / 2;
    for (let i = 0; i < beads.length; i += 1) cells.push([x, top + i, `h-s${group}-${beads[i]}`]);
    charm.forEach((row, dy) => [...row].forEach((cell, dx) => {
      if (cell !== '.') cells.push([x - half + dx, charmTop + dy, `h-s${group}-${cell}`]);
    }));
    return cells;
  };
  const OFUDA = ['ooo', 'oco', 'oro', 'oco', 'oro', 'ooo'];
  const EVIL_EYE = ['.ooo.', 'ottTo', 'otoTo', 'oTTTo', '.ooo.'];
  const TASSEL = ['.ooo.', '.oyo.', 'orrRo', 'orrRo', 'orRRo', '.o.o.'];
  const BELL = ['.o.', 'oyo', 'ybB', 'oBo'];
  const SHORT_OFUDA = ['ooo', 'oco', 'oro', 'ooo'];
  const strands = [
    // Paper talisman with red seals, between the sun and the tapestry.
    ...strand(1, 11, 0, ['s', 's', 's', 'r', 's', 'b', 's', 's', 's'], OFUDA),
    // Teal evil-eye charm between the tapestry and the lantern.
    ...strand(2, 22, 0, ['s', 's', 'r', 's', 's', 'b', 's', 's', 's', 's'], EVIL_EYE),
    // Red tassel between the lantern and the bookcase.
    ...strand(3, 31, 0, ['s', 's', 'b', 's', 's'], TASSEL),
    // A brass bell and a short paper talisman over the bookcase crown.
    ...strand(4, 35, 0, ['s', 's'], BELL),
    ...strand(5, 44, 0, ['s', 's', 's'], SHORT_OFUDA),
  ];

  // Green light pooling on the wall around the lantern.
  const glow = [];
  for (let y = 0; y <= 18; y += 1) {
    for (let x = 18; x <= 34; x += 1) {
      if (inEllipse(x + 0.5, y + 0.5, 27.5, 7.5, 7.5, 9) && paint(x, y) === 'h-wall') glow.push([x, y, 'h-glow']);
    }
  }

  // The fire spirit on the hearth logs: three flame frames swap so it always flickers.
  // F deep orange edge, f orange, e yellow, h white-hot core.
  const SPIRIT_AT = [1, 25];
  const SPIRIT_BODY = ['.FfffffF.', 'FffefeffF', 'FfeeeeefF', 'FeehhheeF', 'FehhhhheF', 'FehhhhheF', '.FehhheF.'];
  const SPIRIT_FRAMES = [
    ['...F.....', '..FeF..F.', '.FfefFfF.'],
    ['......F..', '.F..FeF..', '.FFfefFF.'],
    ['.F..F....', '.Ff.FeF.F', '..FfeFfF.'],
  ].map((tips) => [...tips, ...SPIRIT_BODY]);
  // Face drawn over every frame: big white eyes with dark pupils, a wide grin.
  const SPIRIT_FACE = ['', '', '', '..WW.WW..', '..WK.KW..', '..WK.KW..', '', '.K.....K.', '..K...K..', '...KKK...'];
  // Blink frame: eyelids cover the eyes, leaving a dark closed-eye line.
  const SPIRIT_BLINK = ['', '', '', '..ff.ff..', '..ff.ff..', '..KK.KK..'];
  const cellsFrom = (rows, cls) => rows.flatMap((row, dy) => [...row].flatMap((cell, dx) => (
    cell === '.' ? [] : [[SPIRIT_AT[0] + dx, SPIRIT_AT[1] + dy, cls(cell)]]
  )));
  const FACE_CLASS = { W: 'h-sp-eye', K: 'h-out' };
  const BLINK_CLASS = { f: 'h-sp-lid', K: 'h-sp-lidline' };
  const fireSpirit = [
    ...SPIRIT_FRAMES.flatMap((rows, i) => cellsFrom(rows, (cell) => `h-sp${i + 1}-${cell}`)),
    ...cellsFrom(SPIRIT_FACE, (cell) => FACE_CLASS[cell]),
    ...cellsFrom(SPIRIT_BLINK, (cell) => BLINK_CLASS[cell]),
  ];

  // Warm firelight breathing on the wall and floor around the hearth.
  const WARM_SURFACES = ['h-wall', 'h-wall-d', 'h-floor', 'h-floor-d'];
  const fireGlow = [];
  for (let y = 20; y <= 44; y += 1) {
    for (let x = 0; x <= 16; x += 1) {
      if (inEllipse(x + 0.5, y + 0.5, 5.5, 31, 11, 11) && WARM_SURFACES.includes(paint(x, y))) fireGlow.push([x, y, 'h-fireglow']);
    }
  }

  PastelTerm.scenes.register('howl', {
    name: "Wizard's Room",
    size: [48, 48],
    paint,
    moving: [
      ...glow,
      ...fireGlow,
      ...fireSpirit,
      ...strands,
      // Candle flames on the mantel and the book tower, two frames each.
      [8, 16, 'h-fa'], [8, 15, 'h-fb'], [29, 24, 'h-fa'], [29, 23, 'h-fb'],
      // Glints: the bookcase's red gem, the lantern glass, the staff crystal, the horn rim and the coins.
      [39, 3, 'h-glint'], [25, 6, 'h-glint2'], [31, 13, 'h-glint'], [16, 15, 'h-glint2'], [26, 38, 'h-glint'],
    ],
  });
})();

// Wizard's Study: the calmer, uncluttered take on the wizard's room (Wizard's Loft is the crammed one).
// Wizard's Room: a crammed treasure-trove bedroom (after Howl's), drawn behind the pet.
// Clarity rules: calm flat wall, a few large hero objects, each ringed by a 1px dark outline.
(() => {
  const { inEllipse } = PastelTerm.scenes.kit;

  // One letter per colour so the hand-drawn sprites below stay readable. '.' is see-through.
  const LEGEND = {
    o: 'hs-out', K: 'hs-void',
    W: 'hs-wood-d', w: 'hs-wood', v: 'hs-wood-l',
    B: 'hs-brass-d', b: 'hs-brass', y: 'hs-brass-l', '*': 'hs-shine',
    R: 'hs-red-d', r: 'hs-red', q: 'hs-red-l',
    T: 'hs-teal-d', t: 'hs-teal', u: 'hs-teal-l',
    G: 'hs-lan-d', g: 'hs-lan', z: 'hs-lan-l',
    C: 'hs-paper-d', c: 'hs-paper',
    P: 'hs-plum', p: 'hs-plum-l', N: 'hs-navy', n: 'hs-navy-l',
  };

  // Stamps a hand-drawn sprite: returns its colour at (x, y), or null when off it or see-through.
  function sprite(x, y, left, top, art) {
    const row = art[y - top];
    const cell = row?.[x - left];
    return cell && cell !== '.' ? LEGEND[cell] : null;
  }
  const art = (left, top, rows) => (x, y) => sprite(x, y, left, top, rows);

  // Wraps a shape so every empty cell touching it (4-way) becomes a dark outline.
  const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  function outlined(shape) {
    return (x, y) => shape(x, y)
      ?? (NEIGHBOURS.some(([dx, dy]) => shape(x + dx, y + dy)) ? 'hs-out' : null);
  }

  // Back wall: flat and dark so objects pop. Floor: plank boards under a woven rug.
  const FLOOR = 36;
  function wall(x, y) {
    if (y < FLOOR - 1) return y >= 30 ? 'hs-wall-d' : 'hs-wall';
    if (y === FLOOR - 1) return 'hs-wood-d';
    if (y === FLOOR) return 'hs-wood-l';
    const seam = (y - FLOOR) % 3 === 0 || (x + ((y - FLOOR) / 3 | 0) * 7) % 11 === 0;
    return seam ? 'hs-floor-d' : 'hs-floor';
  }

  // Woven rug under the pet: red field, brass border, big teal diamonds.
  const RUG = { left: 5, right: 47, top: 40, bottom: 47 };
  function rug(x, y) {
    const { left, right, top, bottom } = RUG;
    if (x < left || x > right || y < top || y > bottom) return null;
    if (y === top || x === left) return 'hs-out';
    if (x === left + 1 || y === top + 1) return 'hs-brass';
    const dx = Math.abs(((x - left) % 10) - 5);
    const dy = Math.abs(y - 44);
    if (dx + dy <= 1) return 'hs-brass-l';
    if (dx + dy === 2) return 'hs-teal';
    return 'hs-red';
  }

  // Sun mask, top left: orange face in a dark ring, eight brass rays, rosy cheeks and a grin.
  const SUN = { cx: 6, cy: 6 };
  function sunShape(x, y) {
    const dx = x - SUN.cx;
    const dy = y - SUN.cy;
    const d = Math.hypot(dx, dy);
    if (d <= 3.9) {
      if ((dx === -2 || dx === 2) && dy === -1) return 'hs-out';
      if ((dx === -3 || dx === 3) && dy === 1) return 'hs-red-l';
      if ((Math.abs(dx) <= 1 && dy === 2) || (Math.abs(dx) === 2 && dy === 1)) return 'hs-red-d';
      if (dx + dy <= -3) return 'hs-brass-l';
      if (dx + dy >= 3) return 'hs-brass-d';
      return 'hs-sun';
    }
    if (d <= 4.8) return 'hs-out';
    if (d > 6.6) return null;
    const turns = Math.atan2(dy, dx) / (Math.PI / 4);
    const lateral = Math.abs(turns - Math.round(turns)) * (Math.PI / 4) * d;
    if (lateral > 0.35 + (6.6 - d) * 0.55) return null;
    return dx + dy < 0 ? 'hs-brass-l' : 'hs-brass';
  }
  const sunMask = outlined(sunShape);

  // Caged green lantern hanging from the ceiling: brass cage, four glowing panes.
  const LANTERN_AT = [21, 0];
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
  const lantern = outlined(art(...LANTERN_AT, LANTERN));

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
    '......bB....',
    '......bbB...',
    '.......bB...',
    '..vvvvvvvwW.',
    '..wwbybwwwW.',
    '..WWWWWWWWW.',
  ];
  const gramophone = outlined(art(12, 12, HORN));

  // Treasure chest under the gramophone: wooden body, heavy brass straps and a lock.
  function chestShape(x, y) {
    const left = 14;
    const right = 25;
    if (x < left || x > right || y < 30 || y > 36) return null;
    if (y === 30 && (x === left || x === right)) return null;
    if (x === 19 || x === 20) {
      if (y === 32 || y === 33) return y === 33 && x === 19 ? 'hs-out' : 'hs-brass-l';
    }
    if (y === 32) return 'hs-out';
    if (x === left + 2 || x === right - 2) return y <= 31 ? 'hs-brass-l' : 'hs-brass';
    if (y === 30 || x === left) return 'hs-wood-l';
    if (x === right || y === 36) return 'hs-wood-d';
    return 'hs-wood';
  }
  const chest = outlined(chestShape);

  // Little candle on the chest, by the gramophone.
  const candle = outlined(art(14, 27, ['c', 'C', 'B']));

  // Wizard's staff leaning by the bookcase, topped with a teal crystal in brass claws.
  const STAFF = [
    '.u.', 'uuT', 'utT', '.T.', 'bBb', '.B.',
    ...Array.from({ length: 14 }, (_, i) => (i % 3 === 2 ? '.W.' : '.w.')),
  ];
  const staff = outlined(art(27, 16, STAFF));

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
    if (y >= bottom - 1) return y === bottom - 1 ? 'hs-stone-l' : 'hs-stone-d';
    if (inOpening(x, y)) {
      if (y === 35) return x === 1 || x === 9 ? 'hs-wood-l' : 'hs-wood';
      if (y === 36) return x === 3 || x === 5 || x === 7 ? 'hs-red-l' : 'hs-wood-d'; // embers between logs
      return 'hs-soot';
    }
    const row = y - top;
    if (row % 3 === 2) return 'hs-stone-d'; // mortar line
    const shift = Math.floor(row / 3) % 2 ? 2 : 0;
    if ((x + shift) % 4 === 3) return 'hs-stone-d';
    return row % 3 === 0 ? 'hs-stone-l' : 'hs-stone';
  }
  const hearth = outlined((x, y) => mantel(x, y) ?? hearthShape(x, y));

  // Ornate carved bookcase, right: arched crown with a big red gem, three shelves of chunky books.
  const CASE = { left: 32, right: 47, mid: 39.5 };
  const SHELVES = [8, 15, 22]; // first book row of each shelf; each shelf is 5 rows tall
  const BOOK_TONES = {
    r: ['hs-red-l', 'hs-red', 'hs-red-d'], t: ['hs-teal-l', 'hs-teal', 'hs-teal-d'],
    n: ['hs-navy-l', 'hs-navy', 'hs-out'], b: ['hs-brass-l', 'hs-brass', 'hs-brass-d'],
    c: ['hs-paper', 'hs-paper', 'hs-paper-d'],
  };
  // Books as [width, height, tone]; curios take a sprite instead of a tone.
  const CURIOS = {
    jar: ['vwW', 'zgG', 'zgG', 'gGG'],
    skull: ['ccc', 'oco', 'cCC', '.C.'],
    orb: ['.p.', 'ppP', 'pPP', 'bBB'],
  };
  const SHELF_ITEMS = [
    [[2, 5, 'r'], [2, 4, 't'], [3, 4, 'jar'], [1, 5, 'b'], [2, 5, 'n'], [2, 4, 'c']],
    [[1, 5, 'b'], [2, 5, 't'], [2, 4, 'c'], [3, 4, 'skull'], [2, 5, 'r'], [2, 3, 'n']],
    [[2, 5, 'n'], [2, 4, 'r'], [3, 4, 'orb'], [2, 5, 't'], [1, 4, 'b'], [2, 5, 'c']],
  ];
  function shelfItem(x, y, shelfTop, items) {
    let left = CASE.left + 2;
    const floor = shelfTop + 4;
    for (const [width, height, kind] of items) {
      if (x < left + width) {
        const top = floor - height + 1;
        if (CURIOS[kind]) return sprite(x, y, left, top, CURIOS[kind]) ?? 'hs-void';
        if (y < top) return 'hs-void';
        const [light, mid, dark] = BOOK_TONES[kind];
        const col = x - left;
        if (y === top + 1 && height >= 5) return 'hs-brass-l';
        if (width > 1 && col === width - 1) return dark;
        return col === 0 ? light : mid;
      }
      left += width;
    }
    return 'hs-void';
  }
  function bookcase(x, y) {
    const { left, right, mid } = CASE;
    if (x < left || x > right || y > 33) return null;
    // Crown: an arch peaking over the centre, with the red gem in a brass setting.
    const archTop = Math.round(Math.abs(x - mid) / 3);
    if (y < archTop) return null;
    if (y <= 6) {
      if (y === archTop || x === left || x === right) return 'hs-out';
      const gem = Math.hypot((x - mid) / 1.6, (y - 3.5) / 1.5);
      if (gem <= 1) return x < mid && y < 4 ? 'hs-red-l' : 'hs-red';
      if (gem <= 1.6) return 'hs-brass-l';
      if (gem <= 2.1) return 'hs-out';
      if (y === 6) return 'hs-brass-d';
      return y === archTop + 1 ? 'hs-wood-l' : 'hs-wood';
    }
    // Side posts with a teal stud each.
    if (x === left || x === right) return 'hs-out';
    if (x === left + 1 || x === right - 1) {
      if (y === 11 || y === 18) return 'hs-teal-l';
      return x === left + 1 ? 'hs-wood-l' : 'hs-wood-d';
    }
    const shelf = SHELVES.findIndex((top) => y >= top && y <= top + 4);
    if (shelf >= 0) return shelfItem(x, y, SHELVES[shelf], SHELF_ITEMS[shelf]);
    if (y === 7) return 'hs-wood-d';
    if ([13, 20, 27].includes(y)) return 'hs-wood-l';
    if ([14, 21, 28].includes(y)) return 'hs-wood-d';
    // Lower cupboard, behind the pet.
    if (y === 33) return 'hs-out';
    return y === 29 ? 'hs-wood-l' : 'hs-wood';
  }

  // Front to back: the first layer that paints a cell wins.
  function paint(x, y) {
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

  // Talisman strings that sway while Claude works; each string has its own code group.
  const strand = (group, x, top, beads, charm) => {
    const cells = [];
    const charmTop = top + beads.length;
    for (let i = 0; i < beads.length; i += 1) cells.push([x, top + i, `hs-s${group}-${beads[i]}`]);
    charm.forEach((row, dy) => [...row].forEach((cell, dx) => {
      if (cell !== '.') cells.push([x - 1 + dx, charmTop + dy, `hs-s${group}-${cell}`]);
    }));
    return cells;
  };
  const strands = [
    // Brass crescent between the sun and the gramophone.
    ...strand(1, 15, 0, ['s', 's', 't', 's', 'r', 's', 'b', 's'], ['.b.', 'b..', 'b.y', '.bb']),
    // Teal evil-eye charm beside the lantern.
    ...strand(2, 18, 0, ['s', 'r', 's', 'b', 's'], ['ttt', 'tot', 'ttt', '.r.']),
    // Red tassel between the lantern and the bookcase.
    ...strand(3, 30, 0, ['s', 's', 'b', 's', 't', 's', 's', 'b', 's', 's'], ['.b.', '.r.', 'rRr', 'r.R']),
  ];

  // Green light pooling on the wall around the lantern.
  const glow = [];
  for (let y = 0; y <= 18; y += 1) {
    for (let x = 15; x <= 31; x += 1) {
      if (inEllipse(x + 0.5, y + 0.5, 24.5, 7.5, 7.5, 9) && paint(x, y) === 'hs-wall') glow.push([x, y, 'hs-glow']);
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
  const FACE_CLASS = { W: 'hs-sp-eye', K: 'hs-out' };
  const BLINK_CLASS = { f: 'hs-sp-lid', K: 'hs-sp-lidline' };
  const fireSpirit = [
    ...SPIRIT_FRAMES.flatMap((rows, i) => cellsFrom(rows, (cell) => `hs-sp${i + 1}-${cell}`)),
    ...cellsFrom(SPIRIT_FACE, (cell) => FACE_CLASS[cell]),
    ...cellsFrom(SPIRIT_BLINK, (cell) => BLINK_CLASS[cell]),
  ];

  // Warm firelight breathing on the wall and floor around the hearth.
  const WARM_SURFACES = ['hs-wall', 'hs-wall-d', 'hs-floor', 'hs-floor-d'];
  const fireGlow = [];
  for (let y = 20; y <= 44; y += 1) {
    for (let x = 0; x <= 16; x += 1) {
      if (inEllipse(x + 0.5, y + 0.5, 5.5, 31, 11, 11) && WARM_SURFACES.includes(paint(x, y))) fireGlow.push([x, y, 'hs-fireglow']);
    }
  }

  PastelTerm.scenes.register('study', {
    name: "Wizard's Study",
    size: [48, 48],
    paint,
    moving: [
      ...glow,
      ...fireGlow,
      ...fireSpirit,
      ...strands,
      // Candle flames on the mantel and the chest, two frames each.
      [8, 16, 'hs-fa'], [8, 15, 'hs-fb'], [14, 26, 'hs-fa'], [14, 25, 'hs-fb'],
      // Glints: the bookcase's red gem, the lantern glass, the staff crystal and the horn rim.
      [39, 3, 'hs-glint'], [22, 6, 'hs-glint2'], [27, 17, 'hs-glint'], [15, 13, 'hs-glint2'],
    ],
  });
})();

// Mid-Century Lounge: a mustard couch under a big window, a teak credenza with a spinning record, drawn behind the pet.
// Clarity rules: light from the window (top left), 2-3 tones per material, each object ringed by a 1px edge in its own darkest tone.
(() => {
  const { inCircle, inEllipse } = PastelTerm.scenes.kit;

  // One letter per colour so the hand-drawn sprites below stay readable. '.' is see-through.
  const LEGEND = {
    o: 'm-out', c: 'm-cream',
    y: 'm-brass-l', b: 'm-brass', B: 'm-brass-d', e: 'm-brass-o', '*': 'm-bulb',
    v: 'm-teak-l', w: 'm-teak', W: 'm-teak-d',
    z: 'm-walnut-l', n: 'm-walnut',
    Q: 'm-vinyl', T: 'm-vinyl-l',
    q: 'm-orange-l', r: 'm-orange', R: 'm-orange-d',
    l: 'm-olive-l', g: 'm-olive', G: 'm-olive-d',
    k: 'm-char-l', h: 'm-char', H: 'm-char-d',
  };

  // Stamps a hand-drawn sprite: returns its colour at (x, y), or null when off it or see-through.
  const art = (left, top, rows) => (x, y) => {
    const cell = rows[y - top]?.[x - left];
    return cell && cell !== '.' ? LEGEND[cell] : null;
  };

  // Wraps a shape so every empty cell touching it (4-way) becomes its edge colour.
  const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  function outlined(shape, edge) {
    return (x, y) => shape(x, y)
      ?? (NEIGHBOURS.some(([dx, dy]) => shape(x + dx, y + dy)) ? edge : null);
  }

  // Layout in sprite pixels on the 48x48 canvas.
  const FLOOR = 33; // first floor row; furniture feet stand on the skirting just above it
  const WINDOW = { left: 1, right: 21, top: 1, bottom: 13, sill: 14 };
  const COUCH = { left: 1, right: 19, top: 19 };
  const CREDENZA = { left: 30, right: 47, top: 18, bottom: 25 };

  // Back wall: deep teal accent paint with a teak skirting board; floor: dark walnut planks.
  function wall(x, y) {
    if (y < FLOOR - 1) return y >= FLOOR - 5 ? 'm-wall-d' : 'm-wall';
    if (y === FLOOR - 1) return 'm-teak-d';
    const row = y - FLOOR;
    const seam = row % 3 === 2 || (x + Math.floor(row / 3) * 7) % 13 === 0;
    return seam ? 'm-floor-d' : 'm-floor';
  }

  // Big window: teak frame lit top-left, a mullion, a golden-hour view of soft hills and a round tree.
  function windowShape(x, y) {
    const { left, right, top, bottom, sill } = WINDOW;
    if (x < left || x > right || y < top || y > sill) return null;
    if (y === sill) return x === right ? 'm-teak-d' : 'm-teak-l';
    if (x === left || y === top) return 'm-teak-l';
    if (x === right || y === bottom) return 'm-teak-d';
    if (x === 11) return 'm-teak';
    if (inCircle(x + 0.5, y + 0.5, 16.5, 5, 1.8)) return 'm-sun';
    if (x === 6 && y >= 10) return 'm-teak-d'; // trunk
    if (inEllipse(x + 0.5, y + 0.5, 6.5, 7.5, 3, 2.8)) return x + y < 13 ? 'm-olive-l' : 'm-olive';
    const hill = (cx, h, w) => bottom - Math.max(0, h - ((x - cx) / w) ** 2 * h);
    if (y >= hill(15, 5, 6)) return 'm-olive-d';
    if (y >= hill(4, 4, 7)) return 'm-olive';
    return y <= 4 ? 'm-sky1' : y <= 8 ? 'm-sky2' : 'm-sky3';
  }
  const windowFrame = outlined(windowShape, 'm-teak-o');

  // Sunburst wall clock: an outlined teak ring and cream face, thin brass rods with bead tips at 0/45/90 degrees.
  const clock = art(32, 0, [
    'y....y....b',
    '.b...b...B.',
    '..b.eee.B..',
    '...evvve...',
    '..evcocwe..',
    'ybevcooweBb',
    '..evcccwe..',
    '...ewwwe...',
    '..B.eee.B..',
    '.b...B...b.',
  ]);

  // Sputnik pendant: a brass hub on a cord, straight dark spokes ending in bulbs.
  // The hub edges itself (lit top-left, brass-d bottom-right): an outline ring would swallow the spokes.
  const SPUTNIK_HUB = art(25, 7, ['yyb', 'ybB', 'bBB']);
  const SPUTNIK_BULBS = [[23, 5], [29, 5], [23, 8], [29, 8], [23, 11], [29, 11], [26, 12]];
  const SPUTNIK_SPOKES = [[24, 6], [28, 6], [24, 8], [28, 8], [24, 10], [28, 10], [26, 11]];
  const isAt = (list, x, y) => list.some(([px, py]) => px === x && py === y);
  function sputnik(x, y) {
    if (x === 26 && y < 6) return 'm-out'; // cord
    if (isAt(SPUTNIK_BULBS, x, y)) return 'm-bulb';
    if (isAt(SPUTNIK_SPOKES, x, y)) return 'm-brass-o';
    return SPUTNIK_HUB(x, y);
  }

  // Couch: low and long, wooden arms and base, a tufted mustard back, splayed tapered legs.
  const BUTTONS = { 20: [7, 10, 13], 22: [8, 12] };
  function couchShape(x, y) {
    const { left, right, top } = COUCH;
    if (x < left || x > right || y < top || y > 28) return null;
    // Throw pillows: avocado on the left, burnt orange on the right.
    const pillow = (pl, colour) => {
      if (x < pl || x > pl + 3 || y < 19 || y > 24) return null;
      if ((y === 19 || y === 24) && (x === pl || x === pl + 3)) return null;
      if (y === 21 && (x === pl + 1 || x === pl + 2)) return `${colour}-d`; // pinched centre
      return y === 19 || x === pl ? `${colour}-l` : x === pl + 3 || y === 24 ? `${colour}-d` : colour;
    };
    const p = pillow(2, 'm-olive') ?? pillow(15, 'm-orange');
    if (p) return p;
    // Back cushion with two offset rows of tufting buttons.
    if (y <= 23 && x > left && x < right) {
      if (y === top && (x === left + 1 || x === right - 1)) return null;
      if (BUTTONS[y]?.includes(x)) return 'm-mustard-dd';
      if (y === top) return 'm-mustard-l';
      return y === 23 ? 'm-mustard-d' : 'm-mustard';
    }
    // Wooden arms rising either side.
    if (x === left || x === right) {
      if (y < 21) return null;
      if (y === 21) return 'm-teak-l';
      if (y === 28) return 'm-teak-d';
      return x === left ? 'm-teak' : 'm-teak-d';
    }
    // Seat cushion: lit top, face, shaded front edge, with a seam splitting it in two.
    if (y <= 27) {
      if (x === 10 && y >= 25) return 'm-mustard-d';
      return ['m-mustard-l', 'm-mustard', 'm-mustard', 'm-mustard-d'][y - 24];
    }
    return y === 28 ? 'm-teak' : null;
  }
  const couchBody = outlined(couchShape, 'm-mustard-o');
  // Splayed legs below the edge line: front legs lean out, a back pair sits in shadow.
  function couch(x, y) {
    const body = couchBody(x, y);
    if (body) return body;
    if (y < 30 || y > FLOOR - 1) return null;
    const splay = y >= 31 ? 1 : 0;
    if (x === 3 - splay || x === 17 + splay) return 'm-teak-o';
    if ((x === 7 || x === 13) && y === 30) return 'm-out';
    return null;
  }

  // Credenza: teak top, two slatted doors with a drawer bank between, brass pulls.
  function credenzaShape(x, y) {
    const { left, right, top, bottom } = CREDENZA;
    if (x < left || x > right || y < top || y > bottom) return null;
    if (y === top) return 'm-teak-l';
    if (y === bottom) return 'm-teak-d';
    if (x === left) return 'm-teak';
    if (x === right) return 'm-teak-d';
    if (x >= 36 && x <= 40) {
      if (y === 21 || y === 23) return 'm-teak-d'; // drawer seams
      if (x === 38 && (y === 20 || y === 22 || y === 24)) return 'm-brass-l';
      return 'm-walnut';
    }
    if (y === top + 1) return 'm-teak-d'; // shadow under the top
    return x % 2 ? 'm-teak' : 'm-teak-dd';
  }
  const credenzaBody = outlined(credenzaShape, 'm-teak-o');
  function credenza(x, y) {
    const body = credenzaBody(x, y);
    if (body) return body;
    if (y <= CREDENZA.bottom + 1 || y > FLOOR - 1) return null;
    const splay = y >= 30 ? 1 : 0;
    if (x === 32 - splay || x === 45 + splay) return 'm-teak-o';
    return null;
  }

  // Record player on the credenza: black record with an orange label on a charcoal deck, brass tonearm, walnut plinth.
  const player = outlined(art(30, 10, [
    '..........y.',
    '..QQQQQ..yb.',
    'kQTrrrTQykb.',
    'hQTrcrTQhhbh',
    'hhQQQQQhhhhh',
    'zzzzzzzzzzyz',
    'nnnnnnnnnnnn',
  ]), 'm-walnut-o');

  // Records leaning beside the player: an avocado sleeve with a disc peeking out, an orange one in front.
  const records = outlined(art(43, 11, [
    '..QQ.',
    '.llgG',
    'qrrRG',
    'qcrRG',
    'qrrRG',
    'qrrRG',
  ]), 'm-out');

  // Snake plant in a tapered charcoal planter on short legs, between the couch and the credenza.
  const plantBody = outlined(art(22, 15, [
    '...l...',
    'l..lG..',
    'lG.lG.l',
    'lG.lGlG',
    '.lGlGlG',
    '.lGgGlG',
    '.gGlGgG',
    '.lGgGlG',
    '.gGlGgG',
    '.lGlGlG',
    '.cccccc',
    '.khhhhH',
    '.khhhhH',
    '..khH.',
    '..khH.',
  ]), 'm-olive-o');
  function plant(x, y) {
    const body = plantBody(x, y);
    if (body) return body;
    return (x === 24 || x === 27) && y >= 31 && y <= FLOOR - 1 ? 'm-teak-o' : null;
  }

  // Round rug under the pet: concentric rings of teal, cream, mustard and orange.
  function rugShape(x, y) {
    const px = x + 0.5;
    const py = y + 0.5;
    const ring = (s) => inEllipse(px, py, 31, 41.5, 14.5 * s, 5 * s);
    if (!ring(1)) return null;
    if (!ring(0.86)) return 'm-teal';
    if (!ring(0.66)) return 'm-cream';
    if (!ring(0.42)) return 'm-mustard';
    return 'm-orange';
  }
  const rug = outlined(rugShape, 'm-teal-o');

  // Soft shadows on the floor under the furniture.
  const inShadow = (x, y) => y === FLOOR && ((x >= COUCH.left && x <= COUCH.right) || x >= CREDENZA.left || (x >= 23 && x <= 28));

  // Front to back: the first layer that paints a cell wins.
  function paint(x, y) {
    return windowFrame(x, y)
      ?? clock(x, y)
      ?? sputnik(x, y)
      ?? player(x, y)
      ?? records(x, y)
      ?? credenza(x, y)
      ?? couch(x, y)
      ?? plant(x, y)
      ?? rug(x, y)
      ?? (inShadow(x, y) ? 'm-shadow' : null)
      ?? wall(x, y);
  }

  // Record glints: four vinyl cells round the label, lit one after another so the record reads as spinning.
  const GLINTS = [[33, 11, 'm-gl1'], [37, 12, 'm-gl2'], [35, 14, 'm-gl3'], [31, 13, 'm-gl4']];
  // Music notes drifting up from the player.
  const note = (x, y, cls) => [[x, y, cls], [x + 1, y, cls], [x + 1, y - 1, cls], [x + 1, y - 2, cls], [x + 2, y - 2, cls]];
  const NOTES = [...note(30, 9, 'm-note1'), ...note(43, 8, 'm-note2')];
  PastelTerm.scenes.register('midcentury', {
    name: 'Mid-Century Lounge',
    size: [48, 48],
    paint,
    moving: [...GLINTS, ...NOTES],
  });
})();

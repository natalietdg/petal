// Bakery: a cosy brown bread shop. Caramel awning, warm plaster wall under a pendant lamp,
// wooden shelves of loaves, a basket of baguettes, and a glass case of cream buns. Light from the top-left.
// Clarity rules: every object is ringed by a 1px outline in a darker tone of its own material.
(() => {
  const { inCircle, inEllipse } = PastelTerm.scenes.kit;

  // Layout rows on the 48x48 canvas.
  const AWNING_BOTTOM = 7;
  const TOP_SHELF = 15;
  const LOW_SHELF = 25;
  const COUNTER_TOP = 29;
  const CHAIR_RAIL = 34;
  const LAMP = { x: 23.5, y: 12 };

  // Wraps a shape so every empty cell touching it (4-way) becomes its outline colour.
  const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  function outlined(shape, ink) {
    return (x, y) => shape(x, y) ?? (NEIGHBOURS.some(([dx, dy]) => shape(x + dx, y + dy)) ? ink : null);
  }
  // Stacks layers front to back: the first one with a colour at (x, y) wins.
  const stack = (...layers) => (x, y) => {
    for (const layer of layers) {
      const cell = layer(x, y);
      if (cell) return cell;
    }
    return null;
  };

  // Turns a little bitmap into a painter at (left, top); '.' is empty, other letters map through the legend.
  const sprite = (rows, legend) => (x, y, left, top) => {
    const ch = rows[y - top]?.[x - left];
    return ch && ch !== '.' ? legend[ch] : null;
  };

  // Awning: 8 caramel and cream stripes of 6, each ending in a rounded scallop with a shaded underside.
  function awningShape(x, y) {
    if (y === 0) return 'b-rod';
    const col = x % 6;
    const [lit, mid, dark] = Math.floor(x / 6) % 2 === 0 ? ['b-caramelL', 'b-caramel', 'b-caramelD'] : ['b-creamL', 'b-cream', 'b-creamD'];
    if (y === 1) return lit;
    if (y <= 5) return col === 0 && y <= 3 ? lit : mid;
    if (y === 6 && col >= 1 && col <= 4) return col === 1 || col === 4 ? dark : mid;
    if (y === 7 && (col === 2 || col === 3)) return dark;
    return null;
  }
  const awning = outlined(awningShape, 'b-awn-ink');

  // Back wall: striped plaster, a soft pool of lamplight, then a chair rail and dark wood wainscot.
  function wall(x, y) {
    if (y <= AWNING_BOTTOM + 1) return 'b-wallD'; // shadow under and between the scallops
    if (y === CHAIR_RAIL) return 'b-woodL';
    if (y > CHAIR_RAIL) return x % 6 === 5 ? 'b-wainD' : 'b-wain';
    if (inCircle(x + 0.5, y + 0.5, LAMP.x + 0.5, LAMP.y + 1, 4.5)) return 'b-glow';
    if (inCircle(x + 0.5, y + 0.5, LAMP.x + 0.5, LAMP.y + 1, 6.5) && (x + y) % 2 === 0) return 'b-glow';
    return x % 4 === 3 ? 'b-wallS' : 'b-wall';
  }

  // Pendant lamp: a cord, a domed copper shade lit on the left, and a warm bulb peeking out below.
  const cord = (x, y) => (x === 23 && y === 8 ? 'b-cord' : null);
  const bulb = (x, y) => (y === 12 && (x === 23 || x === 24) ? 'b-bulb' : null);
  const shade = outlined((x, y) => {
    if (y === 9 && (x === 23 || x === 24)) return 'b-shadeD';
    if (y === 10 && x >= 22 && x <= 25) return x === 22 ? 'b-shadeL' : x === 25 ? 'b-shadeD' : 'b-shade';
    if (y === 11 && x >= 21 && x <= 26) return x === 26 ? 'b-shadeD' : x <= 22 ? 'b-shadeL' : 'b-shade';
    return null;
  }, 'b-shade-ink');
  const lamp = stack(cord, bulb, shade);

  // A crusty shape: outlined edge, lit top-left, shaded bottom-right.
  function crust(x, y, inside, cx, cy) {
    if (!inside(x, y)) return null;
    if (!inside(x + 1, y) || !inside(x - 1, y) || !inside(x, y + 1) || !inside(x, y - 1)) return 'b-ol';
    const lean = (x - cx) + (y - cy) * 1.6;
    if (lean < -2.5) return 'b-crustL';
    if (lean > 2.5) return 'b-crustD';
    return 'b-crust';
  }

  // Round boule with two pale diagonal score cuts across its top.
  function boule(cx, cy, rx, ry) {
    return (x, y) => {
      const cell = crust(x, y, (px, py) => inEllipse(px + 0.5, py + 0.5, cx, cy, rx, ry), cx - 0.5, cy - 0.5);
      if (cell && cell !== 'b-ol' && y + 0.5 <= cy) {
        const k = x - Math.floor(cx) + (y - Math.floor(cy));
        if ((k === -2 || k === 1) && Math.abs(x + 0.5 - cx) < rx - 1.5) return 'b-score';
      }
      return cell;
    };
  }

  // Sandwich loaf: a tin-baked block with a domed top and a pale split along its crown.
  function panLoaf(left, top) {
    const right = left + 8;
    const inside = (px, py) => px >= left && px <= right && py >= top && py <= top + 5
      && !(py === top && (px <= left + 1 || px >= right - 1));
    return (x, y) => {
      const cell = crust(x, y, inside, left + 4, top + 2.5);
      if (cell && cell !== 'b-ol' && y === top + 1 && x >= left + 2 && x <= right - 2) return 'b-score';
      if (cell && cell !== 'b-ol' && y === top + 2 && x === left + 1) return 'b-crustL';
      return cell;
    };
  }

  // Braided loaf: plaited chevrons with dark creases, a glossy egg-wash top and a few sesame seeds.
  function braid(cx, cy) {
    return (x, y) => {
      const cell = crust(x, y, (px, py) => inEllipse(px + 0.5, py + 0.5, cx, cy, 5.3, 2.9), cx - 0.5, cy - 0.5);
      if (!cell || cell === 'b-ol') return cell;
      if ((x + Math.abs(y - Math.floor(cy))) % 3 === 0) return 'b-crustD';
      if (y + 0.5 < cy && (x * 5 + y * 3) % 7 === 0) return 'b-seed';
      return cell;
    };
  }

  // Three baguettes standing in the basket, each with a rounded tip and slanted pale scores.
  // Listed front to back so each one's outline separates it from the one behind; they stand in front of the shelf.
  const BAGUETTES = [[2, 18], [10, 19], [6, 15]];
  const baguette = (left, top) => outlined((x, y) => {
    const dx = x - left;
    if (dx < 0 || dx > 2 || y < top || y > 22) return null;
    if (y === top) return dx === 1 ? 'b-crustL' : null; // rounded tip
    if (dx < 2 && (y - top + dx) % 3 === 0) return 'b-score';
    return ['b-crustL', 'b-crust', 'b-crustD'][dx];
  }, 'b-ol');
  const baguettes = stack(...BAGUETTES.map(([left, top]) => baguette(left, top)));

  // Wicker basket: lit rim, woven body that tapers at the bottom, shaded right side.
  function basket(x, y) {
    if (y < 23 || y > 28) return null;
    const inset = y === 28 ? 1 : 0;
    if (x < 1 + inset || x > 13 - inset) return null;
    if (y === 23) return x === 13 ? 'b-wicker' : 'b-wickerL';
    if (x === 13 - inset || y === 28) return 'b-wickerD';
    return (x + Math.floor(y / 2)) % 2 ? 'b-wicker' : 'b-wickerL';
  }
  const basketInk = outlined(basket, 'b-wicker-ink');

  // Cream bun: a golden lid dusted with powdered sugar, a thick band of cream, a golden base.
  const creamBun = sprite([
    '.oooo.',
    'osLsMo',
    'oLsMDo',
    'WWWWWw',
    'oWWWwo',
    'oMMDDo',
    '.oooo.',
  ], { o: 'b-ol', L: 'b-crustL', M: 'b-crust', D: 'b-crustD', s: 'b-sugar', W: 'b-whip', w: 'b-whipD' });

  // Croissant: a plump 11x5 crescent with drooping horns, split into rolled segments by dark creases.
  const CROISSANT_ROWS = [[3, 7], [1, 9], [0, 10], [0, 10], [0, 10]];
  const CROISSANT_GAP = [null, null, null, null, [3, 7]];
  const CROISSANT_CREASES = ['3,1', '3,2', '3,3', '7,1', '7,2', '7,3'];
  function croissant(left, top) {
    const inside = (px, py) => {
      const row = CROISSANT_ROWS[py - top];
      const gap = CROISSANT_GAP[py - top];
      const dx = px - left;
      return !!row && dx >= row[0] && dx <= row[1] && !(gap && dx >= gap[0] && dx <= gap[1]);
    };
    return (x, y) => {
      const cell = crust(x, y, inside, left + 5, top + 2);
      if (cell && cell !== 'b-ol' && CROISSANT_CREASES.includes(`${x - left},${y - top}`)) return 'b-crustD';
      return cell;
    };
  }

  // Glass case: wooden top, warm glass with a diagonal shine over three cream buns, panelled wooden base.
  const counter = outlined((x, y) => {
    if (x < 1 || x > 26 || y < COUNTER_TOP) return null;
    if (y === COUNTER_TOP) return x === 26 ? 'b-wood' : 'b-woodL';
    if (y === COUNTER_TOP + 1) return 'b-woodD';
    if (y <= 40) {
      if (x === 1 || x === 26 || y === 40) return 'b-frame';
      const bun = creamBun(x, y, 3, 33) ?? creamBun(x, y, 10, 33) ?? creamBun(x, y, 17, 33);
      if (bun) return bun;
      const shine = x - (y - 31);
      if ((shine === 6 || shine === 7 || shine === 16) && y <= 32) return 'b-shine';
      return y === 39 ? 'b-glassD' : 'b-glass';
    }
    if (y === 41) return 'b-woodD';
    // Two inset panels: dark top-left rim, lit bottom-right rim.
    const panelLeft = x >= 3 && x <= 12;
    const panelRight = x >= 15 && x <= 24;
    if ((panelLeft || panelRight) && y >= 43 && y <= 46) {
      const [l, r] = panelLeft ? [3, 12] : [15, 24];
      if (y === 43 || x === l) return 'b-woodD';
      if (y === 46 || x === r) return 'b-woodL';
      return 'b-wood';
    }
    return x === 26 ? 'b-woodD' : 'b-wood';
  }, 'b-wood-ink');

  // A shelf plank: lit top, mid front edge, shaded brackets underneath; all ringed in dark wood.
  function shelf(top, from, to, brackets) {
    return outlined((x, y) => {
      if (x < from || x > to) return null;
      if (y === top) return 'b-woodL';
      if (y === top + 1) return 'b-wood';
      const b = brackets.find((bx) => x >= bx && x <= bx + 2 - (y - top - 2));
      if (b !== undefined && y >= top + 2 && y <= top + 3) return 'b-woodD';
      return null;
    }, 'b-wood-ink');
  }

  // Front to back. Fill-only layers sit ahead of outlines that must not cut into them.
  const paint = stack(
    awning, lamp,
    boule(5.5, 12, 4.5, 3), panLoaf(11, 9), braid(34, 12.1), boule(44, 12.4, 3, 2.6),
    basket, baguettes,
    shelf(TOP_SHELF, 1, 46, [12, 36]),
    croissant(28, 20), (x, y) => creamBun(x, y, 40, 18),
    shelf(LOW_SHELF, 28, 46, [30, 43]),
    boule(20.5, 27, 4.5, 2.4),
    counter, basketInk,
    wall,
  );

  PastelTerm.scenes.register('bakery', {
    name: 'Bakery',
    size: [48, 48],
    paint,
    // Two wisps of steam curling up off the fresh boule on the counter.
    moving: [
      [19, 23, 'b-steam'], [18, 22, 'b-steam'], [18, 21, 'b-steam'], [19, 20, 'b-steam'],
      [22, 23, 'b-steam2'], [23, 22, 'b-steam2'], [23, 21, 'b-steam2'], [22, 20, 'b-steam2'],
    ],
  });
})();

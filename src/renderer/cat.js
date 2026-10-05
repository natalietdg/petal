// A 20x20 pixel pet in the reader's corner: eyes shut and dozing when Claude rests, playing when it works.
// Three cats share one silhouette; each has her own coat, her own prop and her own busy move.
PastelTerm.cat = (() => {
  // O outline · B fur · L belly · P pink (ears, nose, beans) · K blush · E eye · W eye sparkle.
  const SITTING = [
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
  const EYES_OPEN = [
    [6, '...EEE......EEE.....'],
    [7, '...EWO......EWO.....'],
    [8, '...EOO......EOO.....'],
  ];
  // Closed eyes sit on the open eyes' middle row, 3 wide, so a dozing face matches the awake one.
  const EYES_CLOSED = [
    [7, '...OOO......OOO.....'],
  ];
  const TAIL_UP = [
    [12, '.................O..'],
    [13, '................OBO.'],
    [14, '................OBO.'],
    [15, '...............OBO..'],
    [16, '..............OBO...'],
  ];
  const TAIL_DOWN = [
    [16, '...............OOO..'],
    [17, '..............OBBBO.'],
    [18, '...............OOO..'],
  ];

  // Markings drawn over the shared silhouette.
  // S stripe · R orange patch · M white fur · C collar · T collar tag.
  const CATS = {
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
  };

  // Each cat's toy, on the same 3px grid. r/d ball · c/g cup and tea · s steam · f/D fish and its outline · e bone.
  const PROPS = {
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
  };

  // The eye sparkle (W) sits in the pupil at 2/3 size: 2px at 3px per pixel, so it stays crisp.
  const SPARKLE = 2 / 3;
  const rect = (x, y, cell) => (cell === 'W'
    ? `<rect x="${x}" y="${y}" width="1" height="1" class="px-O"/><rect x="${x}" y="${y}" width="${SPARKLE}" height="${SPARKLE}" class="px-W"/>`
    : `<rect x="${x}" y="${y}" width="1" height="1" class="px-${cell}"/>`);
  const rects = (rows, offset = 0) => rows.flatMap((row, y) => [...row].flatMap((cell, x) => (
    cell === '.' ? [] : [rect(x, y + offset, cell)]
  ))).join('');
  const partial = (lines) => lines.map(([y, row]) => rects([row], y)).join('');

  const overlay = (rows, lines) => {
    const out = [...rows];
    for (const [y, line] of lines) out[y] = [...out[y]].map((cell, x) => (line[x] && line[x] !== '.' ? line[x] : cell)).join('');
    return out;
  };
  const region = (rows, [y0, y1], [x0, x1]) => rows.map((row, y) => [...row].map((cell, x) => (
    y >= y0 && y <= y1 && x >= x0 && x <= x1 ? cell : '.'
  )).join(''));
  const without = (rows, parts) => rows.map((row, y) => [...row].map((cell, x) => (
    parts.some((part) => part[y][x] !== '.') ? '.' : cell
  )).join(''));

  const svg = (inner) => `<svg viewBox="0 0 20 20" shape-rendering="crispEdges" aria-hidden="true">${inner}</svg>`;

  // Ears and front paws live in their own groups so each cat's move can animate them.
  function sittingSvg(cat) {
    const coat = overlay(cat.base ?? SITTING, cat.sitting);
    const parts = {
      'ear-left': region(coat, [0, 2], [0, 6]),
      'ear-right': region(coat, [0, 2], [12, 19]),
      'paw-left': region(coat, [17, 18], [0, 7]),
      'paw-right': region(coat, [17, 18], [10, 19]),
    };
    const groups = Object.entries(parts).map(([name, rows]) => `<g class="${name}">${rects(rows)}</g>`).join('');
    return svg(groups + rects(without(coat, Object.values(parts)))
      + `<g class="eyes-open">${partial(cat.eyesOpen)}</g><g class="eyes-closed">${partial(cat.eyesClosed ?? EYES_CLOSED)}</g>`
      + (cat.tail === false ? '' : `<g class="tail-up">${partial(TAIL_UP)}</g><g class="tail-down">${partial(TAIL_DOWN)}</g>`));
  }

  // Tea steam is its own group so it can rise; everything else in a prop moves as one.
  function propSvg(prop) {
    const width = prop.rows[0].length;
    const height = prop.rows.length;
    const steam = prop.rows.map((row) => row.replace(/[^s]/g, '.'));
    const solid = prop.rows.map((row) => row.replace(/s/g, '.'));
    const inner = `<g class="steam">${rects(steam)}</g>${rects(solid)}`;
    return `<svg viewBox="0 0 ${width} ${height}" width="${width * 3}" height="${height * 3}" shape-rendering="crispEdges" aria-hidden="true">${inner}</svg>`;
  }

  const root = document.getElementById('cat');
  let current = CATS.mika;
  let busy = false;
  let scene = 'none';

  const updateTip = () => {
    root.querySelector('.cat-tip').textContent = `${current.name} · ${busy ? 'Claude is working' : 'Claude is resting'}`;
  };

  function render() {
    const prop = PROPS[root.dataset.cat] ?? PROPS.mika;
    const layers = PastelTerm.scenes.svg(scene);
    root.innerHTML = layers.back
      + `<div class="cat-prop prop-${prop.name}">${propSvg(prop)}</div>`
      + `<div class="cat-sprite sitting">${sittingSvg(current)}</div>`
      + '<span class="cat-z">z</span>'
      + layers.front
      + '<span class="cat-tip" role="tooltip"></span>';
    updateTip();
  }

  // Replies arrive every tick: only touch the class and tip, never re-render, or the animations restart.
  // After Claude finishes she stays sitting up, eyes open, for a while before dozing off.
  const AWAKE_AFTER_WORK_MS = 5 * 60 * 1000;
  let dozeTimer = null;

  function setBusy(next) {
    const wasBusy = busy;
    busy = Boolean(next);
    root.classList.toggle('busy', busy);
    if (busy) {
      clearTimeout(dozeTimer);
      root.classList.add('awake');
    } else if (wasBusy) {
      clearTimeout(dozeTimer);
      dozeTimer = setTimeout(() => root.classList.remove('awake'), AWAKE_AFTER_WORK_MS);
    }
    updateTip();
  }

  // Unknown ids (an old settings file, a retired or renamed cat) fall back to Mika.
  function setCat(id) {
    const key = Object.hasOwn(CATS, id) ? id : 'mika';
    current = CATS[key];
    root.dataset.cat = key;
    render();
  }

  function setScene(id) {
    scene = PastelTerm.scenes.has(id) ? id : 'none';
    root.dataset.scene = scene;
    render();
  }

  // Never hide her: when she would sit on the text column, she shrinks to 2px pixels instead.
  const column = document.querySelector('.reader-column');
  const guard = () => {
    root.classList.remove('compact');
    const textRight = column.getBoundingClientRect().right - parseFloat(getComputedStyle(column).paddingRight);
    root.classList.toggle('compact', root.getBoundingClientRect().left < textRight + 12);
  };
  new ResizeObserver(guard).observe(document.getElementById('reader-area'));

  setCat('mika');
  setBusy(false);
  // Awake when Petal opens too, so the first thing she sees is the big eyes.
  root.classList.add('awake');
  dozeTimer = setTimeout(() => root.classList.remove('awake'), AWAKE_AFTER_WORK_MS);
  return { setBusy, setCat, setScene };
})();

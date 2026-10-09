// Terminal contrast: Claude Code's whites and lavender, written straight into xterm, must read at 4.5:1 in every theme.
// Measured from the captured pixels, before (contrast floor off) and after (the shipped floor).
import type { BrowserWindow, NativeImage } from 'electron';
import type { Kit } from './snapshot';

const MIN_RATIO = 4.5;
const SAMPLE = 'MMMMMMMMMMMM';
const BLANK_COL = 30; // an empty cell on each row, for the real background

// What Claude Code sends: palette white (bold, bright, 256-colour) and its dark-theme truecolor text and lavender.
const SEQUENCES: [string, string][] = [
  ['bold 37', '\x1b[1;37m'],
  ['bold 97', '\x1b[1;97m'],
  ['rgb white', '\x1b[38;2;255;255;255m'],
  ['bold rgb white', '\x1b[1;38;2;255;255;255m'],
  ['bold 256-15', '\x1b[1m\x1b[38;5;15m'],
  ['rgb lavender', '\x1b[38;2;177;185;249m'],
];

type Rgb = [number, number, number];

const channel = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = ([r, g, b]: Rgb): number => 0.2126 * channel(r / 255) + 0.7152 * channel(g / 255) + 0.0722 * channel(b / 255);
const ratio = (a: Rgb, b: Rgb): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const hex = (c: Rgb): string => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

// Clears the active terminal, hides the cursor, writes one sample row per sequence; resolves once parsed and painted.
const WRITE = (floor: number): string => `new Promise((resolve) => {
  const term = PastelTerm.tabs.active().term;
  term.options.minimumContrastRatio = ${floor};
  const rows = ${JSON.stringify(SEQUENCES.map(([, seq]) => `${seq}${SAMPLE}\x1b[0m`))};
  term.write('\\x1b[?25l\\x1b[2J\\x1b[H' + rows.join('\\r\\n'), () => requestAnimationFrame(() => requestAnimationFrame(() => {
    const screen = PastelTerm.tabs.active().host.querySelector('.xterm-screen').getBoundingClientRect();
    resolve({ left: screen.left, top: screen.top, cellW: screen.width / term.cols, cellH: screen.height / term.rows });
  })));
})`;

interface Grid { left: number; top: number; cellW: number; cellH: number }

// Per row: the pixel farthest from the background is the glyph's solid ink; antialiased edges sit between.
function measure(image: NativeImage, scale: number, grid: Grid): { bg: Rgb; ink: Rgb; ratio: number }[] {
  const { width } = image.getSize();
  const bitmap = image.toBitmap(); // BGRA on macOS
  const at = (x: number, y: number): Rgb => {
    const i = (Math.round(y * scale) * width + Math.round(x * scale)) * 4;
    return [bitmap[i + 2], bitmap[i + 1], bitmap[i]];
  };
  return SEQUENCES.map((_, row) => {
    const top = grid.top + row * grid.cellH;
    const bg = at(grid.left + (BLANK_COL + 0.5) * grid.cellW, top + grid.cellH / 2);
    let ink = bg;
    for (let y = top + 1; y < top + grid.cellH - 1; y += 1 / scale) {
      for (let x = grid.left; x < grid.left + SAMPLE.length * grid.cellW; x += 1 / scale) {
        const pixel = at(x, y);
        if (ratio(pixel, bg) > ratio(ink, bg)) ink = pixel;
      }
    }
    return { bg, ink, ratio: ratio(ink, bg) };
  });
}

export async function termContrastCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, log, wait, capture, themes, applyTheme } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} term contrast ${what}`);
  await wait(2500); // login shell rc files, so the prompt lands before the samples
  const shipped = await js('PastelTerm.tabs.active().term.options.minimumContrastRatio');
  check(shipped === MIN_RATIO, `shipped minimumContrastRatio is ${shipped} (want ${MIN_RATIO}), renderer ${await js('PastelTerm.tabs.active().renderer')}`);

  for (const [id, theme] of Object.entries(themes)) {
    applyTheme(id, { persist: false });
    await wait(600);
    for (const [phase, floor] of [['before', 1], ['after', shipped as number]] as const) {
      const grid: Grid = await js(WRITE(floor));
      await wait(300);
      const image = await win.webContents.capturePage();
      const rows = measure(image, image.getSize().width / win.getContentSize()[0], grid);
      rows.forEach(({ bg, ink, ratio: measured }, i) => {
        const line = `${id} ${phase} ${SEQUENCES[i][0]}: ink ${hex(ink)} on ${hex(bg)} = ${measured.toFixed(2)}:1`;
        if (phase === 'before') log(`CONTRAST ${line}`);
        else check(measured >= MIN_RATIO, line);
      });
      if (!theme.dark) await capture(`term-contrast-${id}-${phase}`);
    }
  }
  await js(`PastelTerm.tabs.active().term.options.minimumContrastRatio = ${shipped}; PastelTerm.tabs.active().term.write('\\x1b[?25h')`);
  applyTheme('paleSky', { persist: false });
}

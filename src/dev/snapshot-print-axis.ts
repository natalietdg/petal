// Print look axis: at several window widths the text column and the reply box share the visible reader's centre line.
import type { BrowserWindow } from 'electron';
import type { Kit } from './snapshot';
import { resizeOffscreen } from '../main/snapshot-window';
import { printUpdate } from './snapshot-print';

const WIDTHS = [800, 990, 1280, 1600];
const TOLERANCE_PX = 2;

// Everything in CSS px relative to the window; the reader area excludes its scrollbar.
const MEASURE = `(() => {
  const reader = document.getElementById('reader');
  const box = reader.getBoundingClientRect();
  const scrollbar = reader.offsetWidth - reader.clientWidth;
  const bothEdges = getComputedStyle(reader).scrollbarGutter.includes('both-edges');
  const leftGutter = bothEdges ? scrollbar / 2 : 0; // both-edges splits the reserved width across the sides
  const area = { left: box.left + leftGutter, right: box.right - (scrollbar - leftGutter) };
  const column = document.querySelector('#reader .reader-column');
  const cs = getComputedStyle(column);
  const c = column.getBoundingClientRect();
  const text = { left: c.left + parseFloat(cs.paddingLeft), right: c.right - parseFloat(cs.paddingRight) };
  const rule = document.getElementById('reader-status').getBoundingClientRect();
  const input = document.getElementById('composer-input').getBoundingClientRect();
  const composer = document.getElementById('composer').getBoundingClientRect();
  const r = (n) => Math.round(n * 10) / 10;
  const centre = (b) => r((b.left + b.right) / 2);
  return {
    viewport: window.innerWidth,
    area: { left: r(area.left), right: r(area.right), centre: centre(area) },
    text: { left: r(text.left), right: r(text.right), centre: centre(text) },
    rule: { left: r(rule.left), right: r(rule.right), centre: centre(rule) },
    input: { left: r(input.left), right: r(input.right), centre: centre(input) },
    composer: { left: r(composer.left), right: r(composer.right), centre: centre(composer) },
    scrollbar,
    leftGutter,
  };
})()`;

export async function printAxisCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, wait, waitFor, log, capture } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} print axis: ${what}`);
  const [startWidth, startHeight] = win.getContentSize();

  await js("window.pastel.look.setReading('print')");
  await js(`PastelTerm.reader.update(${JSON.stringify(printUpdate)})`);
  const ready = await waitFor(async () => (await js('document.documentElement.dataset.reading')) === 'print' && js("Boolean(document.querySelector('#latest .rail'))"), 5000);
  check(ready, 'print look with the long reply');

  for (const width of WIDTHS) {
    resizeOffscreen(win, width, 900);
    await waitFor(async () => (await js('window.innerWidth')) === width, 3000);
    await wait(400);
    const m = await js(MEASURE);
    const offText = Math.abs(m.text.centre - m.area.centre);
    const offInput = Math.abs(m.input.centre - m.area.centre);
    check(offText <= TOLERANCE_PX && offInput <= TOLERANCE_PX, `${width}px column ${offText.toFixed(1)}px and reply box ${offInput.toFixed(1)}px off the reader centre: ${JSON.stringify(m)}`);
    await capture(`print-axis-${width}`);
  }

  resizeOffscreen(win, startWidth, startHeight);
  await js("window.pastel.look.setReading('newspaper')");
}

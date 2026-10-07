// Every reading look × theme × width: the reply box shares the text column's centre and width, and the dock never covers the text.
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { Kit } from './snapshot';
import { printUpdate } from './snapshot-print';
import { READING_CHOICES } from '../main/menu';

const WIDTHS = [800, 990, 1280, 1600];
const CENTRE_TOLERANCE_PX = 2;
const WIDTH_TOLERANCE_PX = 4;
const PRINT_MAX_CHARS_PER_LINE = 85;

// CSS px relative to the window. "text" is the column's content box; "reach" adds any margin rail beside it.
const MEASURE = `(() => {
  const r = (n) => Math.round(n * 10) / 10;
  const span = (b) => ({ left: r(b.left), right: r(b.right), centre: r((b.left + b.right) / 2), width: r(b.right - b.left) });
  const column = document.querySelector('#reader .reader-column');
  const cs = getComputedStyle(column);
  const c = column.getBoundingClientRect();
  const text = { left: c.left + parseFloat(cs.paddingLeft), right: c.right - parseFloat(cs.paddingRight) };
  const railRight = Math.max(text.right, ...[...column.querySelectorAll('.rail')].map((el) => el.getBoundingClientRect().right));
  const reader = document.getElementById('reader').getBoundingClientRect();
  const dock = document.getElementById('sessions-dock').getBoundingClientRect();
  // Where column text can ever be drawn: its horizontal reach, over the reader's whole scrollport.
  const textZone = { left: text.left, right: railRight, top: reader.top, bottom: reader.bottom };
  const overlapX = Math.max(0, Math.min(dock.right, textZone.right) - Math.max(dock.left, textZone.left));
  const overlapY = Math.max(0, Math.min(dock.bottom, textZone.bottom) - Math.max(dock.top, textZone.top));
  const input = document.getElementById('composer-input').getBoundingClientRect();
  const send = document.getElementById('composer-send').getBoundingClientRect();
  // Characters a full line holds: the measure over the longest paragraph's average glyph width.
  const para = [...document.querySelectorAll('#latest p')].sort((a, b) => b.textContent.length - a.textContent.length)[0];
  const ps = getComputedStyle(para);
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = ps.fontWeight + ' ' + ps.fontSize + ' ' + ps.fontFamily;
  const glyph = ctx.measureText(para.textContent).width / para.textContent.length;
  const typingRight = input.right - parseFloat(getComputedStyle(document.getElementById('composer-input')).paddingRight);
  return {
    viewport: window.innerWidth,
    text: span(text),
    reachRight: r(railRight),
    input: span(input),
    send: span(send),
    typingRight: r(typingRight),
    bodyFontSize: ps.fontSize,
    charsPerLine: r((text.right - text.left) / glyph),
    dock: { left: r(dock.left), right: r(dock.right), top: r(dock.top), bottom: r(dock.bottom) },
    readerTop: r(reader.top),
    dockOverlap: { x: r(overlapX), y: r(overlapY) },
  };
})()`;

export async function columnAxisCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, wait, waitFor, log, capture, themes, applyTheme, outDir } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} column axis: ${what}`);
  const [startWidth, startHeight] = win.getContentSize();
  const rows: unknown[] = [];

  // The fixture feed can redraw its own reply; re-send the long sample (it has margin rails) before each reading.
  const showSample = async () => {
    await js(`PastelTerm.reader.update(${JSON.stringify(printUpdate)})`);
    return waitFor(() => js("Boolean(document.querySelector('#latest .rail'))"), 5000);
  };
  check(await showSample(), 'long reply with sidebars and pull quotes');

  for (const [look] of READING_CHOICES) {
    await js(`window.pastel.look.setReading(${JSON.stringify(look)})`);
    await waitFor(async () => (await js('document.documentElement.dataset.reading')) === look, 3000);
    for (const theme of Object.keys(themes)) {
      applyTheme(theme, { persist: false });
      for (const width of WIDTHS) {
        // A resize can be dropped while the window is busy: ask again until the page really is this wide.
        let sized = false;
        for (let attempt = 0; attempt < 4 && !sized; attempt++) {
          win.setContentSize(width, 900);
          sized = Boolean(await waitFor(async () => {
            win.webContents.invalidate(); // an unfocused window can hold its old frame and size
            return (await js('window.innerWidth')) === width;
          }, 3000));
        }
        check(sized, `${look} ${theme} window resized to ${width}px (content ${win.getContentSize()}, page ${await js('window.innerWidth')})`);
        await wait(350);
        if (!(await js("Boolean(document.querySelector('#latest .rail'))"))) await showSample();
        const m = await js(MEASURE);
        rows.push({ look, theme, width, ...m });
        const centreOff = Math.abs(m.text.centre - m.input.centre);
        const widthOff = Math.abs(m.text.width - m.input.width);
        const overlap = m.dockOverlap.x * m.dockOverlap.y;
        const sendInside = m.send.left >= m.typingRight && m.send.right <= m.input.right;
        const tag = `${look} ${theme} ${width}px`;
        check(centreOff <= CENTRE_TOLERANCE_PX, `${tag} centre text ${m.text.centre} box ${m.input.centre} (off ${centreOff.toFixed(1)})`);
        check(widthOff <= WIDTH_TOLERANCE_PX, `${tag} width text ${m.text.width} box ${m.input.width} (off ${widthOff.toFixed(1)})`);
        check(overlap === 0, `${tag} dock over column text ${m.dockOverlap.x}x${m.dockOverlap.y}px`);
        check(sendInside, `${tag} Send ${m.send.left}-${m.send.right} inside the box's corner (typing ends ${m.typingRight}, box ${m.input.right})`);
        if (look === 'print') check(m.charsPerLine <= PRINT_MAX_CHARS_PER_LINE, `${tag} print measure ${m.text.width}px at ${m.bodyFontSize} holds ${m.charsPerLine} characters a line`);
        if (width === 1280) await capture(`axis-${look}-${theme}-1280`);
      }
    }
  }

  fs.writeFileSync(path.join(outDir, 'column-axis.json'), JSON.stringify(rows, null, 2));
  win.setContentSize(startWidth, startHeight);
  applyTheme('paleSky', { persist: false });
  await js("window.pastel.look.setReading('newspaper')");
}

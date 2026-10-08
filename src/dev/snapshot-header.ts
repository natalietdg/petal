// Fixed header: after scrolling the reader 1500px, the dock and the view toggle sit at the same y and still take clicks, in every look.
// Nothing starts under it either: the reader and History begin below the header at every look and width.
import type { BrowserWindow } from 'electron';
import type { Kit } from './snapshot';
import { resizeOffscreen } from '../main/snapshot-window';
import { printUpdate } from './snapshot-print';
import { READING_CHOICES } from '../main/menu';

const SCROLL_PX = 1500;

// y of each header button, and whether elementFromPoint at its centre lands on it.
const PROBE = `(() => {
  const buttons = [...document.querySelectorAll('#sessions-dock > button:not([hidden]), #reader-head .view-toggle button, #notes-toggle')];
  return buttons.map((b) => {
    const r = b.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { label: b.textContent.trim().slice(0, 24), top: Math.round(r.top), visible: r.height > 0 && r.bottom > 0, hit: hit === b || b.contains(hit) };
  });
})()`;

const WIDTHS = [800, 990, 1280, 1600];

// Header bottom vs where the column's content starts: the scrollport, and the first element's top when scrolled to 0
// (its top now plus the scroll, so a pane that scrolls itself to the newest turn still measures).
const OVERLAP = `(() => {
  const bottom = (el) => el && !el.hidden ? Math.round(el.getBoundingClientRect().bottom) : 0;
  const header = Math.max(bottom(document.getElementById('sessions-dock')), bottom(document.getElementById('reader-head')));
  const scrolledBy = (el) => { let y = 0; for (let p = el?.parentElement; p; p = p.parentElement) y += p.scrollTop; return y; };
  const top = (el) => el ? Math.round(el.getBoundingClientRect().top + scrolledBy(el)) : null;
  const firstShown = (root) => root ? [...root.querySelectorAll('*')].find((el) => el.getBoundingClientRect().height > 0) : null;
  const reader = document.getElementById('reader');
  const history = document.getElementById('history');
  if (!history.hidden) {
    const preview = document.getElementById('history-preview');
    const list = document.querySelector('.history-list-pane');
    return { header, scrollport: Math.min(top(preview), top(list)), first: Math.min(top(firstShown(preview)), top(firstShown(list))) };
  }
  return { header, scrollport: top(reader), first: top(firstShown(reader.querySelector('.reader-column'))) };
})()`;

// Fits the window to a width, retrying a dropped resize.
async function sizeTo(kit: Kit, win: BrowserWindow, width: number): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt++) {
    win.setContentSize(width, 900);
    const sized = await kit.waitFor(async () => {
      win.webContents.invalidate();
      return (await kit.js('window.innerWidth')) === width;
    }, 3000);
    if (sized) return true;
  }
  return false;
}

// Every look and width: the reader and History both start below the fixed header, at the top and scrolled to the end.
async function overlapCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, wait, waitFor, log, capture } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} no header overlap: ${what}`);
  // any: the probe's shape is built in the script above.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clear = (m: any) => m.scrollport >= m.header && m.first !== null && m.first >= m.header;
  for (const [look] of READING_CHOICES) {
    await js(`window.pastel.look.setReading(${JSON.stringify(look)})`);
    await waitFor(async () => (await js('document.documentElement.dataset.reading')) === look, 3000);
    for (const width of WIDTHS) {
      check(await sizeTo(kit, win, width), `${look} window at ${width}px`);
      await js(`PastelTerm.reader.update(${JSON.stringify(printUpdate)})`);
      await wait(300);
      await js("document.getElementById('reader').scrollTop = 0");
      const reader = await js(OVERLAP);
      check(clear(reader), `${look} ${width}px reader starts below the header: ${JSON.stringify(reader)}`);
      await js('PastelTerm.history.open()');
      await waitFor(() => js("Boolean(document.querySelector('#history-preview .history-preview-head'))"), 8000);
      await js("document.getElementById('history-preview').scrollTop = 0");
      await wait(200);
      const top = await js(OVERLAP);
      await js("(() => { const p = document.getElementById('history-preview'); p.scrollTop = p.scrollHeight; })()");
      await wait(200);
      const end = await js(OVERLAP);
      check(clear(top) && end.scrollport >= end.header, `${look} ${width}px History starts below the header, at the top ${JSON.stringify(top)} and scrolled ${JSON.stringify(end)}`);
      if (width === 800) await capture(`header-history-${look}-800`);
      await js('PastelTerm.history.close()');
    }
  }
}

export async function headerCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, wait, waitFor, log, capture, applyTheme } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} fixed header: ${what}`);
  const [startWidth, startHeight] = win.getContentSize();
  resizeOffscreen(win, 1280, 900);
  await waitFor(async () => (await js('window.innerWidth')) === 1280, 3000);
  applyTheme('paleSky', { persist: false });
  await js("PastelTerm.reader.setView('replies')");
  await js(`PastelTerm.reader.update(${JSON.stringify(printUpdate)})`);

  for (const [look] of READING_CHOICES) {
    await js(`window.pastel.look.setReading(${JSON.stringify(look)})`);
    await waitFor(async () => (await js('document.documentElement.dataset.reading')) === look, 3000);
    await wait(300);
    await js("document.getElementById('reader').scrollTop = 0");
    await wait(100);
    const top = await js(PROBE);
    await js(`document.getElementById('reader').scrollTop = ${SCROLL_PX}`);
    await wait(200);
    const scrolled = await js(`document.getElementById('reader').scrollTop`);
    const after = await js(PROBE);
    // any: the probe's shape is built in the script above.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const same = after.length === top.length && after.length >= 8 && after.every((b: any, i: number) => b.visible && b.hit && b.top === top[i].top);
    check(scrolled >= SCROLL_PX && same, `${look}: scrolled ${scrolled}px, ${after.length} header buttons visible, same y, clickable: ${JSON.stringify(after)}`);
    await capture(`header-scrolled-${look}-1280`);
  }

  await overlapCheck(kit, win);
  await js("document.getElementById('reader').scrollTop = 0");
  await js("window.pastel.look.setReading('newspaper')");
  resizeOffscreen(win, startWidth, startHeight);
}

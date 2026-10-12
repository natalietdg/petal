// Every reading look × light/dark × width: tables stay inside their section or sidebar, keep balanced columns, and read as one box.
import fs from 'node:fs';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { Kit } from './snapshot';
import { OPEN_SECTIONS } from './snapshot-reader-collapse';
import { READING_CHOICES } from '../main/menu';
import { resizeOffscreen } from '../main/snapshot-window';

const WIDTHS = [990, 1280];
const THEMES = ['paleSky', 'nightPastel']; // one light, one dark
const EDGE_TOLERANCE_PX = 0.5;
const MAX_COLUMN_SHARE = 0.55;
const MAX_WRAP_LINES = 2;
const CAPTION_MAX_GAP_PX = 40;

const TABLE_REPLY = [
  '**Fee labels against the new rule.**',
  '',
  'Three places still disagree with the rule, and one of them is the Hong Kong statement.',
  '',
  '## Where the code stands',
  '',
  '| New rule | Merged code | Gap |',
  '|---|---|---|',
  '| Fee label must read "Service Fee" in English and "Yuran Perkhidmatan" in Malay on every receipt line | Prints "Service Fee" / "Yuran Perkhidmatan" | None |',
  '| HK 費用 label shows the Hong Kong fee in Traditional Chinese on the statement screen | Not yet translated; falls back to English | Missing zh-HK string |',
  '| Links to https://example.com/a/very/long/path/that/keeps/going/forever/and/ever?with=query&params=1 | `src/renderer/some/deeply/nested/module/file-name.ts` | Docs |',
  '',
  '*Table 1. Fee labels by rule.*',
  '',
  '## By country',
  '',
  '| Country | Currency | Fee | Label (EN) | Label (local) | Status |',
  '|---|---|---|---|---|---|',
  '| Malaysia | MYR | RM 2.00 | Service Fee | Yuran Perkhidmatan | Shipped |',
  '| Hong Kong | HKD | HK$ 5.00 | Service Fee | HK 費用 服務費 | In review, waiting on translation sign-off |',
  '| Vietnam | VND | 10,000 ₫ | Service Fee | Phí dịch vụ | Shipped |',
  '',
  '*Table 2. Fee and label per country.*',
  '',
  'The sidebar below carries its own small table.',
  '',
  '> **At a glance**',
  '>',
  '> | Look | Gap |',
  '> |---|---|',
  '> | Receipt | None |',
  '> | HK 費用 statement | Missing zh-HK string |',
  '',
  'That is the whole list.',
].join('\n');

const tableUpdate = {
  state: 'live',
  replies: [{ id: 'tables-new', timestamp: '2026-10-08T09:30:00.000Z', prompt: 'how do the fee labels compare?', markdown: TABLE_REPLY }],
};

// CSS px. Container is the table's sidebar or section content box; lines count each cell's wrapped text.
const MEASURE = `(() => {
  const r = (n) => Math.round(n * 10) / 10;
  const contentBox = (el) => {
    const cs = getComputedStyle(el); const b = el.getBoundingClientRect();
    return { left: b.left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth), right: b.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth) };
  };
  // The colour actually painted behind an element: its own, or the nearest ancestor's.
  const paint = (el) => { for (let n = el; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c; } return 'none'; };
  const lineCount = (cell) => {
    const range = document.createRange(); range.selectNodeContents(cell);
    const tops = new Set([...range.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round(q.bottom)));
    return tops.size;
  };
  return [...document.querySelectorAll('#latest table')].map((t, index) => {
    const holder = t.closest('blockquote.sidebar') || t.closest('.story-section');
    const box = contentBox(holder);
    const tb = t.getBoundingClientRect();
    const head = t.querySelector('th'); const firstBody = t.querySelector('tbody td'); const otherBody = t.querySelector('tbody td:nth-child(2)');
    const columns = [...t.querySelectorAll('thead th')].map((th, i) => ({
      share: r(th.getBoundingClientRect().width / tb.width),
      maxLines: Math.max(...[...t.querySelectorAll('tbody tr')].map((row) => lineCount(row.cells[i]))),
    }));
    const caption = t.nextElementSibling;
    const isCaption = caption && caption.matches('p') && caption.children.length === 1 && caption.firstElementChild.tagName === 'EM';
    return {
      index,
      inSidebar: Boolean(t.closest('blockquote.sidebar')),
      tableLeft: r(tb.left), tableRight: r(tb.right), boxLeft: r(box.left), boxRight: r(box.right),
      columns,
      headPaint: paint(head), bodyPaint: paint(firstBody),
      bodyWeight: getComputedStyle(otherBody).fontWeight,
      firstWeight: getComputedStyle(firstBody).fontWeight,
      captionGap: isCaption ? r(caption.getBoundingClientRect().top - tb.bottom) : null,
    };
  });
})()`;

const scrollToTable = (js: Kit['js']): Promise<number> => js(`(() => {
  const reader = document.getElementById('reader');
  const el = document.querySelector('#latest table');
  reader.scrollTop = el.getBoundingClientRect().top - reader.getBoundingClientRect().top + reader.scrollTop - 120;
  return Math.round(reader.scrollTop);
})()`);

export async function resizeTo(kit: Kit, win: BrowserWindow, width: number): Promise<boolean> {
  const { js, waitFor } = kit;
  // A resize can be dropped while the window is busy: ask again until the page really is this wide.
  for (let attempt = 0; attempt < 4; attempt++) {
    resizeOffscreen(win, width, 900);
    const sized = await waitFor(async () => {
      win.webContents.invalidate();
      return (await js('window.innerWidth')) === width;
    }, 3000);
    if (sized) return true;
  }
  return false;
}

export async function tablesCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, wait, waitFor, log, capture, applyTheme, outDir } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} tables: ${what}`);
  const [startWidth, startHeight] = win.getContentSize();
  const rows: unknown[] = [];

  // The fixture feed can redraw its own reply; re-send the sample whenever it is gone.
  const showSample = async () => {
    if (await js("document.getElementById('latest').dataset.replyId === 'tables-new'")) return true;
    await js(`PastelTerm.reader.update(${JSON.stringify(tableUpdate)}); ${OPEN_SECTIONS}`);
    return waitFor(() => js("document.querySelectorAll('#latest table').length === 3"), 5000);
  };
  check(await showSample(), 'sample reply with a 3-column, a 6-column and a sidebar table');
  check(await js("Boolean(document.querySelector('#latest blockquote.sidebar table'))"), 'markdown puts the sidebar table inside the sidebar');

  for (const [look] of READING_CHOICES) {
    await js(`window.pastel.look.setReading(${JSON.stringify(look)})`);
    await waitFor(async () => (await js('document.documentElement.dataset.reading')) === look, 3000);
    for (const theme of THEMES) {
      applyTheme(theme, { persist: false });
      for (const width of WIDTHS) {
        const tag = `${look} ${theme} ${width}px`;
        check(await resizeTo(kit, win, width), `${tag} window resized`);
        await showSample();
        await wait(350);
        const tables = await js(MEASURE);
        rows.push({ look, theme, width, tables });
        for (const t of tables) {
          const name = `${tag} table ${t.index + 1}${t.inSidebar ? ' (sidebar)' : ''}`;
          check(t.tableRight <= t.boxRight + EDGE_TOLERANCE_PX && t.tableLeft >= t.boxLeft - EDGE_TOLERANCE_PX,
            `${name} inside its container: table ${t.tableLeft}-${t.tableRight}, box ${t.boxLeft}-${t.boxRight}`);
          const wrapsLong = (i: number) => t.columns.some((c: { maxLines: number }, j: number) => j !== i && c.maxLines > MAX_WRAP_LINES);
          const hog = t.columns.findIndex((c: { share: number }, i: number) => c.share > MAX_COLUMN_SHARE && wrapsLong(i));
          check(hog === -1, `${name} balanced columns: ${JSON.stringify(t.columns)}`);
          check(t.headPaint === t.bodyPaint, `${name} header and body share one background: ${t.headPaint} / ${t.bodyPaint}`);
          check(Number(t.bodyWeight) <= 500, `${name} body weight ${t.bodyWeight} (first column ${t.firstWeight})`);
          if (!t.inSidebar) check(t.captionGap !== null && t.captionGap >= 0 && t.captionGap <= CAPTION_MAX_GAP_PX, `${name} caption attached, gap ${t.captionGap}px`);
        }
        if (width === 1280) {
          await scrollToTable(js);
          win.webContents.invalidate();
          await capture(`tables-${look}-${theme}-1280`);
        }
      }
    }
  }

  fs.writeFileSync(path.join(outDir, 'tables.json'), JSON.stringify(rows, null, 2));
  resizeOffscreen(win, startWidth, startHeight);
  applyTheme('paleSky', { persist: false });
  await js("window.pastel.look.setReading('newspaper')");
}

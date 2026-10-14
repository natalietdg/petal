// Status strip: the newest reply's Doing / Recommend / Next sit in the fixed header, update live, and never cover the column.
// Also: the reply body shows them as one 3-row block in every look × theme, and History's preview carries the same strip.
import fs from 'node:fs';
import type { BrowserWindow } from 'electron';
import { resizeOffscreen } from '../main/snapshot-window';
import type { Kit } from './snapshot';
import { OVERLAP } from './snapshot-header';
import { addStatusFixture, FIXTURE_PLAIN, FIXTURE_STATUS } from './snapshot-history-fixture';
import { READING_CHOICES } from '../main/menu';

const DOING = 'tracing where withdrawal cycles are stored across five repos.';
const RECOMMEND = "store cycles in Work's table rather than rebuilding them.";
const NEXT = 'I draft the two API contracts once the trace reports.';
const STATUS_REPLY = [
  '**Withdrawal cycles already live in Work.**',
  '',
  'Five repos read cycles, and only Work writes them, so the new flow can borrow its table.',
  '**Doing:** ' + DOING,
  '**Recommend:** ' + RECOMMEND,
  '**Next:** ' + NEXT,
  '',
  'The trace covers queues and crons too. Each repo reports back with the file and line that reads the table.',
  '',
  '```',
  'Doing: this line sits in a fence and is never parsed',
  '```',
].join('\n');
const WIDTHS = [800, 1280];

// Strip contents and geometry: inside the header, above the reader, with the view toggle still on top.
const STRIP = (root: string) => `(() => {
  const strip = document.querySelector(${JSON.stringify(`${root} .status-strip`)});
  if (!strip) return null;
  const box = (el) => el.getBoundingClientRect();
  const s = box(strip);
  const head = box(strip.closest('#reader-head, .history-preview-head'));
  const reader = document.getElementById('reader');
  return {
    hidden: strip.hidden || s.height === 0,
    chips: [...strip.querySelectorAll('.status-chip')].map((c) => c.textContent),
    texts: [...strip.querySelectorAll('.status-text')].map((t) => t.textContent),
    insideHead: s.top >= head.top - 0.5 && s.bottom <= head.bottom + 0.5 && s.left >= head.left - 0.5 && s.right <= head.right + 0.5,
    aboveReader: reader.hidden || s.bottom <= box(reader).top + 0.5,
    toggleClickable: [...document.querySelectorAll('#reader-head .view-toggle button')].every((b) => {
      const r = box(b);
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return reader.hidden || hit === b || b.contains(hit);
    }),
  };
})()`;

const BLOCK = `(() => {
  const block = document.querySelector('#latest .status-block');
  if (!block) return null;
  const rows = [...block.querySelectorAll('.status-row')].map((row) => {
    const chip = row.querySelector('.status-chip');
    const cs = getComputedStyle(chip);
    return { chip: chip.textContent, text: row.querySelector('.status-text').textContent, width: Math.round(chip.getBoundingClientRect().width), ink: cs.color, fill: cs.backgroundColor };
  });
  return { rows, display: getComputedStyle(block).display, boldParagraphs: [...document.querySelectorAll('#latest p > strong:first-child')].filter((s) => /^(doing|recommend|next)/i.test(s.textContent)).length };
})()`;

export async function statusStripCheck(kit: Kit, win: BrowserWindow, file: string): Promise<void> {
  const { js, wait, waitFor, log, capture, themes, applyTheme, outDir } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} status strip: ${what}`);
  const [startWidth, startHeight] = win.getContentSize();
  const same = (got: unknown, want: unknown) => JSON.stringify(got) === JSON.stringify(want);
  const line = (fields: Record<string, unknown>) => `${JSON.stringify({ isSidechain: false, timestamp: new Date().toISOString(), ...fields })}\n`;
  const append = (id: string, text: string) => fs.appendFileSync(file, line({ type: 'user', uuid: `strip-u-${id}`, message: { role: 'user', content: `strip prompt ${id}` } })
    + line({ type: 'assistant', uuid: `strip-a-${id}`, message: { role: 'assistant', content: [{ type: 'text', text }] } }));
  const stripShows = (root: string, texts: string[]) => waitFor(async () => { const s = await js(STRIP(root)); return s && !s.hidden && same(s.texts, texts) ? s : null; }, 6000);

  await js("PastelTerm.tabs.activate(PastelTerm.tabs.ids()[0]); PastelTerm.reader.setView('replies')");
  resizeOffscreen(win, 1280, 900);
  await waitFor(async () => (await js('window.innerWidth')) === 1280, 3000);

  // Live: each appended reply updates the strip; the newest reply with any line wins.
  append('one', STATUS_REPLY);
  check(await stripShows('#reader-head', [DOING, RECOMMEND, NEXT]), 'a streamed reply with all three lines fills the strip');
  append('two', 'Short one.\n\ndoing: second pass, plain label\nnext: reread the trace');
  const two = await stripShows('#reader-head', ['second pass, plain label', 'reread the trace']);
  check(two && same(two.chips, ['Doing', 'Next']), `a newer reply replaces it, missing items left out: ${JSON.stringify(two)}`);
  append('three', 'A reply with no status lines.');
  await waitFor(async () => (await js("document.getElementById('latest').textContent")).includes('A reply with no status lines.'), 6000);
  check(await stripShows('#reader-head', ['second pass, plain label', 'reread the trace']), 'a newer reply without lines keeps the newest that has them');
  // Factory: a Station line after Next pins as a 7-segment bar and joins the reply's status block.
  append('station', `${STATUS_REPLY.split('\n').slice(0, 6).join('\n')}\n**Station:** 3/7 Build · not yet`);
  const station = await waitFor(async () => js(`(() => {
    const bar = document.querySelector('#reader-head .status-strip .status-station [role="progressbar"]');
    if (!bar) return null;
    return { now: bar.getAttribute('aria-valuenow'), max: bar.getAttribute('aria-valuemax'), caption: bar.querySelector('.station-caption')?.textContent,
      segs: bar.querySelectorAll('.station-seg').length, done: bar.querySelectorAll('.station-seg.done').length, pending: bar.querySelectorAll('.station-seg.current.pending').length,
      inBody: !!document.querySelector('#latest .status-block .status-station'), bodyText: /Station:/.test(document.getElementById('latest').textContent) };
  })()`), 6000);
  check(station && station.now === '3' && station.max === '7' && station.caption === 'Build · 3/7' && station.segs === 7 && station.done === 2 && station.pending === 1 && station.inBody && !station.bodyText,
    `a Station line pins a 7-segment bar and leaves no raw text: ${JSON.stringify(station)}`);
  append('four', STATUS_REPLY);
  check(await stripShows('#reader-head', [DOING, RECOMMEND, NEXT]), 'back to the three lines for the look pass');

  for (const [look] of READING_CHOICES) {
    await js(`window.pastel.look.setReading(${JSON.stringify(look)})`);
    await waitFor(async () => (await js('document.documentElement.dataset.reading')) === look, 3000);
    for (const width of WIDTHS) {
      resizeOffscreen(win, width, 900);
      await waitFor(async () => { win.webContents.invalidate(); return (await js('window.innerWidth')) === width; }, 3000);
      await wait(300);
      await js("document.getElementById('reader').scrollTop = 0");
      const strip = await stripShows('#reader-head', [DOING, RECOMMEND, NEXT]);
      const m = await js(OVERLAP);
      const clear = m.scrollport >= m.header && m.first !== null && m.first >= m.header;
      check(strip && strip.insideHead && strip.aboveReader && strip.toggleClickable && clear,
        `${look} ${width}px strip in the header, column starts below it: ${JSON.stringify({ strip, overlap: m })}`);
    }
    for (const theme of Object.keys(themes)) {
      applyTheme(theme, { persist: false });
      await wait(300);
      const block = await js(BLOCK);
      const rows = block?.rows ?? [];
      const ok = rows.length === 3 && same(rows.map((r: { chip: string }) => r.chip), ['Doing', 'Recommend', 'Next'])
        && rows.every((r: { width: number }) => r.width > 0) && block.display === 'grid' && block.boldParagraphs === 0;
      check(ok, `${look} ${theme} reply shows one 3-row block: ${JSON.stringify(block)}`);
      await js("document.querySelector('#latest .status-block')?.scrollIntoView({ block: 'center' })");
      await capture(`status-strip-${look}-${theme}`);
    }
    applyTheme('paleSky', { persist: false });
  }

  // History: the selected session's newest reply drives a strip atop the preview.
  const removeFixture = addStatusFixture(outDir, STATUS_REPLY);
  const select = (id: string) => js(`PastelTerm.history.open().then(() => { PastelTerm.history.select(${JSON.stringify(id)}); return PastelTerm.history.setPreviewMode('replies'); })`);
  try {
    for (const [look] of READING_CHOICES) {
      await js(`window.pastel.look.setReading(${JSON.stringify(look)})`);
      await waitFor(async () => (await js('document.documentElement.dataset.reading')) === look, 3000);
      await select(FIXTURE_STATUS);
      const strip = await stripShows('#history-preview', [DOING, RECOMMEND, NEXT]);
      await js("document.getElementById('history-preview').scrollTop = 0");
      await wait(200);
      const m = await js(OVERLAP);
      const rows = await js("document.querySelectorAll('#history-preview .history-reply .status-block .status-row').length");
      check(strip && strip.insideHead && m.first >= m.header && rows === 3, `${look} History preview shows the strip and the 3-row block: ${JSON.stringify({ strip, rows, overlap: m })}`);
      await wait(600); // the preview scrolls itself to the newest turn; take it back to the strip
      await js("document.getElementById('history-preview').scrollTop = 0");
      await capture(`status-strip-history-${look}`);
      await js('PastelTerm.history.close()');
    }
    await select(FIXTURE_PLAIN);
    const plain = await waitFor(async () => { const s = await js(STRIP('#history-preview')); return s && s.hidden ? s : null; }, 6000);
    check(plain, `a History session without the lines shows no strip: ${JSON.stringify(plain)}`);
    await js('PastelTerm.history.close()');
  } finally {
    removeFixture();
  }

  // A conversation where no reply has the lines: no strip in the reader.
  const noLines = { state: 'live', replies: [{ id: 'strip-none', timestamp: new Date().toISOString(), prompt: 'hi', markdown: 'Hello, no status here.' }] };
  const none = await js(`(() => { PastelTerm.reader.update(${JSON.stringify(noLines)}); return ${STRIP('#reader-head')}; })()`); // same tick: the fixture feed can redraw
  check(none?.hidden, `a reply without the lines shows no strip: ${JSON.stringify(none)}`);
  await capture('status-strip-none');

  await js("window.pastel.look.setReading('newspaper')");
  resizeOffscreen(win, startWidth, startHeight);
}

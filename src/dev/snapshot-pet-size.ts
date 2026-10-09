// Pet size (PASTEL_SNAPSHOT_MODE=pet-size): she stays the size picked in Customize and in one place at every scroll position:
// beside the text at 1280, docked in the header bar at 800, never over text, and the reader keeps its full height.
import fs from 'node:fs';
import { app, type BrowserWindow } from 'electron';
import type { Kit } from './snapshot';
import { load as loadConfig } from '../main/config-store';
import { fixtureFile } from '../main/snapshot-mode';
import { resizeOffscreen } from '../main/snapshot-window';
import { READING_CHOICES } from '../main/menu';
import { assertFixtureOutsideClaude } from './snapshot-views';

const MARKER = 'Pet size fixture';
const WIDE_ROW = '| employer_payroll_cycles_with_a_very_long_name | payroll_cycle_destination_table_name_for_vietnam | cosmos://paywatch-my/containers/cycles_VN_with_suffix | yes | 12,480 | platform-data-engineering | reads in pages of 500 rows |';
const PARAGRAPH = 'The backfill checks each row before it writes, so a second run finds the rows already there and moves on. That is what makes it safe to stop halfway and start again later without cleaning anything up first, even after a long pause.';
const REPLY = [
  `**${MARKER}: the wide table sits at the top.**`, '',
  'A long reply whose first block is a table wider than the column, then plenty of plain text below it.', '',
  '| Source | Destination | Container | Idempotent | Rows | Owner | Notes |', '|---|---|---|---|---|---|---|', WIDE_ROW, WIDE_ROW, '',
  ...[1, 2, 3, 4, 5, 6].flatMap((n) => [`## ${n}. Section`, '', PARAGRAPH, '', PARAGRAPH, '']),
  'Done.',
].join('\n');

function appendReply(file: string): void {
  assertFixtureOutsideClaude(file);
  const at = new Date().toISOString();
  const lines = [
    { type: 'user', uuid: 'pet-size-u', timestamp: at, isSidechain: false, message: { role: 'user', content: 'show me a wide table' } },
    { type: 'assistant', uuid: 'pet-size-a', timestamp: at, isSidechain: false, message: { role: 'assistant', content: [{ type: 'text', text: REPLY }] } },
  ];
  fs.appendFileSync(file, lines.map((line) => JSON.stringify(line)).join('\n') + '\n'); // the tail reads on from its offset
}

// Her box, where she sits, the reader's bottom edge, and every visible text block or header control under her.
const MEASURE = `(() => {
  const R = (b) => ({ left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), bottom: Math.round(b.bottom), width: Math.round(b.width), height: Math.round(b.height) });
  const meets = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const cat = document.getElementById('cat');
  const reader = document.getElementById('reader');
  const area = document.getElementById('reader-area');
  const shown = getComputedStyle(cat).display !== 'none';
  const box = cat.getBoundingClientRect();
  const view = reader.getBoundingClientRect();
  const hits = [];
  for (const block of document.querySelectorAll('#latest :is(p, h1, h2, h3, h4, li, td, th, pre, blockquote)')) {
    const r = block.getBoundingClientRect();
    const c = { left: Math.max(r.left, view.left), right: Math.min(r.right, view.right), top: Math.max(r.top, view.top), bottom: Math.min(r.bottom, view.bottom) };
    if (shown && c.right > c.left && c.bottom > c.top && meets(c, box)) hits.push(block.tagName + ':' + block.textContent.trim().slice(0, 24));
  }
  for (const control of document.querySelectorAll('#reader-head :is(button, .reader-repo)')) {
    if (control.getClientRects().length && meets(control.getBoundingClientRect(), box)) hits.push('header:' + control.textContent.trim().slice(0, 24));
  }
  const column = document.querySelector('#reader .reader-column');
  const textRight = column.getBoundingClientRect().right - parseFloat(getComputedStyle(column).paddingRight);
  const bar = document.querySelector('#reader-head .reader-head-end').getBoundingClientRect();
  const key = document.getElementById('colour-key-button').getBoundingClientRect();
  const toggle = document.querySelector('#reader-head .view-toggle').getBoundingClientRect();
  const below = Math.min(...['prompt-dock', 'composer'].map((id) => document.getElementById(id).getBoundingClientRect().top));
  return {
    cat: R(box), shown, scale: getComputedStyle(cat).getPropertyValue('--pet-scale').trim(), docked: area.classList.contains('cat-docked'),
    textRight: Math.round(textRight), viewBottom: Math.round(view.bottom), bar: R(bar), key: R(key), toggle: R(toggle),
    margin: parseFloat(getComputedStyle(reader).marginBottom) || 0, gapBelow: Math.round(below - view.bottom),
    hits: [...new Set(hits)].slice(0, 4), scrollTop: Math.round(reader.scrollTop), scrollMax: reader.scrollHeight - reader.clientHeight,
  };
})()`;

// any: MEASURE's shape is built in the script above.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Measure = any;

// Her corner beside the text, or her slot in the header bar left of Colour key.
const inGutter = (m: Measure, want: number): boolean => !m.docked && Math.abs(m.cat.width - want) <= 1 && Math.abs(m.cat.height - want) <= 1
  && m.cat.left > m.textRight && m.cat.bottom <= m.viewBottom;
const inBar = (m: Measure): boolean => m.docked && Math.abs(m.cat.height - m.bar.height) <= 1 && m.cat.top >= m.bar.top - 1 && m.cat.bottom <= m.bar.bottom + 1
  && m.cat.right <= m.key.left && m.cat.left >= m.toggle.right;

// Lifestyle's 960px measure leaves a 1280 gutter only Small fits; larger, she docks there too.
const gutterAt1280 = (look: string, size: string): boolean => look !== 'lifestyle' || size === 'small';

export async function petSizeCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, log, wait, waitFor, capture } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} pet size: ${what}`);
  const measure = (): Promise<Measure> => js(MEASURE);
  const scrollTo = async (where: 'top' | 'bottom' | number) => {
    await js(`(() => { const r = document.getElementById('reader'); r.scrollTop = ${JSON.stringify(where)} === 'top' ? 0 : ${JSON.stringify(where)} === 'bottom' ? r.scrollHeight : ${Number(where) || 0}; })()`);
    await wait(250);
  };
  const sizeTo = async (width: number) => {
    resizeOffscreen(win, width, 900);
    return waitFor(async () => { win.webContents.invalidate(); return (await js('window.innerWidth')) === width; }, 3000);
  };

  const file = fixtureFile();
  if (!file) return log('FAIL pet size: needs PASTEL_SNAPSHOT_FAKE_JSONL');
  await wait(2500); // login shell rc files
  appendReply(file);
  check(await waitFor(() => js(`document.getElementById('latest').innerText.includes(${JSON.stringify(MARKER)})`), 10000), 'fixture reply shown');
  await js('PastelTerm.welcome.close()');
  await js("PastelTerm.reader.setView('replies')");
  await js("PastelTerm.cat.setScene('cherry')");

  // Top, middle and bottom: one place at all three, the expected one, and nothing under her; no band below the reader.
  const steady = async (tag: string, want: number, gutter: boolean) => {
    const at: Measure[] = [];
    for (const where of ['top', 'middle', 'bottom'] as const) {
      await scrollTo('top');
      if (where !== 'top') await scrollTo(where === 'bottom' ? 'bottom' : Math.round((await measure()).scrollMax / 2));
      const m: Measure = await measure();
      at.push(m);
      check(m.shown && (gutter ? inGutter(m, want) : inBar(m)) && m.hits.length === 0,
        `${tag} at the ${where} (${m.scrollTop}/${m.scrollMax}): ${gutter ? `gutter, want ${want}` : `bar ${m.bar.height}px`}, docked ${m.docked}, cat ${JSON.stringify(m.cat)}, text right ${m.textRight}, scale ${m.scale}, hits ${JSON.stringify(m.hits)}`);
      check(m.margin === 0 && Math.abs(m.gapBelow) <= 1, `${tag} at the ${where}: no band, reader margin ${m.margin}px, gap to the reply box ${m.gapBelow}px`);
    }
    check(at.every((m) => JSON.stringify(m.cat) === JSON.stringify(at[0].cat)) && at[0].scrollMax > 0, `${tag}: same rect at top, middle and bottom ${JSON.stringify(at.map((m) => m.cat))}`);
  };

  // Customize › Pet size is saved in config.json; then every look at 1280 (gutter) and 800 (bar) for that size.
  const widths: Record<string, number> = {};
  for (const [size, want] of [['large', 180], ['small', 96], ['normal', 144]] as const) {
    check(await sizeTo(1280), '1280px window sized');
    await js("PastelTerm.customize.open('look')");
    await waitFor(() => js("Boolean(document.querySelector('#customize [aria-label=\"Pet size\"]'))"), 3000);
    await js(`[...document.querySelectorAll('#customize [aria-label="Pet size"] .cz-chip')].find((c) => c.textContent.trim().toLowerCase() === ${JSON.stringify(size)}).click()`);
    await waitFor(() => loadConfig().pet.size === size, 3000);
    await js('PastelTerm.overlays.hideCurrent()');
    await wait(300);
    check(loadConfig().pet.size === size, `${size}: saved ${loadConfig().pet.size}`);
    for (const width of [1280, 800]) {
      check(await sizeTo(width), `${width}px window sized`);
      for (const [look] of READING_CHOICES) {
        await js(`window.pastel.look.setReading(${JSON.stringify(look)})`);
        await waitFor(async () => (await js('document.documentElement.dataset.reading')) === look, 3000);
        await wait(200);
        const gutter = width === 1280 && gutterAt1280(look, size);
        if (width === 1280 && look === 'newspaper') widths[size] = (await measure()).cat.width;
        await steady(`${size} ${width}px ${look}`, want, gutter);
        if (look === 'newspaper') await capture(`pet-size-${size}-${width}-${gutter ? 'gutter' : 'bar'}`);
      }
    }
  }
  await js("window.pastel.look.setReading('newspaper')");
  check(widths.large > widths.normal && widths.normal > widths.small, `size changes her rect: ${JSON.stringify(widths)}`);

  // Idle: nothing to measure; the renderer stays near zero (no scene, as before).
  await js("PastelTerm.cat.setScene('none')");
  const cpu = () => app.getAppMetrics().filter((m) => m.type === 'Tab').reduce((sum, m) => sum + (m.cpu.cumulativeCPUUsage ?? 0), 0);
  await wait(2000);
  const before = cpu();
  await wait(6000);
  const percent = ((cpu() - before) / 6) * 100;
  check(percent < 3, `idle renderer CPU over 6s: ${percent.toFixed(2)}%`);
}

// Pet size (PASTEL_SNAPSHOT_MODE=pet-size): she stays the size picked in Customize and in one place at every scroll position:
// beside the text at 1280, docked in the header bar at 800 (64px for Normal, the bar grown to fit), never over text, and the reader keeps its full height.
// Also docked with the Notes drawer open at 990 and 800, where the header row wraps and her slot gets a line of its own.
import fs from 'node:fs';
import { app, type BrowserWindow } from 'electron';
import type { Kit } from './snapshot';
import { OPEN_SECTIONS } from './snapshot-reader-collapse';
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
  '**Doing:** checking the pet size.', '**Recommend:** keep her visible.', '**Next:** run the narrow modes.', '',
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
  for (const control of document.querySelectorAll('#reader-head :is(button, .reader-repo, .status-strip)')) {
    if (control.getClientRects().length && meets(control.getBoundingClientRect(), box)) hits.push('header:' + control.textContent.trim().slice(0, 24));
  }
  const column = document.querySelector('#reader .reader-column');
  const textRight = column.getBoundingClientRect().right - parseFloat(getComputedStyle(column).paddingRight);
  const bar = document.querySelector('#reader-head .reader-head-row').getBoundingClientRect();
  const slot = document.querySelector('#reader-head .reader-head-end').getBoundingClientRect();
  const head = document.getElementById('reader-head').getBoundingClientRect();
  const drawer = [...document.querySelectorAll('#notes-panel, #agent-panel')].find((p) => p.getClientRects().length > 0);
  const strip = document.querySelector('#reader-head .status-strip');
  const key = document.getElementById('colour-key-button').getBoundingClientRect();
  const toggle = document.querySelector('#reader-head .view-toggle').getBoundingClientRect();
  const below = Math.min(...['prompt-dock', 'composer'].map((id) => document.getElementById(id).getBoundingClientRect().top));
  return {
    cat: R(box), shown, scale: getComputedStyle(cat).getPropertyValue('--pet-scale').trim(), docked: area.classList.contains('cat-docked'),
    textRight: Math.round(textRight), viewTop: Math.round(view.top), viewBottom: Math.round(view.bottom), bar: R(bar), slot: R(slot), head: R(head), areaTop: Math.round(area.getBoundingClientRect().top),
    drawer: drawer ? R(drawer.getBoundingClientRect()) : null, underDrawer: Boolean(drawer && meets(drawer.getBoundingClientRect(), box)), key: R(key), toggle: R(toggle),
    strip: strip && !strip.hidden ? R(strip.getBoundingClientRect()) : null,
    margin: parseFloat(getComputedStyle(reader).marginBottom) || 0, gapBelow: Math.round(below - view.bottom),
    hits: [...new Set(hits)].slice(0, 4), scrollTop: Math.round(reader.scrollTop), scrollMax: reader.scrollHeight - reader.clientHeight,
  };
})()`;

// any: MEASURE's shape is built in the script above.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Measure = any;

// Her corner beside the text, or her slot in the header bar left of Colour key: her docked height, inside the bar's row, above the strip.
const inGutter = (m: Measure, want: number): boolean => !m.docked && Math.abs(m.cat.width - want) <= 1 && Math.abs(m.cat.height - want) <= 1
  && m.cat.left > m.textRight && m.cat.bottom <= m.viewBottom;
const inBar = (m: Measure, dock: number): boolean => m.docked && Math.abs(m.cat.height - dock) <= 1 && Math.abs(m.bar.height - dock) <= 1
  && m.cat.top >= m.bar.top - 1 && m.cat.bottom <= m.bar.bottom + 1 && m.cat.right <= m.key.left && m.cat.left >= m.toggle.right
  && m.strip !== null && m.cat.bottom <= m.strip.top;
// Notes drawer open on a narrow window: docked, never under the drawer; the row may wrap, so her slot's own line holds her, above the reader.
const inDrawerBar = (m: Measure, dock: number): boolean => m.docked && !m.underDrawer && Math.abs(m.cat.height - dock) <= 1 && m.slot.height >= dock - 1
  && m.cat.top >= m.slot.top - 1 && m.cat.bottom <= m.slot.bottom + 1 && m.cat.top >= m.head.top && m.cat.bottom <= m.viewTop && m.cat.right <= m.key.left;
const DOCK_PX = { small: 48, normal: 64, large: 80 } as const; // DOCK_PX in cat.ts

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
  await js(OPEN_SECTIONS); // her size is measured against the full reply
  await js('PastelTerm.welcome.close()');
  await js("PastelTerm.reader.setView('replies')");
  await js("PastelTerm.cat.setScene('cherry')");

  // Top, middle and bottom: one place at all three, the expected one, and nothing under her; no band below the reader.
  type Where = 'gutter' | 'bar' | 'drawer';
  const placed = (m: Measure, where: Where, want: number, dock: number): boolean => (
    where === 'gutter' ? inGutter(m, want) : where === 'bar' ? inBar(m, dock) : inDrawerBar(m, dock));
  const steady = async (tag: string, want: number, dock: number, where: Where) => {
    const at: Measure[] = [];
    for (const spot of ['top', 'middle', 'bottom'] as const) {
      await scrollTo('top');
      if (spot !== 'top') await scrollTo(spot === 'bottom' ? 'bottom' : Math.round((await measure()).scrollMax / 2));
      const m: Measure = await measure();
      at.push(m);
      check(m.shown && placed(m, where, want, dock) && m.hits.length === 0,
        `${tag} at the ${spot} (${m.scrollTop}/${m.scrollMax}): ${where === 'gutter' ? `gutter, want ${want}` : `${where}, want ${dock}, bar ${JSON.stringify(m.bar)}, slot ${JSON.stringify(m.slot)}, reader top ${m.viewTop}, drawer ${JSON.stringify(m.drawer)}, strip ${JSON.stringify(m.strip)}`}, docked ${m.docked}, cat ${JSON.stringify(m.cat)}, text right ${m.textRight}, scale ${m.scale}, hits ${JSON.stringify(m.hits)}`);
      check(m.margin === 0 && Math.abs(m.gapBelow) <= 1, `${tag} at the ${spot}: no band, reader margin ${m.margin}px, gap to the reply box ${m.gapBelow}px`);
    }
    check(at.every((m) => JSON.stringify(m.cat) === JSON.stringify(at[0].cat)) && at[0].scrollMax > 0, `${tag}: same rect at top, middle and bottom ${JSON.stringify(at.map((m) => [m.cat, m.areaTop]))}`);
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
        await steady(`${size} ${width}px ${look}`, want, DOCK_PX[size], gutter ? 'gutter' : 'bar');
        if (look === 'newspaper') await capture(`pet-size-${size}-${width}-${gutter ? 'gutter' : 'bar'}`);
      }
    }
    // Notes drawer open below 1000px: the header row wraps; she once hung 4-5px over the reply text here.
    await js('PastelTerm.notesPanel.setOpen(true)');
    for (const width of [990, 800]) {
      check(await sizeTo(width), `${width}px window sized, Notes open`);
      for (const [look] of READING_CHOICES) {
        await js(`window.pastel.look.setReading(${JSON.stringify(look)})`);
        await waitFor(async () => (await js('document.documentElement.dataset.reading')) === look, 3000);
        await wait(200);
        await steady(`${size} ${width}px ${look} Notes open`, want, DOCK_PX[size], 'drawer');
        if (look === 'newspaper') await capture(`pet-size-${size}-${width}-notes-open`);
      }
    }
    await js('PastelTerm.notesPanel.setOpen(false)');
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

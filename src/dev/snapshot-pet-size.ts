// Pet size (PASTEL_SNAPSHOT_MODE=pet-size): she stays the size picked in Customize at every scroll position,
// for every look and window width, and the reader ends above her so no text sits under her.
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

// Her box, the chosen scale, the strip the reader leaves her, and every visible text block under her.
const MEASURE = `(() => {
  const R = (b) => ({ left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), bottom: Math.round(b.bottom), width: Math.round(b.width), height: Math.round(b.height) });
  const meets = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const cat = document.getElementById('cat');
  const reader = document.getElementById('reader');
  const shown = getComputedStyle(cat).display !== 'none';
  const box = cat.getBoundingClientRect();
  const view = reader.getBoundingClientRect();
  const hits = [];
  for (const block of document.querySelectorAll('#latest :is(p, h1, h2, h3, h4, li, td, th, pre, blockquote)')) {
    const r = block.getBoundingClientRect();
    const c = { left: Math.max(r.left, view.left), right: Math.min(r.right, view.right), top: Math.max(r.top, view.top), bottom: Math.min(r.bottom, view.bottom) };
    if (shown && c.right > c.left && c.bottom > c.top && meets(c, box)) hits.push(block.tagName + ':' + block.textContent.trim().slice(0, 24));
  }
  return {
    cat: R(box), shown, scale: getComputedStyle(cat).getPropertyValue('--pet-scale').trim(),
    strip: parseFloat(getComputedStyle(reader).marginBottom) || 0, hits: [...new Set(hits)].slice(0, 4),
    scrollTop: Math.round(reader.scrollTop), scrollMax: reader.scrollHeight - reader.clientHeight,
  };
})()`;

// any: MEASURE's shape is built in the script above.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Measure = any;

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
  await js("PastelTerm.cat.setScene('none')");

  // Top, middle and bottom: one size and one place at all three, and no visible line under her at any.
  const steady = async (tag: string, want: number) => {
    const at: Measure[] = [];
    for (const where of ['top', 'middle', 'bottom'] as const) {
      await scrollTo('top');
      if (where !== 'top') await scrollTo(where === 'bottom' ? 'bottom' : Math.round((await measure()).scrollMax / 2));
      const m: Measure = await measure();
      at.push(m);
      check(m.shown && Math.abs(m.cat.width - want) <= 1 && Math.abs(m.cat.height - want) <= 1 && m.hits.length === 0,
        `${tag} at the ${where} (${m.scrollTop}/${m.scrollMax}): cat ${m.cat.width}x${m.cat.height} (want ${want}), scale ${m.scale}, strip ${m.strip}px, hits ${JSON.stringify(m.hits)}`);
    }
    check(at.every((m) => JSON.stringify(m.cat) === JSON.stringify(at[0].cat)) && at[0].scrollMax > 0, `${tag}: same rect at top, middle and bottom ${JSON.stringify(at.map((m) => m.cat))}`);
  };

  // 1. Every look, 1280 and 990: Normal stays Normal wherever the reader is scrolled.
  for (const width of [1280, 990]) {
    check(await sizeTo(width), `${width}px window sized`);
    for (const [look] of READING_CHOICES) {
      await js(`window.pastel.look.setReading(${JSON.stringify(look)})`);
      await waitFor(async () => (await js('document.documentElement.dataset.reading')) === look, 3000);
      await steady(`${width}px ${look}`, 144);
      if (look === 'newspaper' || look === 'editorial') await capture(`pet-size-${width}-${look}-bottom`);
    }
  }

  // 2. A narrow window: still Normal at every scroll position.
  await js("window.pastel.look.setReading('newspaper')");
  check(await sizeTo(800), '800px window sized');
  await steady('800px newspaper', 144);
  await capture('pet-size-800-bottom');

  // 3. Customize › Pet size sets her box at 1280 and 800, is saved in config.json, and scrolling never changes it.
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
    widths[size] = (await measure()).cat.width;
    await steady(`${size} 1280px`, want);
    if (size === 'large') await capture('pet-size-1280-large');
    check(await sizeTo(800), '800px window sized');
    await steady(`${size} 800px`, want);
  }
  check(widths.large > widths.normal && widths.normal > widths.small, `size changes her rect: ${JSON.stringify(widths)}`);

  // 4. Idle: nothing to measure; the renderer stays near zero.
  const cpu = () => app.getAppMetrics().filter((m) => m.type === 'Tab').reduce((sum, m) => sum + (m.cpu.cumulativeCPUUsage ?? 0), 0);
  await wait(2000);
  const before = cpu();
  await wait(6000);
  const percent = ((cpu() - before) / 6) * 100;
  check(percent < 3, `idle renderer CPU over 6s: ${percent.toFixed(2)}%`);
}

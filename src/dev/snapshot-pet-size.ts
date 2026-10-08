// Pet size (PASTEL_SNAPSHOT_MODE=pet-size): a wide table at the top of the reply never shrinks her once it has
// scrolled away, a visible text block under her corner does, scrolling alone re-checks, and the Customize size sets her box.
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

// Her box, what the guard chose, every visible text block under her, and how far the widest block reaches.
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
  const blocks = [...document.querySelectorAll('#latest :is(p, h1, h2, h3, pre, table, blockquote, ul, ol, .rail)')];
  return {
    cat: R(box), shown, scale: cat.style.getPropertyValue('--cat-scale'), compact: cat.classList.contains('compact'),
    strip: document.getElementById('reader-area').classList.contains('cat-strip'), hits: [...new Set(hits)].slice(0, 4),
    widestBlockRight: Math.round(Math.max(...blocks.map((b) => b.getBoundingClientRect().right))),
    tableRight: Math.round(document.querySelector('#latest table')?.getBoundingClientRect().right ?? 0),
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

  // 1. Every look, 1280 and 990: the wide table at the top has scrolled away, so she is full size.
  for (const width of [1280, 990]) {
    check(await sizeTo(width), `${width}px window sized`);
    for (const [look] of READING_CHOICES) {
      await js(`window.pastel.look.setReading(${JSON.stringify(look)})`);
      await waitFor(async () => (await js('document.documentElement.dataset.reading')) === look, 3000);
      await scrollTo('top');
      const top: Measure = await measure();
      log(`pet size: ${width}px ${look} at the top: table right ${top.tableRight}, widest block right ${top.widestBlockRight}, cat left ${top.cat.left}, scale ${top.scale}, strip ${top.strip}, hits ${JSON.stringify(top.hits)}`);
      check(top.hits.length === 0, `${width}px ${look} at the top covers no visible line`);
      await scrollTo('bottom');
      const m: Measure = await measure();
      const full = m.shown && m.scale === '1' && !m.compact && !m.strip && Math.abs(m.cat.width - 144) <= 1;
      check(full && m.hits.length === 0, `${width}px ${look} scrolled to the bottom (${m.scrollTop}/${m.scrollMax}): full size ${JSON.stringify(m.cat)} scale ${m.scale}, strip ${m.strip}, hits ${JSON.stringify(m.hits)}; old guard would shrink: ${m.widestBlockRight + 12 > m.cat.left}`);
      if (look === 'newspaper' || look === 'editorial') await capture(`pet-size-${width}-${look}-bottom`);
    }
  }

  // 2. A visible line under her corner shrinks her, and scrolling alone (no resize) re-checks.
  await js("window.pastel.look.setReading('newspaper')");
  check(await sizeTo(800), '800px window sized');
  await scrollTo('top');
  const middle = Math.round((await measure()).scrollMax / 2);
  await scrollTo(middle);
  const under: Measure = await measure();
  check((under.compact || under.strip) && under.hits.length === 0, `800px mid-reply: a line under her shrinks or strips her, none left covered: scale ${under.scale}, compact ${under.compact}, strip ${under.strip}, hits ${JSON.stringify(under.hits)}`);
  await capture('pet-size-800-line-under');
  await scrollTo('bottom');
  const end: Measure = await measure();
  check(end.hits.length === 0 && JSON.stringify([end.scale, end.strip]) !== JSON.stringify([under.scale, under.strip]), `scroll alone re-checks: middle ${under.scale}/${under.strip ? 'strip' : 'no strip'} → bottom ${end.scale}/${end.strip ? 'strip' : 'no strip'}, hits ${JSON.stringify(end.hits)}`);

  // 3. Customize › Pet size sets her box at 1280 and is saved in config.json; never grown above the choice.
  check(await sizeTo(1280), '1280px window sized');
  await scrollTo('bottom');
  const widths: Record<string, number> = {};
  for (const [size, want] of [['large', 180], ['small', 96], ['normal', 144]] as const) {
    await js("PastelTerm.customize.open('look')");
    await waitFor(() => js("Boolean(document.querySelector('#customize [aria-label=\"Pet size\"]'))"), 3000);
    await js(`[...document.querySelectorAll('#customize [aria-label="Pet size"] .cz-chip')].find((c) => c.textContent.trim().toLowerCase() === ${JSON.stringify(size)}).click()`);
    await waitFor(() => loadConfig().pet.size === size, 3000);
    await js('PastelTerm.overlays.hideCurrent()');
    await wait(300);
    const m: Measure = await measure();
    widths[size] = m.cat.width;
    check(Math.abs(m.cat.width - want) <= 1 && m.hits.length === 0 && loadConfig().pet.size === size, `${size}: cat ${m.cat.width}x${m.cat.height} (want ${want}), scale ${m.scale}, saved ${loadConfig().pet.size}`);
    if (size === 'large') await capture('pet-size-1280-large');
    if (size === 'large') {
      await sizeTo(800);
      await scrollTo(middle);
      const narrow: Measure = await measure();
      check(Number(narrow.scale) < 1.25 && narrow.hits.length === 0, `large at 800px mid-reply shrinks below her choice: scale ${narrow.scale}, strip ${narrow.strip}`);
      await sizeTo(1280);
      await scrollTo('bottom');
    }
  }
  check(widths.large > widths.normal && widths.normal > widths.small, `size changes her rect: ${JSON.stringify(widths)}`);

  // 4. Idle: no scroll, no guard work; the renderer stays near zero.
  const cpu = () => app.getAppMetrics().filter((m) => m.type === 'Tab').reduce((sum, m) => sum + (m.cpu.cumulativeCPUUsage ?? 0), 0);
  await wait(2000);
  const before = cpu();
  await wait(6000);
  const percent = ((cpu() - before) / 6) * 100;
  check(percent < 3, `idle renderer CPU over 6s: ${percent.toFixed(2)}%`);
}

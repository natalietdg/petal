// Text size (PASTEL_SNAPSHOT_MODE=text-size): View › Bigger / Smaller Text / Actual Size act on the pane she last used.
// The reader's prose scales and the dock doesn't; the terminal font grows and the pty follows xterm's grid; ⌘0 restores both;
// Customize › Look shows and sets the sizes live; 160% and 28 px fit an 800px window; the new-user setup room counts rows at the live font.
import fs from 'node:fs';
import type { BrowserWindow } from 'electron';
import type { Kit, TabsDeps } from './snapshot';
import * as configStore from '../main/config-store';
import { fixtureFile, ptyWrites } from '../main/snapshot-mode';
import { assertFixtureOutsideClaude } from './snapshot-views';
import { resizeOffscreen } from '../main/snapshot-window';
import { CLAUDE_SETUP_ROWS, READER_SPLIT } from '../shared/reader-split';
import type { TextStep } from '../shared/text-size';

const MARKER = 'Text size fixture';
const REPLY = [
  `**${MARKER}: every shape the reader scales.**`, '',
  'A plain paragraph of body text, long enough to wrap across the column at the larger sizes so the measure shows.', '',
  '## 1. A section', '',
  'Body text under a section heading, with `inline code` in it.', '',
  '| Size | Prose | Code |', '|---|---|---|', '| 100% | 20px | 14px |', '| 160% | 32px | 22.4px |', '',
  '```', 'const longLine = "a code block line that should wrap rather than push the column sideways at 160 percent";', '```', '',
  '**Doing:** checking text sizes.', '**Recommend:** keep the dock fixed.', '**Next:** try 160%.',
].join('\n');

// Appended to the fixture log; the reader tails it from its offset.
function appendReply(file: string): void {
  assertFixtureOutsideClaude(file);
  const at = new Date().toISOString();
  const lines = [
    { type: 'user', uuid: 'text-size-u', timestamp: at, isSidechain: false, message: { role: 'user', content: 'show every shape' } },
    { type: 'assistant', uuid: 'text-size-a', timestamp: at, isSidechain: false, message: { role: 'assistant', content: [{ type: 'text', text: REPLY }] } },
  ];
  fs.appendFileSync(file, lines.map((line) => JSON.stringify(line)).join('\n') + '\n');
}

const MEASURE = `(() => {
  const px = (el) => el ? parseFloat(getComputedStyle(el).fontSize) : null;
  const tab = PastelTerm.tabs.active();
  const dockButton = document.querySelector('#sessions-dock button');
  return {
    scale: getComputedStyle(document.documentElement).getPropertyValue('--reader-scale').trim(),
    prose: px(document.querySelector('#latest p:not(.headline)')),
    headline: px(document.querySelector('#latest .headline')),
    h2: px(document.querySelector('#latest h2')),
    table: px(document.querySelector('#latest table')),
    code: px(document.querySelector('#latest pre code')),
    dock: Math.round(document.getElementById('sessions-dock').getBoundingClientRect().height),
    dockButton: px(dockButton),
    composer: px(document.getElementById('composer-input')),
    tabLabel: px(document.querySelector('.tab-label')),
    termFont: tab.term.options.fontSize,
    cols: tab.term.cols,
    rows: tab.term.rows,
    pane: PastelTerm.textSize.targetPane(),
  };
})()`;

// Page and pane overflow at the current window size.
const OVERFLOW = `(() => {
  const over = (el) => el ? el.scrollWidth - el.clientWidth : 0;
  const reader = document.getElementById('reader');
  const column = reader.querySelector('.reader-column');
  const wide = [...column.querySelectorAll('#latest :is(p, h1, h2, h3, li, pre, table, blockquote)')]
    .filter((el) => el.getBoundingClientRect().right > reader.getBoundingClientRect().right + 1 && !el.closest('pre, table'))
    .map((el) => el.tagName);
  const screen = document.querySelector('.term-host:not([hidden]) .xterm-screen');
  const host = document.getElementById('terminal');
  return {
    page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: over(document.body),
    reader: over(reader),
    wide,
    terminal: Math.round(screen.getBoundingClientRect().right - host.getBoundingClientRect().right),
    width: window.innerWidth,
  };
})()`;

// any: MEASURE's shape is built in the script above.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Measure = any;

const CLICK_READER = "document.querySelector('#latest p:not(.headline)').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))";
const CLICK_TERMINAL = "(() => { document.querySelector('.term-host:not([hidden]) .xterm-screen').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })); PastelTerm.tabs.active().term.focus(); })()";

export async function textSizeCheck(kit: Kit, win: BrowserWindow, { activeSession }: Pick<TabsDeps, 'activeSession'>): Promise<void> {
  const { js, log, wait, waitFor, capture } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} text size: ${what}`);
  const measure = (): Promise<Measure> => js(MEASURE);
  const session = activeSession(win.webContents.id);
  if (!session) throw new Error('text size: no active tab');
  const menu = async (step: TextStep, times = 1) => {
    for (let i = 0; i < times; i += 1) win.webContents.send('text-size:step', step); // what View › Bigger Text (⌘=) sends
    await wait(400);
  };
  const saved = () => configStore.load().text;

  appendReply(fixtureFile() ?? '');
  await js('PastelTerm.getStarted.close()');
  await js('PastelTerm.overlays.hideCurrent()');
  check(await waitFor(async () => (await js("document.getElementById('latest').innerText")).includes(MARKER) || null, 10000), 'the fixture reply with a section, table and code is on screen');
  resizeOffscreen(win, 1280, 900);
  await wait(500);
  const base: Measure = await measure();
  check(base.scale === '1' && base.termFont === 16 && base.prose !== null, `opens at today's sizes: ${JSON.stringify({ scale: base.scale, termFont: base.termFont, prose: base.prose })}`);
  check(base.cols === session.pty.cols && base.rows === session.pty.rows, `pty matches the grid at 16px: ${base.cols}x${base.rows}, pty ${session.pty.cols}x${session.pty.rows}`);

  // Reader: a click on the reply hands keystrokes to the shell, but ⌘= still means the reader.
  await js(CLICK_READER);
  await js("window.dispatchEvent(new Event('petal:focus-terminal'))");
  check((await measure()).pane === 'reader', 'after a click on the reply, the keys target the reader');
  await menu(1, 4);
  const big: Measure = await measure();
  const ratio = (a: number, b: number) => Math.round((a / b) * 100) / 100;
  check(big.scale === '1.4' && ratio(big.prose, base.prose) === 1.4 && ratio(big.h2 ?? 1, base.h2 ?? 1) === 1.4 && ratio(big.table ?? 1, base.table ?? 1) === 1.4 && ratio(big.code ?? 1, base.code ?? 1) === 1.4,
    `⌘= ×4 scales prose, headings, tables and code to 140%: ${JSON.stringify({ prose: `${base.prose}→${big.prose}`, h2: `${base.h2}→${big.h2}`, table: `${base.table}→${big.table}`, code: `${base.code}→${big.code}`, headline: `${base.headline}→${big.headline}` })}`);
  check(big.dock === base.dock && big.dockButton === base.dockButton && big.composer === base.composer && big.tabLabel === base.tabLabel,
    `dock, reply box and tabs keep their size: dock ${base.dock}→${big.dock}px, button ${base.dockButton}→${big.dockButton}px, composer ${base.composer}→${big.composer}px`);
  check(big.termFont === 16 && big.cols === base.cols, `the terminal is untouched: ${big.termFont}px, ${big.cols} cols`);
  check(await waitFor(() => saved().readerPercent === 140 || null, 3000), `saved to config: ${JSON.stringify(saved())}`);
  await js("(() => { const all = document.querySelector('#latest .fold-all'); if (all && /expand/i.test(all.textContent)) all.click(); document.querySelector('#latest h2')?.scrollIntoView({ block: 'start' }); })()");
  await capture('reader-140');

  // Terminal: focused and typed in, ⌘= grows the font and the pty follows the new grid.
  await js(CLICK_TERMINAL);
  check((await measure()).pane === 'terminal', 'a click in the terminal targets it');
  const writesBefore = ptyWrites.length;
  for (const keyCode of ['=', '-', '0', 'Plus']) {
    for (const type of ['keyDown', 'char', 'keyUp'] as const) win.webContents.sendInputEvent({ type, keyCode, modifiers: ['meta'] });
  }
  await wait(400);
  const typed = ptyWrites.slice(writesBefore).filter((w) => w.tabId === session.tabId).map((w) => w.data);
  check(typed.length === 0, `⌘= ⌘- ⌘0 ⌘+ type nothing into the shell: ${JSON.stringify(typed)}`);
  await menu(1, 6);
  const term22: Measure = await measure();
  const ptyFollows = await waitFor(() => (session.pty.cols === term22.cols && session.pty.rows === term22.rows) || null, 3000);
  check(term22.termFont === 22 && term22.cols < base.cols && term22.rows < base.rows, `⌘= ×6 sets 22px; the grid shrinks ${base.cols}x${base.rows}→${term22.cols}x${term22.rows}`);
  check(ptyFollows, `pty resized to match: ${session.pty.cols}x${session.pty.rows}`);
  check(term22.scale === '1.4' && term22.prose === big.prose, 'the reader keeps its 140%');
  check(await js('(() => { const b = PastelTerm.tabs.active().term.buffer.active; return b.viewportY === b.baseY; })()'), 'the terminal stays scrolled to the bottom');
  check(await waitFor(() => saved().terminalFontSize === 22 || null, 3000), 'saved to config');
  await capture('terminal-22');

  // The range ends hold.
  await menu(1, 10);
  check((await measure()).termFont === 28, 'the terminal stops at 28px');
  await menu(-1, 25);
  check((await measure()).termFont === 10, 'and at 10px');

  // ⌘0 on each pane restores it; the pty comes back to the original grid.
  await menu(0);
  const termBack: Measure = await measure();
  check(termBack.termFont === 16 && termBack.cols === base.cols && termBack.rows === base.rows && termBack.scale === '1.4',
    `⌘0 in the terminal restores 16px and ${termBack.cols}x${termBack.rows} (was ${base.cols}x${base.rows}), reader still 140%`);
  check(await waitFor(() => (session.pty.cols === base.cols && session.pty.rows === base.rows) || null, 3000), `pty back to ${session.pty.cols}x${session.pty.rows}`);
  await js(CLICK_READER);
  await menu(0);
  const readerBack: Measure = await measure();
  check(readerBack.scale === '1' && readerBack.prose === base.prose, `⌘0 on the reader restores 100%: ${readerBack.prose}px`);
  check(await waitFor(() => (saved().readerPercent === 100 && saved().terminalFontSize === 16) || null, 3000), `both saved at today's sizes: ${JSON.stringify(saved())}`);

  // A minimised terminal can't take the keys: the reader gets them.
  await js(CLICK_TERMINAL);
  await js('PastelTerm.layout.setTerminalMinimised(true, false)');
  await menu(1);
  const minimised: Measure = await measure();
  check(minimised.scale === '1.1' && minimised.termFont === 16, `with the terminal minimised ⌘= grows the reader: ${minimised.scale}, terminal ${minimised.termFont}px`);
  await js('PastelTerm.layout.setTerminalMinimised(false, false)');
  await js(CLICK_READER);
  await menu(0);
  await wait(300);

  // Customize › Look: the steppers show the live sizes and set them.
  await js("PastelTerm.customize.open('look')");
  await waitFor(() => js("Boolean(document.querySelector('#customize .cz-size'))"), 3000);
  const shown = () => js("Object.fromEntries([...document.querySelectorAll('#customize .cz-size')].map((r) => [r.dataset.pane, { value: r.querySelector('output').textContent, reset: r.querySelector('.cz-size-reset').disabled }]))");
  const before = await shown();
  check(before.terminal?.value === '16 px' && before.reader?.value === '100%' && before.terminal.reset && before.reader.reset, `Look shows 16 px and 100%, Reset off: ${JSON.stringify(before)}`);
  for (let i = 0; i < 4; i += 1) await js("document.querySelector('#customize .cz-size[data-pane=\"reader\"] [aria-label^=\"Bigger\"]').click()");
  for (let i = 0; i < 6; i += 1) await js("document.querySelector('#customize .cz-size[data-pane=\"terminal\"] [aria-label^=\"Bigger\"]').click()");
  await wait(400);
  const set: Measure = await measure();
  const after = await shown();
  check(after.reader.value === '140%' && after.terminal.value === '22 px' && set.scale === '1.4' && set.termFont === 22, `the + buttons set 140% and 22 px live: ${JSON.stringify(after)}, page ${set.scale} / ${set.termFont}px`);
  check(await waitFor(() => (saved().readerPercent === 140 && saved().terminalFontSize === 22) || null, 3000), 'saved to config');
  await js("document.querySelector('#customize .cz-card').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))");
  await menu(-1);
  check((await shown()).reader.value === '130%', `⌘- with Customize focused steps the reader, and Look follows: ${(await shown()).reader.value}`);
  await menu(1);
  await capture('customize');
  await js("document.querySelector('#customize .cz-size[data-pane=\"terminal\"] .cz-size-reset').click()");
  check(await waitFor(async () => ((await shown()).terminal.value === '16 px' && (await measure()).termFont === 16) || null, 3000), 'Reset puts the terminal back to 16 px');
  await js('PastelTerm.customize.close()');

  // 160% and 28px at 800px wide: nothing runs off the page sideways.
  await js(CLICK_READER);
  await menu(1, 8);
  await js(CLICK_TERMINAL);
  await menu(1, 12);
  resizeOffscreen(win, 800, 900);
  await wait(800);
  const narrow = await js(OVERFLOW);
  const sized: Measure = await measure();
  check(sized.scale === '1.6' && sized.termFont === 28, `at the top of both ranges: ${sized.scale}, ${sized.termFont}px`);
  check(narrow.width === 800 && narrow.page <= 0 && narrow.body <= 0 && narrow.reader <= 0 && narrow.wide.length === 0 && narrow.terminal <= 1,
    `no horizontal overflow at 800px: ${JSON.stringify(narrow)}`);
  check(await waitFor(() => (session.pty.cols === sized.cols && session.pty.rows === sized.rows) || null, 3000), `pty follows at 28px: ${sized.cols}x${sized.rows}`);
  await js("(() => { const all = document.querySelector('#latest .fold-all'); if (all && /expand/i.test(all.textContent)) all.click(); document.querySelector('#latest h2')?.scrollIntoView({ block: 'start' }); })()");
  await capture('narrow-160-28');
  resizeOffscreen(win, 1280, 900);
  await js(CLICK_TERMINAL);
  await menu(0);
  await js(CLICK_READER);
  await menu(0);

  // New-user setup room: rows are counted at the live font, so a smaller font needs less room and a bigger one more.
  const TALL = 1320;
  resizeOffscreen(win, 1280, TALL);
  await wait(600);
  await js('PastelTerm.layout.makeRoomForClaudeSetup(true)');
  const room: Record<number, { rows: number; share: number }> = {};
  await js(CLICK_TERMINAL);
  for (const [px, steps] of [[12, -4], [16, 4], [22, 6]] as const) {
    await menu(steps > 0 ? 1 : -1, Math.abs(steps));
    await wait(600);
    const m: Measure = await measure();
    room[px] = { rows: m.rows, share: Number(await js("document.getElementById('divider').getAttribute('aria-valuenow')")) };
    if (m.termFont !== px) log(`FAIL text size: setup room step expected ${px}px, got ${m.termFont}px`);
  }
  // The reader's floor: its share bound, or its fixed bands at this height (layout.ts), whichever is higher.
  const floor = Math.max(READER_SPLIT.min * 100, await js("(() => { const app = document.getElementById('app'); const bands = ['sessions-dock', 'reader-head', 'prompt-dock', 'composer'].reduce((sum, id) => sum + document.getElementById(id).offsetHeight, 0); return Math.ceil(bands / (app.clientHeight - document.getElementById('divider').offsetHeight) * 100); })()"));
  const atMin = (share: number) => share <= floor;
  check(room[12].rows >= CLAUDE_SETUP_ROWS && room[16].rows >= CLAUDE_SETUP_ROWS && (room[22].rows >= CLAUDE_SETUP_ROWS || atMin(room[22].share)),
    `setup room holds ${CLAUDE_SETUP_ROWS} rows at each size (or the reader at its ${floor}% floor): ${JSON.stringify(room)}`);
  check(room[12].share > room[16].share && room[16].share > room[22].share, `and gives the reader ${room[12].share}% / ${room[16].share}% / ${room[22].share}% at 12 / 16 / 22px`);
  await js('PastelTerm.layout.makeRoomForClaudeSetup(false)');
  await menu(0);
  resizeOffscreen(win, 1280, 900);
  await wait(400);
}

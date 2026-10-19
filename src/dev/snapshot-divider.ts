// Divider drag: real mouse input and synthesized pointer events move the split, in every look, Sessions panel shut and open.
import type { BrowserWindow } from 'electron';
import type { Kit } from './snapshot';
import { resizeOffscreen } from '../main/snapshot-window';
import { READING_CHOICES } from '../main/menu';
import * as configStore from '../main/config-store';
import { clampSplit } from '../shared/reader-split';

const HEIGHT_TOLERANCE_PX = 10;
const TARGETS = [0.3, 0.8, 0.1, 0.65];

// Heights that matter, plus what elementFromPoint finds along the divider's whole width.
const MEASURE = `(() => {
  const app = document.getElementById('app').getBoundingClientRect();
  const divider = document.getElementById('divider');
  const d = divider.getBoundingClientRect();
  const covered = [];
  for (let x = 1; x < window.innerWidth; x += 8) {
    for (const y of [d.top + 1, d.top + d.height / 2, d.bottom - 1]) {
      const hit = document.elementFromPoint(x, y);
      if (hit !== divider && !divider.contains(hit)) covered.push({ x, y: Math.round(y), hit: hit ? (hit.id || hit.className || hit.tagName) : null });
    }
  }
  const pane = document.getElementById('terminal-pane').getBoundingClientRect();
  const area = document.getElementById('reader-area');
  return {
    appTop: app.top, appHeight: app.height,
    divider: { top: d.top, height: d.height, centre: d.top + d.height / 2 },
    terminalPane: Math.round(pane.height),
    readerArea: Math.round(area.getBoundingClientRect().height),
    readerAreaScroll: area.scrollHeight,
    chrome: ['sessions-dock', 'reader-head', 'prompt-dock', 'composer'].reduce((sum, id) => sum + document.getElementById(id).offsetHeight, 0),
    composerBottom: Math.round(document.getElementById('composer').getBoundingClientRect().bottom),
    rows: PastelTerm.tabs.active()?.term.rows ?? null,
    grid: getComputedStyle(document.getElementById('app')).gridTemplateRows,
    inline: document.getElementById('app').style.gridTemplateRows,
    covered: covered.slice(0, 12), coveredCount: covered.length,
  };
})()`;

// any: MEASURE's shape is built in the script above.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Measure = any;

// Terminal pane height a drag should give: bounds 20–85%, and never less reader than its fixed bands.
function expectedPane(m: Measure, target: number): number {
  const rows = m.appHeight - m.divider.height;
  const fraction = clampSplit(Math.max(m.chrome / rows, target));
  return (1 - fraction) * rows;
}

async function realDrag(kit: Kit, win: BrowserWindow, m: Measure, toY: number): Promise<void> {
  const x = Math.round(win.getContentSize()[0] / 2);
  const fromY = Math.round(m.divider.centre);
  // Moves carry the held button, as a real drag does; without it Chromium never starts the capture.
  const send = (type: 'mouseDown' | 'mouseMove' | 'mouseUp', y: number) =>
    win.webContents.sendInputEvent({ type, x, y: Math.round(y), button: 'left', clickCount: 1, modifiers: type === 'mouseMove' ? ['leftbuttondown'] : [] });
  send('mouseMove', fromY);
  send('mouseDown', fromY);
  for (let i = 1; i <= 8; i++) {
    send('mouseMove', fromY + ((toY - fromY) * i) / 8);
    await kit.wait(16);
  }
  send('mouseUp', toY);
}

async function syntheticDrag(kit: Kit, m: Measure, toY: number): Promise<string> {
  return kit.js(`(() => {
    const divider = document.getElementById('divider');
    const x = window.innerWidth / 2;
    const fire = (type, y) => divider.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'mouse', isPrimary: true, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true }));
    try {
      fire('pointerdown', ${m.divider.centre});
      fire('pointermove', ${(m.divider.centre + toY) / 2});
      fire('pointermove', ${toY});
      fire('pointerup', ${toY});
      return 'ok';
    } catch (error) { return String(error); }
  })()`);
}

async function dragCase(kit: Kit, win: BrowserWindow, label: string, how: 'real' | 'synthetic'): Promise<void> {
  const { js, log, wait } = kit;
  for (const fraction of TARGETS) {
    const before: Measure = await js(MEASURE);
    const toY = before.appTop + fraction * before.appHeight;
    const thrown = how === 'real' ? (await realDrag(kit, win, before, toY), 'ok') : await syntheticDrag(kit, before, toY);
    await wait(350); // ResizeObserver → fit → rows
    const after: Measure = await js(MEASURE);
    const want = expectedPane(before, fraction);
    const heightOk = Math.abs(after.terminalPane - want) <= HEIGHT_TOLERANCE_PX;
    const reachable = after.coveredCount === 0 && after.composerBottom <= Math.ceil(after.divider.top);
    const rowsOk = after.rows !== before.rows || Math.abs(before.terminalPane - after.terminalPane) <= HEIGHT_TOLERANCE_PX;
    log(`${heightOk && rowsOk && reachable && thrown === 'ok' ? 'ok' : 'FAIL'} divider ${label} ${how} drag to ${fraction * 100}%: pane ${before.terminalPane}→${after.terminalPane}px (want ${Math.round(want)}±${HEIGHT_TOLERANCE_PX}), rows ${before.rows}→${after.rows}, covered ${after.coveredCount} ${JSON.stringify(after.covered.slice(0, 3))}, composer bottom ${after.composerBottom} divider top ${Math.round(after.divider.top)}, reader area ${after.readerArea}px (scroll ${after.readerAreaScroll}), grid "${after.grid}", inline "${after.inline}", ${thrown}`);
  }
}

// Every look, Sessions panel shut and open: nothing covers the divider, and drags land where they should.
async function looksAtSize(kit: Kit, win: BrowserWindow, width: number, height: number): Promise<void> {
  const { js, log, waitFor, wait, capture } = kit;
  resizeOffscreen(win, width, height);
  await waitFor(async () => (await js('window.innerHeight')) === height, 3000);
  for (const [look] of READING_CHOICES) {
    await js(`window.pastel.look.setReading(${JSON.stringify(look)})`);
    await waitFor(async () => (await js('document.documentElement.dataset.reading')) === look, 3000);
    for (const panelOpen of [false, true]) {
      await js(`PastelTerm.sessionsPanel.setOpen(${panelOpen})`);
      await wait(400);
      const label = `${width}x${height} ${look} panel ${panelOpen ? 'open' : 'shut'}`;
      const m: Measure = await js(MEASURE);
      log(`${m.coveredCount === 0 ? 'ok' : 'FAIL'} divider ${label}: nothing covers it, ${m.coveredCount} covered points ${JSON.stringify(m.covered)}`);
      await dragCase(kit, win, label, 'real');
      await dragCase(kit, win, label, 'synthetic');
      if (look === 'newspaper') await capture(`divider-${width}-${panelOpen ? 'panel' : 'shut'}`);
    }
  }
}

const valueNow = (kit: Kit): Promise<number> => kit.js("Number(document.getElementById('divider').getAttribute('aria-valuenow'))");

// Grab in the invisible reach, double-click back to 65/35, and arrow keys.
async function handlingCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, log, wait } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} divider ${what}`);
  const x = Math.round(win.getContentSize()[0] / 2);
  const doubleClick = (y: number) => {
    for (const clickCount of [1, 2]) {
      for (const type of ['mouseDown', 'mouseUp'] as const) win.webContents.sendInputEvent({ type, x, y: Math.round(y), button: 'left', clickCount });
    }
  };

  const start: Measure = await js(MEASURE);
  const reach = await js(`(() => { const d = document.getElementById('divider').getBoundingClientRect(); const hit = (y) => document.elementFromPoint(${x}, y)?.id; return { above: hit(d.top - 4), below: hit(d.bottom + 4), outside: hit(d.top - 7) }; })()`);
  check(reach.above === 'divider' && reach.below === 'divider' && reach.outside !== 'divider', `grabs 4px above and below its line, not 7px: ${JSON.stringify(reach)}`);
  await realDrag(kit, win, { ...start, divider: { ...start.divider, centre: start.divider.top - 4 } }, start.appTop + 0.4 * start.appHeight);
  await wait(350);
  const grabbed: Measure = await js(MEASURE);
  check(Math.abs(grabbed.terminalPane - expectedPane(start, 0.4)) <= HEIGHT_TOLERANCE_PX, `drag from 4px above the line: pane ${grabbed.terminalPane}px, want ${Math.round(expectedPane(start, 0.4))}`);

  doubleClick(grabbed.divider.centre);
  await wait(350);
  const defaults: Measure = await js(MEASURE);
  check((await valueNow(kit)) === 65 && Math.abs(defaults.terminalPane - expectedPane(start, 0.65)) <= HEIGHT_TOLERANCE_PX, `double-click resets to 65/35: valuenow ${await valueNow(kit)}, pane ${defaults.terminalPane}px`);

  await js("document.getElementById('divider').focus()");
  const keys = async (keyCode: string, times: number) => {
    for (let i = 0; i < times; i++) {
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
    }
    await wait(300);
  };
  await keys('Up', 5);
  const up = await valueNow(kit);
  await keys('Down', 10);
  const down = await valueNow(kit);
  await keys('Home', 1);
  const home = await valueNow(kit);
  const role = await js("(() => { const d = document.getElementById('divider'); return { role: d.getAttribute('role'), tabIndex: d.tabIndex, focused: document.activeElement === d }; })()");
  check(up === 55 && down === 75 && home >= 20 && home < 55 && role.role === 'separator' && role.tabIndex === 0 && role.focused, `keyboard: 65 → Up×5 ${up} → Down×10 ${down} → Home ${home}, ${JSON.stringify(role)}`);
  await js("document.getElementById('divider').blur()");

  // Saved per window in config.json: this window is slot 0.
  const saved = async () => { await wait(700); return { file: configStore.load().layout.splits['0'], page: await js('window.pastel.layout.getSplit()') }; };
  const before: Measure = await js(MEASURE);
  await realDrag(kit, win, before, before.appTop + 0.4 * before.appHeight);
  const dragged = await saved();
  check(Math.abs(dragged.file - 0.4) < 0.01 && dragged.page === dragged.file, `drag saves the split to config.json: ${JSON.stringify(dragged)}`);
  doubleClick((await js(MEASURE)).divider.centre); // later steps expect the default split
  const reset = await saved();
  check(reset.file === 0.65 && reset.page === 0.65, `double-click saves 65/35: ${JSON.stringify(reset)}`);
}

export async function dividerCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, log } = kit;
  const [startWidth, startHeight] = win.getContentSize();
  log(`divider starts at ${await valueNow(kit)}% reader, saved ${JSON.stringify(configStore.load().layout.splits)}`);
  await js('PastelTerm.getStarted.close()'); // her state: Get started is long gone
  await js("PastelTerm.reader.setView('replies')");
  for (const [width, height] of [[1280, 900], [800, 700]] as const) await looksAtSize(kit, win, width, height);
  await js('PastelTerm.sessionsPanel.setOpen(false)');
  await js("window.pastel.look.setReading('newspaper')");
  resizeOffscreen(win, 1280, 900);
  await kit.waitFor(async () => (await js('window.innerHeight')) === 900, 3000);
  await handlingCheck(kit, win);
  resizeOffscreen(win, startWidth, startHeight);
}

// #reader-area clips (so nothing paints over the divider): anything shown inside it must fit whole.
export async function unclippedCheck(kit: Kit, what: string, selector: string): Promise<void> {
  const fit = await kit.js(`(() => {
    const area = document.getElementById('reader-area').getBoundingClientRect();
    const shown = [...document.querySelectorAll(${JSON.stringify(selector)})].filter((el) => el.getBoundingClientRect().height > 0);
    const cut = shown.map((el) => el.getBoundingClientRect()).filter((r) => r.top < area.top - 1 || r.bottom > area.bottom + 1 || r.left < area.left - 1 || r.right > area.right + 1)
      .map((r) => ({ top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) }));
    return { shown: shown.length, cut, area: { top: Math.round(area.top), bottom: Math.round(area.bottom) } };
  })()`);
  kit.log(`${fit.shown > 0 && fit.cut.length === 0 ? 'ok' : 'FAIL'} not clipped by the reader area: ${what} ${JSON.stringify(fit)}`);
}

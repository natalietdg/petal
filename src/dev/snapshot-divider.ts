// Divider drag: real mouse input and synthesized pointer events move the split, in every look, Sessions panel shut and open.
import type { BrowserWindow } from 'electron';
import type { Kit } from './snapshot';
import { resizeOffscreen } from '../main/snapshot-window';
import { READING_CHOICES } from '../main/menu';

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
  const fraction = Math.min(0.85, Math.max(0.2, m.chrome / rows, target));
  return (1 - fraction) * rows;
}

async function realDrag(kit: Kit, win: BrowserWindow, m: Measure, toY: number): Promise<void> {
  const x = Math.round(win.getContentSize()[0] / 2);
  const fromY = Math.round(m.divider.centre);
  const send = (type: 'mouseDown' | 'mouseMove' | 'mouseUp', y: number) =>
    win.webContents.sendInputEvent({ type, x, y: Math.round(y), button: 'left', clickCount: 1, modifiers: type === 'mouseMove' ? ['leftButtonDown'] : [] });
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

export async function dividerCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, log, waitFor, wait, capture } = kit;
  const [startWidth, startHeight] = win.getContentSize();
  await js('PastelTerm.welcome.close()');
  for (const [width, height] of [[1280, 900], [800, 700]] as const) {
  resizeOffscreen(win, width, height);
  await waitFor(async () => (await js('window.innerHeight')) === height, 3000);
  log(`divider window ${width}x${height}`);
  for (const [look] of READING_CHOICES) {
    await js(`window.pastel.look.setReading(${JSON.stringify(look)})`);
    await waitFor(async () => (await js('document.documentElement.dataset.reading')) === look, 3000);
    for (const panelOpen of [false, true]) {
      await js(`PastelTerm.sessionsPanel.setOpen(${panelOpen})`);
      await wait(400);
      const label = `${look} panel ${panelOpen ? 'open' : 'shut'}`;
      const m: Measure = await js(MEASURE);
      log(`${m.coveredCount === 0 ? 'ok' : 'FAIL'} divider ${label}: nothing covers it, ${m.coveredCount} covered points ${JSON.stringify(m.covered)}`);
      await dragCase(kit, win, label, 'real');
      await dragCase(kit, win, label, 'synthetic');
      if (look === 'newspaper') await capture(`divider-${panelOpen ? 'panel' : 'shut'}`);
    }
  }
  }
  await js('PastelTerm.sessionsPanel.setOpen(false)');
  await js("window.pastel.look.setReading('newspaper')");
  resizeOffscreen(win, startWidth, startHeight);
}

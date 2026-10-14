// Minimise: the headers fold to a thin strip (⌘⇧H) and the terminal to its tab strip (⌘R, or the divider dragged to the bottom).
// Each persists in config.json and restores the layout exactly; Focus over a minimised terminal comes back minimised.
import type { BrowserWindow } from 'electron';
import type { Kit, TabsDeps } from './snapshot';
import * as configStore from '../main/config-store';

const PX = 2; // layout tolerance

const MEASURE = `(() => {
  const h = (id) => Math.round(document.getElementById(id).getBoundingClientRect().height);
  const shown = (el) => Boolean(el) && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none';
  const app = document.getElementById('app');
  const inTerminal = document.getElementById('terminal').contains(document.activeElement);
  return {
    dock: h('sessions-dock'), readerArea: h('reader-area'), reader: h('reader'), pane: h('terminal-pane'), strip: h('tab-strip'), terminal: h('terminal'),
    head: shown(document.getElementById('reader-head')),
    dockButtons: ['customize-button', 'workflow-button', 'history-button', 'board-button', 'add-session-button'].filter((id) => shown(document.getElementById(id))),
    sessionsPill: shown(document.getElementById('sessions-pill')),
    updateDot: (() => { const p = document.getElementById('update-pill'); return shown(p) ? Math.round(p.getBoundingClientRect().width) : null; })(),
    headersButton: { shown: shown(document.getElementById('headers-min-toggle')), expanded: document.getElementById('headers-min-toggle').getAttribute('aria-expanded') },
    termButton: { shown: shown(document.getElementById('term-min-toggle')), expanded: document.getElementById('term-min-toggle').getAttribute('aria-expanded') },
    inline: app.style.gridTemplateRows, grid: getComputedStyle(app).gridTemplateRows, valueNow: document.getElementById('divider').getAttribute('aria-valuenow'),
    focusInTerminal: inTerminal, focusId: document.activeElement?.id ?? null,
  };
})()`;

// any: MEASURE's shape is built in the script above.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Measure = any;

async function headersCheck(kit: Kit, win: BrowserWindow): Promise<void> {
  const { js, log, wait, waitFor, capture } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} minimise headers: ${what}`);
  const updateWasHidden = await js("document.getElementById('update-pill').hidden");
  await js("PastelTerm.updatePill.show('1.0.7')"); // the dot must survive the fold; show takes the ready version
  await wait(200);
  const before: Measure = await js(MEASURE);
  await js("document.getElementById('headers-min-toggle').click()");
  await wait(300);
  const min: Measure = await js(MEASURE);
  check(!min.head && min.dockButtons.length === 0 && min.dock < before.dock && min.dock <= 40,
    `dock and reader header hidden, dock a thin strip: ${JSON.stringify({ head: min.head, buttons: min.dockButtons, dock: `${before.dock}→${min.dock}px` })}`);
  check(min.headersButton.shown && min.headersButton.expanded === 'false' && min.sessionsPill && min.updateDot !== null && min.updateDot <= 14,
    `strip keeps restore, sessions count and an update dot: ${JSON.stringify({ button: min.headersButton, pill: min.sessionsPill, dot: min.updateDot })}`);
  check(min.reader > before.reader && min.readerArea === before.readerArea, `reader grows ${before.reader}→${min.reader}px inside the same area`);
  await capture('headers-minimised');

  check(await waitFor(() => configStore.load().reader.headersMinimised || null, 3000), 'saved to config');
  await js('PastelTerm.headersMin.set(false, false)');
  await js('PastelTerm.headersMin.restore()');
  check(await js('PastelTerm.headersMin.isMinimised()'), 'a config re-read brings it back minimised');

  win.webContents.send('headers:toggle'); // View > Minimise Headers (⌘⇧H)
  await waitFor(async () => !(await js('PastelTerm.headersMin.isMinimised()')) || null, 2000);
  await wait(300);
  const back: Measure = await js(MEASURE);
  check(back.head && back.dockButtons.length === before.dockButtons.length && Math.abs(back.dock - before.dock) <= PX && Math.abs(back.reader - before.reader) <= PX && back.headersButton.expanded === 'true',
    `⌘⇧H restores exactly: dock ${back.dock}/${before.dock}px, reader ${back.reader}/${before.reader}px`);
  check(await waitFor(() => configStore.load().reader.headersMinimised === false || null, 3000), 'restore saved to config');
  if (updateWasHidden) await js('PastelTerm.updatePill.reset()');
}

async function terminalCheck(kit: Kit, win: BrowserWindow, { activeSession }: TabsDeps): Promise<void> {
  const { js, log, wait, waitFor, capture } = kit;
  const check = (ok: unknown, what: string) => log(`${ok ? 'ok' : 'FAIL'} minimise terminal: ${what}`);
  await js('PastelTerm.tabs.active().term.focus()');
  const before: Measure = await js(MEASURE);
  await js("document.getElementById('term-min-toggle').click()");
  await wait(400);
  const min: Measure = await js(MEASURE);
  check(min.terminal === 0 && Math.abs(min.pane - min.strip) <= PX && min.pane < 60 && min.termButton.shown && min.termButton.expanded === 'false',
    `only the tab strip shows: ${JSON.stringify({ pane: `${before.pane}→${min.pane}px`, strip: min.strip, terminal: min.terminal, button: min.termButton })}`);
  check(min.readerArea > before.readerArea && min.inline === before.inline, `reader fills ${before.readerArea}→${min.readerArea}px, split kept underneath "${min.inline}"`);
  check(!min.focusInTerminal && min.focusId === 'composer-input', `focus moved to the reply box: ${min.focusId}`);
  await js("window.dispatchEvent(new Event('petal:focus-terminal')); PastelTerm.tabs.activate(PastelTerm.tabs.active().id)");
  check(!(await js(MEASURE)).focusInTerminal, 'focus requests and tab switches never land in the hidden xterm');
  check(await waitFor(() => configStore.load().layout.terminalMinimised || null, 3000), 'saved to config');
  await capture('terminal-minimised');

  // The reply box still sends to the active tab.
  const session = activeSession(win.webContents.id);
  if (!session) throw new Error('minimise check: no active tab');
  let output = '';
  const listener = session.pty.onData((data) => { output += data; });
  await js("(() => { const box = document.getElementById('composer-input'); box.value = 'echo minimised-ok-' + (6 * 7); box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()");
  check(await waitFor(() => (/minimised-ok-42/.test(output) ? true : null), 8000), 'reply box sends to the active tab');
  listener.dispose();

  // Focus over a minimised terminal returns to minimised.
  await js('PastelTerm.focusMode.set(true)');
  await wait(300);
  await js('PastelTerm.focusMode.set(false)');
  await wait(300);
  const afterFocus: Measure = await js(MEASURE);
  check(afterFocus.grid === min.grid && afterFocus.inline === min.inline && afterFocus.terminal === 0 && !afterFocus.focusInTerminal,
    `Focus enter/exit comes back minimised: grid "${afterFocus.grid}" was "${min.grid}"`);

  // Re-read from config.
  await js('PastelTerm.layout.setTerminalMinimised(false, false)');
  await js('PastelTerm.layout.restoreTerminalMinimised()');
  await wait(300);
  check(await js('PastelTerm.layout.isTerminalMinimised()'), 'a config re-read brings it back minimised');

  await js("document.getElementById('term-min-toggle').click()");
  await wait(400);
  const back: Measure = await js(MEASURE);
  check(back.inline === before.inline && back.valueNow === before.valueNow && Math.abs(back.pane - before.pane) <= PX && back.focusInTerminal,
    `restore returns the exact split: ${JSON.stringify({ inline: back.inline, was: before.inline, valueNow: `${back.valueNow}/${before.valueNow}`, pane: `${back.pane}/${before.pane}px`, focusInTerminal: back.focusInTerminal })}`);
  check(await waitFor(() => configStore.load().layout.terminalMinimised === false || null, 3000), 'restore saved to config');

  // The divider dragged to the bottom snaps minimised; the split saved before the drag stays.
  const savedSplit = configStore.load().layout.splits['0'];
  await js(`(() => {
    const divider = document.getElementById('divider');
    const app = document.getElementById('app').getBoundingClientRect();
    const d = divider.getBoundingClientRect();
    const x = window.innerWidth / 2;
    const fire = (type, y) => divider.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: 'mouse', isPrimary: true, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true }));
    fire('pointerdown', d.top + d.height / 2);
    fire('pointermove', app.top + app.height * 0.9);
    fire('pointermove', app.bottom - 2);
    fire('pointerup', app.bottom - 2);
  })()`);
  await wait(800);
  const snapped: Measure = await js(MEASURE);
  check(snapped.terminal === 0 && snapped.inline === before.inline && configStore.load().layout.splits['0'] === savedSplit,
    `drag to the bottom snaps minimised, split untouched: ${JSON.stringify({ terminal: snapped.terminal, inline: snapped.inline, split: configStore.load().layout.splits['0'], savedSplit })}`);
  win.webContents.send('layout:toggle'); // View > Minimise Terminal (⌘R)
  await wait(400);
  const restored: Measure = await js(MEASURE);
  check(restored.inline === before.inline && restored.valueNow === before.valueNow && Math.abs(restored.pane - before.pane) <= PX,
    `⌘R restores the split from before the drag: ${restored.inline}, ${restored.valueNow}%`);
}

export async function minimiseCheck(kit: Kit, win: BrowserWindow, tabs: TabsDeps): Promise<void> {
  await kit.js('PastelTerm.welcome.close()');
  await kit.js('PastelTerm.focusMode.set(false)');
  await headersCheck(kit, win);
  await terminalCheck(kit, win, tabs);
}

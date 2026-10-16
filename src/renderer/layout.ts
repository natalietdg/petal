import { byId, el, isIpcError } from './dom';
import { CLAUDE_SETUP_ROWS, READER_SPLIT, clampSplit, readerShareForRows } from '../shared/reader-split';

const app = byId('app');
const divider = byId('divider');
const KEY_STEP = 0.02;
const PAGE_STEP = 0.1;
const SAVE_DELAY_MS = 300; // held arrow keys save once
const SNAP_MINIMISED = 0.95; // a drag released this low folds the terminal away
let readerFraction: number = READER_SPLIT.initial;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let chosenSplit = false; // she dragged, keyed or reset the divider, or a saved split came back
let setupRoom = false; // a new user: Claude Code's first-run screens are on screen
let rowPx = 33; // one terminal row at 16px × 1.5 in Petal's mono font; the terminal reports the real one
let rowsShown = 0; // the terminal's rows when it last reported

// The reader's fixed bands (dock, header, prompts, reply box); the split never squeezes the reader below them.
const CHROME = ['sessions-dock', 'reader-head', 'prompt-dock', 'composer'].map(byId);

function chromeHeight(): number {
  return CHROME.reduce((sum, el) => sum + el.offsetHeight, 0);
}

// Clamped to the bounds, and to the reader's fixed bands at this window height.
function shownFraction(): number {
  const rows = app.clientHeight - divider.offsetHeight;
  const chromeFloor = rows > 0 ? chromeHeight() / rows : 0;
  const wanted = setupRoom && !chosenSplit ? readerShareForRows(CLAUDE_SETUP_ROWS, paneSize(rows)) : readerFraction;
  return clampSplit(Math.max(chromeFloor, wanted));
}

// Everything in the pane but its rows: tab strip, padding, and the part-row fit leaves over.
function paneSize(totalPx: number) {
  const pane = byId('terminal-pane').offsetHeight;
  return { totalPx, rowPx, paneExtraPx: rowsShown > 0 ? pane - rowsShown * rowPx : pane - byId('terminal').offsetHeight };
}

// The terminal's rows and measured row height, so the setup room is counted in real rows.
export function noteTerminalRows(rows: number, px: number): void {
  if (!(px > 0) || rows <= 0 || (rows === rowsShown && Math.abs(px - rowPx) < 0.5)) return;
  rowsShown = rows;
  rowPx = px;
  if (setupRoom) applySplit();
}

// Get started turns this on for a new user and off once sign-in is behind her; a split she chose always wins.
export function makeRoomForClaudeSetup(on: boolean): void {
  if (on === setupRoom) return;
  setupRoom = on;
  applySplit();
}

function applySplit(): void {
  const shown = shownFraction();
  const reader = Math.round(shown * 1000);
  app.style.gridTemplateRows = `minmax(0, ${reader}fr) auto minmax(0, ${1000 - reader}fr)`;
  divider.setAttribute('aria-valuenow', String(Math.round(shown * 100)));
}

function setSplit(fraction: number): void {
  readerFraction = clampSplit(fraction);
  applySplit();
}

function saveSplit(): void {
  chosenSplit = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void window.pastel.layout.saveSplit(readerFraction), SAVE_DELAY_MS);
}

// Minimised: the terminal folds to its tab strip (reader-only rows, layout.css); the split stays put for restore.
const minimiseButton = el('button', 'term-min-button');
minimiseButton.type = 'button';
minimiseButton.id = 'term-min-toggle';
minimiseButton.setAttribute('aria-controls', 'terminal');
byId('tab-strip').append(minimiseButton); // last in the strip; tabs.ts inserts tabs before its +
const minimiseListeners = new Set<(minimised: boolean) => void>();

const ICON = (path: string): string =>
  `<svg class="dock-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
const MINIMISE_ICON = ICON('M6 9l6 6 6-6');
const RESTORE_ICON = ICON('M6 15l6-6 6 6');

export const isTerminalMinimised = (): boolean => app.classList.contains('reader-only');
export const onTerminalMinimised = (listener: (minimised: boolean) => void): void => { minimiseListeners.add(listener); };

export function setTerminalMinimised(minimised: boolean, persist = true): void {
  const changed = minimised !== isTerminalMinimised();
  app.classList.toggle('reader-only', minimised);
  minimiseButton.setAttribute('aria-expanded', String(!minimised));
  minimiseButton.title = minimised ? 'Show the terminal again (⌘R)' : 'Minimise the terminal to its tabs (⌘R)';
  minimiseButton.innerHTML = `${minimised ? RESTORE_ICON : MINIMISE_ICON}<span>${minimised ? 'Terminal' : 'Minimise'}</span>`;
  applySplit();
  if (persist) void window.pastel.config.save({ layout: { terminalMinimised: minimised } });
  if (changed) for (const listener of minimiseListeners) listener(minimised);
}

export const toggleTerminalMinimised = (): void => setTerminalMinimised(!isTerminalMinimised());
minimiseButton.addEventListener('click', toggleTerminalMinimised);

divider.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  event.preventDefault(); // no text selection while dragging
  divider.setPointerCapture(event.pointerId);
  const before = readerFraction;
  let moved = false;
  let snapped = false;
  const onMove = (move: PointerEvent) => {
    const box = app.getBoundingClientRect();
    const fraction = (move.clientY - box.top) / box.height;
    snapped = fraction >= SNAP_MINIMISED;
    setSplit(fraction);
    moved = true;
  };
  const end = () => {
    // Dragged to the bottom: minimise, and keep the split from before the drag for restore.
    if (snapped) {
      setSplit(before);
      setTerminalMinimised(true);
    } else if (moved) saveSplit();
    divider.removeEventListener('pointermove', onMove);
    divider.removeEventListener('pointerup', end);
    divider.removeEventListener('pointercancel', end);
  };
  divider.addEventListener('pointermove', onMove);
  divider.addEventListener('pointerup', end);
  divider.addEventListener('pointercancel', end);
});

divider.addEventListener('dblclick', () => {
  setSplit(READER_SPLIT.initial);
  saveSplit();
});

// Up and down move the line; steps start from where it shows, so a raised floor never eats a press.
const KEY_MOVES: Record<string, (shown: number) => number> = {
  ArrowUp: (shown) => shown - KEY_STEP,
  ArrowDown: (shown) => shown + KEY_STEP,
  PageUp: (shown) => shown - PAGE_STEP,
  PageDown: (shown) => shown + PAGE_STEP,
  Home: () => READER_SPLIT.min,
  End: () => READER_SPLIT.max,
};
divider.addEventListener('keydown', (event) => {
  const move = KEY_MOVES[event.key];
  if (!move) return;
  event.preventDefault();
  setSplit(move(shownFraction()));
  saveSplit();
});

// A band growing (a prompt, a longer reply box) or the window shrinking re-checks the floor.
const observer = new ResizeObserver(applySplit);
for (const el of [app, ...CHROME]) observer.observe(el);
applySplit();

// This window's saved split and whether the terminal was minimised; a failed read keeps the defaults.
void window.pastel.layout.getSplit().then((saved) => {
  if (typeof saved !== 'number') return;
  chosenSplit = true;
  setSplit(saved);
});
// Reads the saved choice again; runs at startup.
export async function restoreTerminalMinimised(): Promise<void> {
  const result = await window.pastel.config.get();
  if (!isIpcError(result)) setTerminalMinimised(result.config.layout.terminalMinimised, false);
}
setTerminalMinimised(false, false);
void restoreTerminalMinimised();

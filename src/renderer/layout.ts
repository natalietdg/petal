import { byId } from './dom';
import { READER_SPLIT, clampSplit } from '../shared/reader-split';

const app = byId('app');
const divider = byId('divider');
const KEY_STEP = 0.02;
const PAGE_STEP = 0.1;
const SAVE_DELAY_MS = 300; // held arrow keys save once
let readerFraction: number = READER_SPLIT.initial;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

// The reader's fixed bands (dock, header, prompts, reply box); the split never squeezes the reader below them.
const CHROME = ['sessions-dock', 'reader-head', 'prompt-dock', 'composer'].map(byId);

function chromeHeight(): number {
  return CHROME.reduce((sum, el) => sum + el.offsetHeight, 0);
}

// Clamped to the bounds, and to the reader's fixed bands at this window height.
function shownFraction(): number {
  const rows = app.clientHeight - divider.offsetHeight;
  const chromeFloor = rows > 0 ? chromeHeight() / rows : 0;
  return clampSplit(Math.max(chromeFloor, readerFraction));
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
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void window.pastel.layout.saveSplit(readerFraction), SAVE_DELAY_MS);
}

export function toggleReaderOnly(): void {
  app.classList.toggle('reader-only');
}

divider.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  event.preventDefault(); // no text selection while dragging
  divider.setPointerCapture(event.pointerId);
  let moved = false;
  const onMove = (move: PointerEvent) => {
    const box = app.getBoundingClientRect();
    setSplit((move.clientY - box.top) / box.height);
    moved = true;
  };
  const end = () => {
    if (moved) saveSplit();
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

// This window's saved split; a failed read keeps the default.
void window.pastel.layout.getSplit().then((saved) => {
  if (typeof saved === 'number') setSplit(saved);
});

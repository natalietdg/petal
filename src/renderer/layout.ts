import { byId } from './dom';

const app = byId('app');
const divider = byId('divider');
const MIN_FRACTION = 0.2;
const MAX_FRACTION = 0.85;
let readerFraction = 0.65;

// The reader's fixed bands (dock, header, prompts, reply box); the split never squeezes the reader below them.
const CHROME = ['sessions-dock', 'reader-head', 'prompt-dock', 'composer'].map(byId);

function chromeHeight(): number {
  return CHROME.reduce((sum, el) => sum + el.offsetHeight, 0);
}

// Clamped to the bounds, and to the reader's fixed bands at this window height.
function shownFraction(): number {
  const rows = app.clientHeight - divider.offsetHeight;
  const chromeFloor = rows > 0 ? chromeHeight() / rows : 0;
  return Math.min(MAX_FRACTION, Math.max(MIN_FRACTION, chromeFloor, readerFraction));
}

function applySplit(): void {
  const reader = Math.round(shownFraction() * 1000);
  app.style.gridTemplateRows = `minmax(0, ${reader}fr) auto minmax(0, ${1000 - reader}fr)`;
}

export function toggleReaderOnly(): void {
  app.classList.toggle('reader-only');
}

divider.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  event.preventDefault(); // no text selection while dragging
  divider.setPointerCapture(event.pointerId);
  const onMove = (move: PointerEvent) => {
    const box = app.getBoundingClientRect();
    readerFraction = Math.min(MAX_FRACTION, Math.max(MIN_FRACTION, (move.clientY - box.top) / box.height));
    applySplit();
  };
  const end = () => {
    divider.removeEventListener('pointermove', onMove);
    divider.removeEventListener('pointerup', end);
    divider.removeEventListener('pointercancel', end);
  };
  divider.addEventListener('pointermove', onMove);
  divider.addEventListener('pointerup', end);
  divider.addEventListener('pointercancel', end);
});

// A band growing (a prompt, a longer reply box) or the window shrinking re-checks the floor.
const observer = new ResizeObserver(applySplit);
for (const el of [app, ...CHROME]) observer.observe(el);
applySplit();

// Keeps the dock (#sessions-dock) to one row at any width by measuring, not breakpoints:
// full labels first, then tighter spacing, then icon-only dock buttons. A new dock button needs no numbers here.
import { byId } from './dom';

// A dock part with shorter forms of itself (the update pill), tried at every step before the dock tightens further.
export interface Shrinkable {
  tryForms(fits: () => boolean): boolean; // leaves the longest form that fits; false if none does
  squeeze(): void; // its last resort when even the tightest dock has no room
}

const ROW_TOLERANCE_PX = 4; // same as the snapshot's dock check
const STEPS = ['fit-snug', 'fit-tight', 'fit-icons']; // cumulative classes, loosest first; sessions.css styles each
const ICONS = 'fit-icons';
const dock = byId('sessions-dock');
const panel = byId('sessions-panel'); // lives inside the dock; its rows changing never moves the buttons
let shrinkable: Shrinkable | null = null;
let queued = false;

export function register(part: Shrinkable): void {
  shrinkable = part;
}

// Every shown button on one line, none past the dock or the window.
function isOneRow(): boolean {
  const box = dock.getBoundingClientRect();
  const right = Math.min(box.right, window.innerWidth) + 1;
  const rects = [...dock.children].filter((e) => e.tagName === 'BUTTON' && e.getClientRects().length).map((e) => e.getBoundingClientRect());
  const mid = (r: DOMRect) => (r.top + r.bottom) / 2;
  return rects.every((r) => Math.abs(mid(r) - mid(rects[0])) < ROW_TOLERANCE_PX && r.left >= box.left - 1 && r.right <= right);
}

function setStep(step: number): void {
  STEPS.forEach((name, i) => dock.classList.toggle(name, i < step));
}

// Icon-only buttons keep their label as the accessible name (a visually hidden span) and show it as a tooltip.
function labelTooltips(on: boolean): void {
  for (const button of dock.querySelectorAll<HTMLElement>('.dock-button')) {
    button.dataset.title ??= button.title; // the button's own hint, kept for after
    const label = button.querySelector('.dock-label')?.textContent ?? '';
    const own = button.dataset.title;
    if (on) button.title = own ? `${label} · ${own}` : label;
    else if (own) button.title = own;
    else button.removeAttribute('title');
  }
}

// One fit per frame, so a resize or a changed label never loops the observers.
function schedule(): void {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    fit();
  });
}

// A button shown, hidden, added or relabelled (the Sessions pill's count) can change what fits.
const watcher = new MutationObserver((records) => {
  if (records.some((r) => !panel.contains(r.target))) schedule();
});

const fits = (): boolean => (shrinkable ? shrinkable.tryForms(isOneRow) : isOneRow());

export function fit(): void {
  let step = 0;
  for (; step <= STEPS.length; step++) {
    setStep(step);
    if (fits()) break;
  }
  if (step > STEPS.length) shrinkable?.squeeze();
  labelTooltips(dock.classList.contains(ICONS));
  watcher.takeRecords(); // our own text and class changes are not news
}

export function init(): void {
  new ResizeObserver(schedule).observe(dock); // a wider window, or a wrap that grew the dock
  watcher.observe(dock, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
  fit();
}

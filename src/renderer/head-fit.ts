// Keeps the reader header's row (#reader-head) inside the window by measuring, like dock-fit.ts:
// full labels first, then snug buttons, then icon-only buttons. A new header button needs no numbers here.
import { byId, query } from './dom';

const STEPS = ['fit-snug', 'fit-icons']; // cumulative classes on .reader-head-end, loosest first; head-fit.css styles each
const ICONS = 'fit-icons';
const head = byId('reader-head');
const end = query(head, '.reader-head-end');
let queued = false;

// Same measure as the favorites snapshot: nothing in the header reaches past its own width.
const fits = (): boolean => head.scrollWidth - head.clientWidth <= 1;
const shown = (): boolean => head.getClientRects().length > 0;

function setStep(step: number): void {
  STEPS.forEach((name, i) => end.classList.toggle(name, i < step));
}

// Icon-only: the hidden label stays the accessible name and leads the tooltip.
// Buttons with an aria-label (Add to Library) name themselves and keep their own tooltip.
function labelTooltips(on: boolean): void {
  for (const button of end.querySelectorAll<HTMLElement>('button:not([aria-label]):has(> .head-label)')) {
    button.dataset.title ??= button.title; // the button's own hint, kept for after
    const label = button.querySelector('.head-label')?.textContent ?? '';
    const own = button.dataset.title;
    if (on) button.title = own ? `${label} · ${own}` : label;
    else if (own) button.title = own;
    else button.removeAttribute('title');
  }
}

export function fit(): void {
  if (!shown()) return; // hidden headers measure 0; refit when it shows again
  let step = 0;
  for (; step < STEPS.length; step++) {
    setStep(step);
    if (fits()) break;
  }
  setStep(step);
  labelTooltips(end.classList.contains(ICONS));
  watcher.takeRecords(); // our own class and title changes are not news
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

// A button shown, hidden or relabelled (the agents chip's count) can change what fits.
const watcher = new MutationObserver(schedule);

export function init(): void {
  const sizes = new ResizeObserver(schedule);
  sizes.observe(head); // window width, reading style padding, a Notes drawer's margin
  sizes.observe(end); // a theme's font, the docked cat's padding
  watcher.observe(end, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
  // The pet docking into the header (cat.ts toggles cat-docked) widens its slot without resizing the row.
  new MutationObserver(schedule).observe(byId('reader-area'), { attributes: true, attributeFilter: ['class'] });
  fit();
}

export const state = () => ({ step: STEPS.filter((name) => end.classList.contains(name)), over: head.scrollWidth - head.clientWidth });

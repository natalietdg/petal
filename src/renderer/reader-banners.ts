// One bar folds the reader's Doing / Recommend / Next strip, pinned conclusion and PRs tab away; remembered in Petal's config.
import { byId, el, isIpcError } from './dom';

const area = byId('reader-area');
const bar = el('button', 'banners-bar');
const names = el('span', 'banners-names');
const chevron = el('span', 'banners-chevron');
bar.type = 'button';
bar.id = 'reader-banners-bar';
bar.hidden = true;
chevron.setAttribute('aria-hidden', 'true');
bar.append(names, chevron);

export const isCollapsed = (): boolean => area.classList.contains('banners-collapsed');

export function setCollapsed(collapsed: boolean, persist = true): void {
  area.classList.toggle('banners-collapsed', collapsed);
  bar.setAttribute('aria-expanded', String(!collapsed));
  bar.title = collapsed ? 'Show the status lines, conclusion and PRs' : 'Hide the status lines, conclusion and PRs';
  chevron.textContent = collapsed ? '▸' : '▾';
  if (persist) void window.pastel.config.save({ reader: { bannersCollapsed: collapsed } });
}

// Reads the saved choice again; runs at startup.
export async function restore(): Promise<void> {
  const result = await window.pastel.config.get();
  if (!isIpcError(result)) setCollapsed(result.config.reader.bannersCollapsed, false);
}

let strip: HTMLElement | null = null;
let pin: HTMLElement | null = null;
let prs: HTMLElement | null = null;

// The bar sits just above the strip, in the reader's header.
export function attach(stripEl: HTMLElement, pinEl: HTMLElement, prsEl: HTMLElement): void {
  strip = stripEl;
  pin = pinEl;
  prs = prsEl;
  stripEl.before(bar);
}

// After each repaint: the bar names and controls exactly what it folds, and goes when there is nothing to fold.
export function paint(): void {
  const chips = strip && !strip.hidden ? [...strip.querySelectorAll('.status-chip')].map((chip) => chip.textContent ?? '') : [];
  const pinShown = Boolean(pin && !pin.hidden);
  const prsTab = prs && !prs.hidden ? prs.querySelector('.prs-tab-text')?.textContent : null;
  const shown = [...chips, ...(pinShown ? ['Conclusion'] : []), ...(prsTab ? [prsTab] : [])];
  const controls = [chips.length ? strip?.id : null, pinShown ? pin?.id : null, prsTab ? prs?.id : null].filter(Boolean);
  bar.hidden = shown.length === 0;
  names.textContent = shown.join(' · ');
  if (controls.length) bar.setAttribute('aria-controls', controls.join(' ')); else bar.removeAttribute('aria-controls');
}

bar.addEventListener('click', () => setCollapsed(!isCollapsed()));
setCollapsed(false, false);
void restore();

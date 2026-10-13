// One bar folds the reader's Doing / Recommend / Next strip and pinned conclusion away; remembered in Petal's config.
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
  bar.title = collapsed ? 'Show the status lines and conclusion' : 'Hide the status lines and conclusion';
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

// The bar sits just above the strip, in the reader's header.
export function attach(stripEl: HTMLElement, pinEl: HTMLElement): void {
  strip = stripEl;
  pin = pinEl;
  bar.setAttribute('aria-controls', `${stripEl.id} ${pinEl.id}`);
  stripEl.before(bar);
}

// After each repaint: the bar names what it folds, and goes when there is nothing to fold.
export function paint(): void {
  const chips = strip && !strip.hidden ? [...strip.querySelectorAll('.status-chip')].map((chip) => chip.textContent ?? '') : [];
  const shown = [...chips, ...(pin && !pin.hidden ? ['Conclusion'] : [])];
  bar.hidden = shown.length === 0;
  names.textContent = shown.join(' · ');
}

bar.addEventListener('click', () => setCollapsed(!isCollapsed()));
setCollapsed(false, false);
void restore();

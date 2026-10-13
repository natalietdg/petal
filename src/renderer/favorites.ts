// Starred sessions: one set saved in config.json, and every star on the page (History rows, preview, reader) follows it.
import { byId, el, isIpcError } from './dom';
import { toggled } from '../shared/favorites';

let favorites: string[] = [];
const listeners = new Set<() => void>();

export const isFavorite = (sessionId: string): boolean => favorites.includes(sessionId);
export const ids = (): readonly string[] => favorites;
export const onChange = (listener: () => void): void => { listeners.add(listener); };

// Outline when off, filled when starred; colours come from favorites.css.
export const STAR_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-2.9-5.4 2.9 1.1-6-4.5-4.2 6.1-.8z"/></svg>';

function paint(star: HTMLButtonElement): void {
  const on = isFavorite(star.dataset.sessionId ?? '');
  star.setAttribute('aria-pressed', String(on));
  const label = on ? 'Remove from Favorites' : 'Add to Favorites';
  star.setAttribute('aria-label', label);
  star.title = label;
}

const paintAll = (): void => document.querySelectorAll<HTMLButtonElement>('.fav-star').forEach(paint);

function changed(): void {
  paintAll();
  for (const listener of listeners) listener();
}

let saves = 0;
export async function toggle(sessionId: string): Promise<void> {
  favorites = toggled(favorites, sessionId);
  changed();
  const ticket = ++saves;
  const saved = await window.pastel.config.save({ history: { favorites } });
  if (ticket !== saves || isIpcError(saved) || saved.history.favorites.join() === favorites.join()) return; // a newer click won
  favorites = saved.history.favorites; // what config.json kept wins
  changed();
}

// One click stars or unstars; never opens the row it sits on.
export function star(sessionId: string, className = ''): HTMLButtonElement {
  const button = el('button', `fav-star ${className}`.trim());
  button.type = 'button';
  button.dataset.sessionId = sessionId;
  button.innerHTML = STAR_SVG;
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    void toggle(sessionId);
  });
  paint(button);
  return button;
}

// The reader's star follows the shown tab's Claude session, or the last one it had once Claude ends.
const readerStar = byId<HTMLButtonElement>('reader-star');
const sessionByTab = new Map<string, string>();
readerStar.innerHTML = STAR_SVG;
readerStar.addEventListener('click', () => { if (readerStar.dataset.sessionId) void toggle(readerStar.dataset.sessionId); });

export function followReader(tabId: string, live: string | null): void {
  if (live) sessionByTab.set(tabId, live);
  const sessionId = live ?? sessionByTab.get(tabId) ?? '';
  readerStar.hidden = !sessionId;
  readerStar.dataset.sessionId = sessionId;
  paint(readerStar);
}

void window.pastel.config.get().then((result) => {
  if (isIpcError(result)) return;
  favorites = result.config.history.favorites;
  changed();
});

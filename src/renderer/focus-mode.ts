// Focus: one control, two levels. Click once for minimised headers, again for only the reply, again for the full layout.
// ⌘⇧H toggles the headers level and ⌘⇧F the reply-only level; Esc leaves reply-only. The headers level is remembered in Petal's config.
import { byId, isIpcError } from './dom';
import { focusReader } from './focus-reader';

export type FocusLevel = 'normal' | 'headers' | 'focus';

const NEXT: Record<FocusLevel, FocusLevel> = { normal: 'headers', headers: 'focus', focus: 'normal' };
const ARROW_UP = '<path d="M6 15l6-6 6 6"/>';
const CORNERS_OUT = '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>';
const CORNERS_IN = '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>';
// What a click does next, per level: its name, the keys that also do it, its icon and a visible word only where nothing else shows.
const FACE: Record<FocusLevel, { label: string; keys: string; icon: string; word: string }> = {
  normal: { label: 'Minimise the headers', keys: '⌘⇧H', icon: ARROW_UP, word: '' },
  headers: { label: 'Only the reply, filling the window', keys: '⌘⇧F', icon: CORNERS_OUT, word: '' },
  focus: { label: 'Back to the full layout', keys: 'Esc · ⌘⇧F', icon: CORNERS_IN, word: 'Exit focus' },
};

const app = byId('app');
const button = byId<HTMLButtonElement>('focus-toggle');
const reader = byId('reader');
const terminalPane = byId('terminal-pane');
const listeners = new Set<(on: boolean) => void>();

export function level(): FocusLevel {
  if (app.classList.contains('focus-mode')) return 'focus';
  return app.classList.contains('headers-min') ? 'headers' : 'normal';
}

// Reply-only, the level that hides the terminal.
export const isOn = (): boolean => level() === 'focus';

function paint(next: FocusLevel): void {
  const face = FACE[next];
  button.dataset.level = next;
  button.setAttribute('aria-label', face.label);
  button.title = `${face.label} (${face.keys})`;
  button.innerHTML = `<svg class="dock-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${face.icon}</svg>${face.word ? `<span>${face.word}</span>` : ''}`;
}

export function setLevel(next: FocusLevel, persist = true): void {
  const wasOn = isOn();
  app.classList.toggle('headers-min', next === 'headers');
  app.classList.toggle('focus-mode', next === 'focus');
  paint(next);
  if (persist && next !== 'focus') void window.pastel.config.save({ reader: { headersMinimised: next === 'headers' } }); // reply-only is never remembered
  if (next === 'focus' && !wasOn) focusReader<HTMLElement>(document.activeElement instanceof HTMLElement ? document.activeElement : null, terminalPane, reader);
  if (isOn() !== wasOn) for (const listener of listeners) listener(isOn());
}

export const cycle = (): void => setLevel(NEXT[level()]);
// A shortcut goes to its level, or back to the full layout when already there.
export const toggleLevel = (target: FocusLevel): void => setLevel(level() === target ? 'normal' : target);
export const onChange = (listener: (on: boolean) => void): void => { listeners.add(listener); };

// Reads the saved headers level again; runs at startup.
export async function restore(): Promise<void> {
  const result = await window.pastel.config.get();
  if (!isIpcError(result) && !isOn()) setLevel(result.config.reader.headersMinimised ? 'headers' : 'normal', false);
}

button.addEventListener('click', cycle);
// A handler that already used this Esc (preventDefault) keeps it.
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && isOn() && !event.defaultPrevented) setLevel('normal');
});
window.pastel.onToggleHeaders(() => toggleLevel('headers'));
window.pastel.onToggleFocus(() => toggleLevel('focus'));
paint(level());
void restore();

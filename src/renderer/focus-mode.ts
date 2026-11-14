// Focus: two dock controls named like the View menu. "Minimise headers" (⌘⇧H) and "Only the reply" (⌘⇧F) each toggle their own level.
// Esc leaves reply-only. The headers level is remembered in Petal's config.
import { byId, isIpcError } from './dom';
import { focusReader } from './focus-reader';

export type FocusLevel = 'normal' | 'headers' | 'focus';

const ARROW_UP = '<path d="M6 15l6-6 6 6"/>';
const CORNERS_OUT = '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>';
const CORNERS_IN = '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>';
const icon = (path: string): string => `<svg class="dock-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;

const app = byId('app');
const headersButton = byId<HTMLButtonElement>('focus-toggle');
const replyButton = document.createElement('button');
replyButton.id = 'focus-reply';
replyButton.className = 'focus-toggle focus-reply';
replyButton.type = 'button';
headersButton.after(replyButton);
const reader = byId('reader');
const terminalPane = byId('terminal-pane');
const listeners = new Set<(on: boolean) => void>();

export function level(): FocusLevel {
  if (app.classList.contains('focus-mode')) return 'focus';
  return app.classList.contains('headers-min') ? 'headers' : 'normal';
}

// Reply-only, the level that hides the terminal.
export const isOn = (): boolean => level() === 'focus';

// Each control keeps its name; aria-pressed says whether its level is on. Reply-only also shows a visible way back.
function paint(next: FocusLevel): void {
  headersButton.dataset.level = next;
  replyButton.dataset.level = next;
  headersButton.setAttribute('aria-label', 'Minimise headers');
  headersButton.setAttribute('aria-pressed', String(next === 'headers'));
  headersButton.title = next === 'headers' ? 'Show the headers again (⌘⇧H)' : 'Minimise headers (⌘⇧H)';
  headersButton.innerHTML = icon(ARROW_UP);
  const replyOnly = next === 'focus';
  replyButton.setAttribute('aria-label', replyOnly ? 'Exit focus' : 'Only the reply');
  replyButton.setAttribute('aria-pressed', String(replyOnly));
  replyButton.title = replyOnly ? 'Back to the full layout (Esc · ⌘⇧F)' : 'Only the reply (⌘⇧F)';
  replyButton.innerHTML = replyOnly ? `${icon(CORNERS_IN)}<span>Exit focus</span>` : icon(CORNERS_OUT);
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

// A shortcut goes to its level, or back to the full layout when already there.
export const toggleLevel = (target: FocusLevel): void => setLevel(level() === target ? 'normal' : target);
export const onChange = (listener: (on: boolean) => void): void => { listeners.add(listener); };

// Reads the saved headers level again; runs at startup.
export async function restore(): Promise<void> {
  const result = await window.pastel.config.get();
  if (!isIpcError(result) && !isOn()) setLevel(result.config.reader.headersMinimised ? 'headers' : 'normal', false);
}

headersButton.addEventListener('click', () => toggleLevel('headers'));
replyButton.addEventListener('click', () => toggleLevel('focus'));
// A handler that already used this Esc (preventDefault) keeps it.
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && isOn() && !event.defaultPrevented) setLevel('normal');
});
window.pastel.onToggleHeaders(() => toggleLevel('headers'));
window.pastel.onToggleFocus(() => toggleLevel('focus'));
paint(level());
void restore();

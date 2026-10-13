// Focus: only the reply, the reader filling the window. The header button, ⌘⇧F, Esc or Exit focus bring the rest back as it was.
import { byId } from './dom';

const app = byId('app');
const toggleButton = byId<HTMLButtonElement>('focus-toggle');
const exitButton = byId<HTMLButtonElement>('focus-exit');
const listeners = new Set<(on: boolean) => void>();

export const isOn = (): boolean => app.classList.contains('focus-mode');

export function set(on: boolean): void {
  if (on === isOn()) return;
  app.classList.toggle('focus-mode', on);
  toggleButton.setAttribute('aria-pressed', String(on));
  exitButton.hidden = !on;
  for (const listener of listeners) listener(on);
}

export const toggle = (): void => set(!isOn());
export const onChange = (listener: (on: boolean) => void): void => { listeners.add(listener); };

toggleButton.addEventListener('click', toggle);
exitButton.addEventListener('click', () => set(false));
// A handler that already used this Esc (preventDefault) keeps it.
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && isOn() && !event.defaultPrevented) set(false);
});
window.pastel.onToggleFocus(toggle);

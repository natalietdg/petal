// Minimised headers: the dock and the reader header fold to a thin strip (sessions count, update dot, restore); remembered in Petal's config.
import { byId, isIpcError } from './dom';

const app = byId('app');
const button = byId<HTMLButtonElement>('headers-min-toggle');
const ARROW_UP = 'M6 15l6-6 6 6';
const ARROW_DOWN = 'M6 9l6 6 6-6';

export const isMinimised = (): boolean => app.classList.contains('headers-min');

export function set(minimised: boolean, persist = true): void {
  app.classList.toggle('headers-min', minimised);
  button.setAttribute('aria-expanded', String(!minimised));
  const label = minimised ? 'Show the headers' : 'Minimise the headers';
  button.setAttribute('aria-label', label);
  button.title = `${label} (⌘⇧H)`;
  button.querySelector('path')?.setAttribute('d', minimised ? ARROW_DOWN : ARROW_UP);
  if (persist) void window.pastel.config.save({ reader: { headersMinimised: minimised } });
}

export const toggle = (): void => set(!isMinimised());

// Reads the saved choice again; runs at startup.
export async function restore(): Promise<void> {
  const result = await window.pastel.config.get();
  if (!isIpcError(result)) set(result.config.reader.headersMinimised, false);
}

button.addEventListener('click', toggle);
void restore();

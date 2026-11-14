// Customize › Advanced: shows or hides the power tools (Factory, Tasks, the testing loop, deploy order and the like).
// Hiding is UI only. Elements with the class "advanced-only" hide through CSS; code that builds rows asks isOn().
const listeners = new Set<(on: boolean) => void>();
let on = false;

export const isOn = (): boolean => on;

export function set(next: boolean): void {
  document.documentElement.dataset.advanced = next ? 'on' : 'off';
  if (next === on) return;
  on = next;
  for (const listener of listeners) listener(on);
}

// Runs now and on every change.
export function onChange(listener: (on: boolean) => void): () => void {
  listeners.add(listener);
  listener(on);
  return () => listeners.delete(listener);
}

window.pastel.onAdvanced(set);
document.documentElement.dataset.advanced = 'off';

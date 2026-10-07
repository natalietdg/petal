// History, Workflow, Customize and Open Repo are views over the reader, one at a time.
// Opening one closes the others; Esc closes it; the reader and reply box show only when none is open.
import { byId, focusTerminal } from './dom';

export type OverlayId = 'history' | 'workflow' | 'customize' | 'repos';

interface Overlay {
  view: HTMLElement;
  button?: HTMLElement; // Open Repo has no dock button, only ⌘O and the reply box
}

const OVERLAYS: Record<OverlayId, Overlay> = {
  history: { view: byId('history'), button: byId('history-button') },
  workflow: { view: byId('workflow'), button: byId('workflow-button') },
  customize: { view: byId('customize'), button: byId('customize-button') },
  repos: { view: byId('repos') },
};
const reader = byId('reader');
const composer = byId('composer');
let openId: OverlayId | null = null;

function render(): void {
  for (const [id, { view, button }] of Object.entries(OVERLAYS)) {
    view.hidden = id !== openId;
    button?.setAttribute('aria-pressed', String(id === openId));
  }
  reader.hidden = openId !== null;
  composer.hidden = openId !== null;
}

export function show(id: OverlayId): void {
  openId = id;
  render();
}

// Back to the reader; keys go to the shell, since whatever was clicked is gone.
export function hide(id: OverlayId): void {
  if (openId !== id) return;
  openId = null;
  render();
  focusTerminal();
}

export const isOpen = (id: OverlayId): boolean => openId === id;
export const current = (): OverlayId | null => openId;
export const hideCurrent = (): void => { if (openId) hide(openId); };

// Esc inside a prompt box stays there, so a half-edited prompt isn't lost by accident.
for (const [id, { view }] of Object.entries(OVERLAYS) as [OverlayId, Overlay][]) {
  view.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !(event.target as Element).matches('textarea')) hide(id);
  });
}

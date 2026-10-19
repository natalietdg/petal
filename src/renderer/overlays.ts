// History, Customize (with the Workflow tabs), Library, Testing and Open Repo are views over the reader, one at a time.
// Opening one closes the others; Esc closes it; the reader and reply box show only when none is open.
import { byId, focusTerminal } from './dom';

export type OverlayId = 'history' | 'customize' | 'repos' | 'get-started' | 'consent' | 'pet-guide' | 'board' | 'shortcuts' | 'library' | 'testing';

interface Overlay {
  view: HTMLElement;
  button?: HTMLElement; // Open Repo has no dock button, only ⌘O and the reply box
}

const OVERLAYS: Record<OverlayId, Overlay> = {
  history: { view: byId('history'), button: byId('history-button') },
  customize: { view: byId('customize'), button: byId('customize-button') },
  repos: { view: byId('repos') },
  'get-started': { view: byId('get-started') },
  consent: { view: byId('consent') },
  'pet-guide': { view: byId('pet-guide') },
  board: { view: byId('board'), button: byId('board-button') }, // also the Sessions panel's Board and ⌘⇧O
  shortcuts: { view: byId('shortcuts') },
  library: { view: byId('library'), button: byId('library-button') },
  testing: { view: byId('testing'), button: byId('testing-button') },
};
const reader = byId('reader');
const readerHead = byId('reader-head');
const composer = byId('composer');
let openId: OverlayId | null = null;
let lockedId: OverlayId | null = null; // a question that stays up until answered; other views wait behind it

function render(): void {
  for (const [id, { view, button }] of Object.entries(OVERLAYS)) {
    view.hidden = id !== openId;
    button?.setAttribute('aria-pressed', String(id === openId));
  }
  reader.hidden = openId !== null;
  readerHead.hidden = openId !== null;
  composer.hidden = openId !== null;
}

// False while a locked question is up: History, Customize and the rest open after she answers it.
export function show(id: OverlayId): boolean {
  if (lockedId && lockedId !== id) return false;
  openId = id;
  render();
  return true;
}

// Shows id and keeps it up until unlock(); only its own answer closes it.
export function showLocked(id: OverlayId): void {
  lockedId = null;
  show(id);
  lockedId = id;
}
export function unlock(id: OverlayId): void { if (lockedId === id) lockedId = null; }

// Back to the reader; keys go to the shell, since whatever was clicked is gone.
export function hide(id: OverlayId): void {
  if (openId !== id || lockedId === id) return;
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

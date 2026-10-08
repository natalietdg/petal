// History, Workflow, Customize, Open Repo and Agents are views over the reader, one at a time.
// Opening one closes the others; Esc closes it; the reader and reply box show only when none is open.
import { byId, focusTerminal } from './dom';

export type OverlayId = 'history' | 'workflow' | 'customize' | 'repos' | 'welcome' | 'agents';

interface Overlay {
  view: HTMLElement;
  button?: HTMLElement; // Open Repo has no dock button, only ⌘O and the reply box
}

const OVERLAYS: Record<OverlayId, Overlay> = {
  history: { view: byId('history'), button: byId('history-button') },
  workflow: { view: byId('workflow'), button: byId('workflow-button') },
  customize: { view: byId('customize'), button: byId('customize-button') },
  repos: { view: byId('repos') },
  welcome: { view: byId('welcome') },
  agents: { view: byId('agents') }, // opened from the header chip or a Sessions row
};
// A view with levels steps back first (Agents: timeline, then list); true when it did.
const backHandlers = new Map<OverlayId, () => boolean>();
// Told when a view stops showing, so it can let go of what it follows.
const closeHandlers = new Map<OverlayId, () => void>();
export const onBack = (id: OverlayId, handler: () => boolean): void => { backHandlers.set(id, handler); };
export const onClose = (id: OverlayId, handler: () => void): void => { closeHandlers.set(id, handler); };
const reader = byId('reader');
const readerHead = byId('reader-head');
const composer = byId('composer');
let openId: OverlayId | null = null;

function render(): void {
  for (const [id, { view, button }] of Object.entries(OVERLAYS)) {
    view.hidden = id !== openId;
    button?.setAttribute('aria-pressed', String(id === openId));
  }
  reader.hidden = openId !== null;
  readerHead.hidden = openId !== null;
  composer.hidden = openId !== null;
}

export function show(id: OverlayId): void {
  const was = openId;
  openId = id;
  render();
  if (was && was !== id) closeHandlers.get(was)?.();
}

// Back to the reader; keys go to the shell, since whatever was clicked is gone.
export function hide(id: OverlayId): void {
  if (openId !== id) return;
  openId = null;
  render();
  closeHandlers.get(id)?.();
  focusTerminal();
}

const back = (id: OverlayId): void => { if (!backHandlers.get(id)?.()) hide(id); };

export const isOpen = (id: OverlayId): boolean => openId === id;
export const current = (): OverlayId | null => openId;
export const hideCurrent = (): void => { if (openId) back(openId); };

// Esc inside a prompt box stays there, so a half-edited prompt isn't lost by accident.
for (const [id, { view }] of Object.entries(OVERLAYS) as [OverlayId, Overlay][]) {
  view.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !(event.target as Element).matches('textarea')) back(id);
  });
}

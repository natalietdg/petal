// A scene's hover tip and click-open card (Tarot Room's reading, Planetarium's planet of the day).
// They sit beside #cat, not in it, because cat.ts rebuilds #cat on every pet or scene change.
import { byId } from './dom';

export interface SceneCard {
  tip: HTMLElement;
  popover: HTMLElement;
  isOpen: () => boolean;
  close: () => void;
}

const cards: SceneCard[] = [];

// `scene` is the scene's selector inside #cat; `prefix` names its tip and popover (e.g. tarot-tip, tarot-popover).
export function sceneCard(scene: string, prefix: string, label: string): SceneCard {
  const cat = byId('cat');
  const tip = document.createElement('div');
  tip.className = `scene-tip ${prefix}-tip`;
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  const popover = document.createElement('div');
  popover.className = `scene-popover ${prefix}-popover`;
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', label);
  popover.hidden = true;
  cat.after(tip, popover);

  const onScene = (target: EventTarget | null): boolean => target instanceof Element && Boolean(target.closest(scene));
  const isOpen = (): boolean => !popover.hidden;
  const close = (): void => { popover.hidden = true; };
  const open = (): void => {
    tip.hidden = true;
    popover.hidden = false;
  };

  // Hover anywhere on the room (not the cat, who has her own tip) shows the tip.
  cat.addEventListener('mouseover', (event) => { tip.hidden = !onScene(event.target) || isOpen(); });
  cat.addEventListener('mouseleave', () => { tip.hidden = true; });
  cat.addEventListener('click', (event) => {
    if (!onScene(event.target)) return;
    if (isOpen()) close();
    else open();
  });
  // Dismiss on a click anywhere else, or Esc.
  document.addEventListener('click', (event) => {
    if (isOpen() && !onScene(event.target) && !popover.contains(event.target as Node)) close();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isOpen()) close();
  });

  const card = { tip, popover, isOpen, close };
  cards.push(card);
  return card;
}

// For the terminal's Esc handler, which sees the key before the document does.
export const anyOpen = (): boolean => cards.some((card) => card.isOpen());
export function closeAll(): void {
  for (const card of cards) card.close();
}

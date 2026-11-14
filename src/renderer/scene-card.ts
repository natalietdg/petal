// A scene's hover tip, and for Planetarium a click-open card with the planet of the day.
// They sit beside #cat, not in it, because cat.ts rebuilds #cat on every pet or scene change.
import { byId } from './dom';

export interface SceneCard {
  tip: HTMLElement;
  popover: HTMLElement;
  isOpen: () => boolean;
  close: () => void;
}

const cards: SceneCard[] = [];

const onSceneOf = (scene: string) => (target: EventTarget | null): boolean => target instanceof Element && Boolean(target.closest(scene));

function makeTip(prefix: string): HTMLElement {
  const tip = document.createElement('div');
  tip.className = `scene-tip ${prefix}-tip`;
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  return tip;
}

// A hover tip only, for scene art with nothing to open (Tarot Room's card name).
export function sceneTip(scene: string, prefix: string): HTMLElement {
  const cat = byId('cat');
  const tip = makeTip(prefix);
  cat.after(tip);
  const onScene = onSceneOf(scene);
  cat.addEventListener('mouseover', (event) => { tip.hidden = !onScene(event.target); });
  cat.addEventListener('mouseleave', () => { tip.hidden = true; });
  return tip;
}

// `scene` is the scene's selector inside #cat; `prefix` names its tip and popover (e.g. planet-tip, planet-popover).
export function sceneCard(scene: string, prefix: string, label: string): SceneCard {
  const cat = byId('cat');
  const tip = makeTip(prefix);
  const popover = document.createElement('div');
  popover.className = `scene-popover ${prefix}-popover`;
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', label);
  popover.hidden = true;
  cat.after(tip, popover);

  const onScene = onSceneOf(scene);
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

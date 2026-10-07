// Tarot Room's card of the day: picks which face the scene shows, a hover tip, and a click-open reading.
// The tip and popover sit beside #cat, not in it, because cat.ts rebuilds #cat on every pet or scene change.
import { byId } from './dom';
import { everyDay } from './scenes/daily';
import { cardForDay, type TarotCard } from './scenes/tarot-deck';

const cat = byId('cat');
const tip = document.createElement('div');
tip.className = 'tarot-tip';
tip.setAttribute('role', 'tooltip');
tip.hidden = true;
const popover = document.createElement('div');
popover.className = 'tarot-popover';
popover.setAttribute('role', 'dialog');
popover.setAttribute('aria-label', "Today's tarot card");
popover.hidden = true;
cat.after(tip, popover);

const el = (tag: string, className: string, text: string): HTMLElement => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  return node;
};

function show(card: TarotCard): void {
  document.documentElement.dataset.trCard = String(card.number);
  const title = `${card.numeral} · ${card.name}`;
  tip.replaceChildren(el('strong', '', title), el('div', '', card.reading));
  popover.replaceChildren(
    el('p', 'tarot-numeral', `${card.numeral} · Today's card`),
    el('h2', '', card.name),
    el('p', '', card.reading),
    el('p', 'tarot-date', new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })),
  );
}

const onScene = (target: EventTarget | null): boolean => target instanceof Element && Boolean(target.closest('.scene-tarot'));

export const isOpen = (): boolean => !popover.hidden;
export function close(): void {
  popover.hidden = true;
}
function open(): void {
  tip.hidden = true;
  popover.hidden = false;
}

// Hover anywhere on the room (not the cat, who has her own tip) shows the card's name and reading.
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

everyDay((day) => show(cardForDay(day)));

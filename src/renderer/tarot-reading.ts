// Tarot Room's card of the day: picks which face the scene shows, a hover tip, and a click-open reading.
// The tip and popover sit beside #cat, not in it, because cat.ts rebuilds #cat on every pet or scene change.
import { byId, isIpcError } from './dom';
import { everyDay } from './scenes/daily';
import { birthCard, cardForDay, type TarotCard } from './scenes/tarot-deck';

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

// The birth card's lines under the day's reading; none without a birthday.
function birthLines(card: TarotCard, birth: TarotCard | null): HTMLElement[] {
  if (!birth) return [];
  const lines = [el('p', 'tarot-birth', `Your birth card: ${birth.numeral} ${birth.name}`)];
  if (birth.number === card.number) lines.push(el('p', 'tarot-birth', 'Your own card turned up today.'));
  return lines;
}

function show(card: TarotCard, birth: TarotCard | null): void {
  document.documentElement.dataset.trCard = String(card.number);
  const title = `${card.numeral} · ${card.name}`;
  tip.replaceChildren(el('strong', '', title), el('div', '', card.reading));
  popover.replaceChildren(
    el('p', 'tarot-numeral', `${card.numeral} · Today's card`),
    el('h2', '', card.name),
    el('p', '', card.reading),
    ...birthLines(card, birth),
    el('p', 'tarot-date', new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })),
  );
}

let today: number | null = null;
let birthdate = '';
// With a birthday, the day's card is shifted by the birth card; without one, everyone shares the same card.
function render(): void {
  if (today === null) return;
  const birth = birthCard(birthdate);
  show(cardForDay(today, birth?.number ?? 0), birth);
}

// Customize calls this on save or Clear; '' goes back to the shared card.
export function setBirthdate(value: string): void {
  birthdate = value;
  render();
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

everyDay((day) => { today = day; render(); });
void window.pastel.config.get().then((state) => { if (!isIpcError(state)) setBirthdate(state.config.tarot.birthdate); });

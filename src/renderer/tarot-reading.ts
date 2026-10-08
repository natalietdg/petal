// Tarot Room's card of the day: picks which face the scene shows, a hover tip, and a click-open reading.
import { el, isIpcError } from './dom';
import { sceneCard } from './scene-card';
import { everyDay } from './scenes/daily';
import { birthCard, cardForDay, type TarotCard } from './scenes/tarot-deck';

const { tip, popover, isOpen, close } = sceneCard('.scene-tarot', 'tarot', "Today's tarot card");
export { isOpen, close };

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
    el('p', 'scene-kicker', `${card.numeral} · Today's card`),
    el('h2', '', card.name),
    el('p', '', card.reading),
    ...birthLines(card, birth),
    el('p', 'scene-date', new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })),
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

everyDay((day) => { today = day; render(); });
void window.pastel.config.get().then((state) => { if (!isIpcError(state)) setBirthdate(state.config.tarot.birthdate); });

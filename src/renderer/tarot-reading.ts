// Tarot Room's card of the day: picks which face the scene shows, a hover tip, and a click-open reading.
// Everyone shares the day's card; config tarot.birthdate is no longer read (kept so old configs load).
import { el } from './dom';
import { sceneCard } from './scene-card';
import { everyDay } from './scenes/daily';
import { cardForDay, type TarotCard } from './scenes/tarot-deck';

const { tip, popover, isOpen, close } = sceneCard('.scene-tarot', 'tarot', "Today's tarot card");
export { isOpen, close };

function show(card: TarotCard): void {
  document.documentElement.dataset.trCard = String(card.number);
  const title = `${card.numeral} · ${card.name}`;
  tip.replaceChildren(el('strong', '', title), el('div', '', card.reading));
  popover.replaceChildren(
    el('p', 'scene-kicker', `${card.numeral} · Today's card`),
    el('h2', '', card.name),
    el('p', '', card.reading),
    el('p', 'scene-date', new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })),
  );
}

everyDay((day) => show(cardForDay(day)));

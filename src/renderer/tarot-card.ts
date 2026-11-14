// Tarot Room's card of the day: picks which face the scene shows, and a hover tip naming it. The card is scene art, with no reading.
// Everyone shares the day's card; config tarot.birthdate is no longer read (kept so old configs load).
import { sceneTip } from './scene-card';
import { everyDay } from './scenes/daily';
import { cardForDay, type TarotCard } from './scenes/tarot-deck';

const tip = sceneTip('.scene-tarot', 'tarot');

function show(card: TarotCard): void {
  document.documentElement.dataset.trCard = String(card.number);
  tip.textContent = `${card.numeral} · ${card.name}`;
}

everyDay((day) => show(cardForDay(day)));

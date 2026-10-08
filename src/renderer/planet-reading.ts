// Planetarium's planet of the day: picks which planet the dome shows, a hover tip, and a click-open card.
import { el } from './dom';
import { sceneCard } from './scene-card';
import { everyDay } from './scenes/daily';
import { planetLabel } from './scenes/planet-facts';

const { tip, popover } = sceneCard('.scene-planetarium', 'planet', "Today's planet");

function show(day: number): void {
  const { planet, tip: title, facts, tomorrow } = planetLabel(day);
  document.documentElement.dataset.plPlanet = planet;
  popover.dataset.planet = planet;
  tip.replaceChildren(el('strong', '', title));
  popover.replaceChildren(
    el('p', 'scene-kicker', "Today's planet"),
    el('h2', '', facts.name),
    ...facts.lines.map((line) => el('p', 'planet-line', line)),
    el('p', 'planet-tomorrow', tomorrow),
    el('p', 'scene-date', new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })),
  );
}

everyDay(show);

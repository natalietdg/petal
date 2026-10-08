// Planetarium's planet of the day in words: the name, two light facts (checked against NASA's planet pages), and tomorrow's planet.
import { type Planet, planetForDay } from './planetarium';

export interface PlanetFacts { name: string; lines: readonly [string, string] }

export const PLANET_FACTS: Record<Planet, PlanetFacts> = {
  mercury: { name: 'Mercury', lines: [
    'It zips around the Sun every 88 days, faster than any other planet.',
    'If Earth were a nickel, Mercury would be about the size of a blueberry.',
  ] },
  venus: { name: 'Venus', lines: [
    'One day here (243 Earth days) lasts longer than its whole year (225).',
    'It spins backwards, so the Sun rises in the west. A planet with its own ideas.',
  ] },
  earth: { name: 'Earth', lines: [
    'The only planet we know of with liquid water on its surface.',
    'Also the only place known to have living things, you included. Hello from home.',
  ] },
  mars: { name: 'Mars', lines: [
    'Its dusty soil is full of rusted iron, which is why it glows red.',
    'Olympus Mons, its giant volcano, stands more than 25 miles tall. Everest is about 5.5.',
  ] },
  jupiter: { name: 'Jupiter', lines: [
    'A whole day here takes only about 10 hours. Short days, big planet.',
    'The Great Red Spot is a storm twice as wide as Earth, still swirling after 300 years.',
  ] },
  saturn: { name: 'Saturn', lines: [
    'Its rings are billions of chunks of ice and rock, some as big as a house.',
    'It is less dense than water, so it could float, given a big enough bathtub.',
  ] },
  uranus: { name: 'Uranus', lines: [
    'It spins on its side, rolling around the Sun like a ball.',
    'The first planet ever found with a telescope, in 1781.',
  ] },
  neptune: { name: 'Neptune', lines: [
    'Its winds can blow at more than 1,200 miles an hour. Hold on to your hat.',
    'One Neptune year is about 165 Earth years, so birthdays are rare and very special.',
  ] },
};

// The words the Planetarium shows for a local day number (see daily.ts).
export function planetLabel(day: number): { planet: Planet; tip: string; facts: PlanetFacts; tomorrow: string } {
  const planet = planetForDay(day);
  return {
    planet,
    tip: `Today's planet · ${PLANET_FACTS[planet].name}`,
    facts: PLANET_FACTS[planet],
    tomorrow: `Tomorrow: ${PLANET_FACTS[planetForDay(day + 1)].name}`,
  };
}

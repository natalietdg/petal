import { describe, expect, it } from 'vitest';
import { localDayNumber } from '../src/renderer/scenes/daily';
import { PLANET_FACTS, planetLabel } from '../src/renderer/scenes/planet-facts';
import { PLANETS } from '../src/renderer/scenes/planetarium';

const dayOf = (y: number, m: number, d: number): number => localDayNumber(new Date(y, m - 1, d, 12));

describe('planet of the day words', () => {
  it('has all 8 planets in solar order, each with a name and two short lines, no em dashes', () => {
    expect(Object.keys(PLANET_FACTS)).toEqual([...PLANETS]);
    for (const planet of PLANETS) {
      const { name, lines } = PLANET_FACTS[planet];
      expect(name.toLowerCase()).toBe(planet);
      expect(lines).toHaveLength(2);
      for (const line of lines) {
        expect(line.length).toBeGreaterThan(30);
        expect(line.length).toBeLessThan(100);
        expect(line).not.toMatch(/[–—]/);
      }
    }
  });

  it('labels today and tomorrow, with the tip in the room style', () => {
    const label = planetLabel(dayOf(2026, 10, 8));
    expect(label.planet).toBe('jupiter');
    expect(label.tip).toBe("Today's planet · Jupiter");
    expect(label.facts.lines[0]).toContain('10 hours');
    expect(label.tomorrow).toBe('Tomorrow: Saturn');
  });

  it('steps from Earth to Mars and wraps Neptune back to Mercury', () => {
    expect(planetLabel(dayOf(2026, 10, 6))).toMatchObject({ planet: 'earth', tomorrow: 'Tomorrow: Mars' });
    expect(planetLabel(dayOf(2026, 10, 11))).toMatchObject({ planet: 'neptune', tomorrow: 'Tomorrow: Mercury' });
    expect(planetLabel(dayOf(2026, 10, 7)).tip).toBe("Today's planet · Mars");
  });
});

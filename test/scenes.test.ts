import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCENE_CHOICES } from '../src/main/menu';
import { has, svg } from '../src/renderer/scenes';
import planetarium, { galaxy, onAnyPlanet, type Planet, PLANETS, planetFor } from '../src/renderer/scenes/planetarium';

const RENDERER = path.join(__dirname, '..', 'src', 'renderer');
const SCENE_IDS = SCENE_CHOICES.map(([id]) => id).filter((id) => id !== 'none');

// Every stylesheet that can colour a scene cell: the shared one plus each scene's own.
const sceneCss = [path.join(RENDERER, 'cat.css'), ...fs.readdirSync(path.join(RENDERER, 'scenes')).filter((f) => f.endsWith('.css')).map((f) => path.join(RENDERER, 'scenes', f))]
  .map((file) => fs.readFileSync(file, 'utf8'))
  .join('\n');
const styled = new Set([...sceneCss.matchAll(/\.(sc-[\w-]+)/g)].map((m) => m[1]));
const classesIn = (markup: string): string[] => [...new Set([...markup.matchAll(/class="(sc-[\w-]+)"/g)].map((m) => m[1] ?? ''))];

describe('scene registry', () => {
  it('every menu scene is registered', () => {
    expect(SCENE_IDS.filter((id) => !has(id))).toEqual([]);
  });

  it('labels City Lights (id night, kept for saved settings) and the new Starlit Window', () => {
    const labels = Object.fromEntries(SCENE_CHOICES);
    expect(labels.night).toBe('City Lights');
    expect(labels.starlit).toBe('Starlit Window');
    const ids = SCENE_CHOICES.map(([id]) => id);
    expect(ids.indexOf('starlit')).toBe(ids.indexOf('night') + 1);
  });

  it('labels Planetarium and places it right after Starlit Window', () => {
    const labels = Object.fromEntries(SCENE_CHOICES);
    expect(labels.planetarium).toBe('Planetarium');
    const ids = SCENE_CHOICES.map(([id]) => id);
    expect(ids.indexOf('planetarium')).toBe(ids.indexOf('starlit') + 1);
  });

  it('labels Tarot Room and lists it last', () => {
    expect(SCENE_CHOICES.at(-1)).toEqual(['tarot', 'Tarot Room']);
  });

  it.each(SCENE_IDS)('%s renders a non-empty SVG', (id) => {
    const { back } = svg(id);
    expect(back).toContain(`scene-${id}`);
    expect((back.match(/<rect /g) ?? []).length).toBeGreaterThan(100);
  });

  it.each(SCENE_IDS)('%s uses no cell class without a CSS rule', (id) => {
    const { back, front } = svg(id);
    const classes = classesIn(back + front);
    expect(classes.length).toBeGreaterThan(5);
    expect(classes.filter((c) => !styled.has(c))).toEqual([]);
  });
});

describe('planetarium planet of the day', () => {
  const day = (y: number, m: number, d: number, h = 12): Date => new Date(y, m - 1, d, h);
  const next = (p: string): string => PLANETS[(PLANETS.indexOf(p as Planet) + 1) % PLANETS.length] ?? '';

  it('starts on Mars on 2026-10-07 and walks the solar system one planet a day', () => {
    const week = [7, 8, 9, 10, 11, 12, 13, 14, 15].map((d) => planetFor(day(2026, 10, d)));
    expect(week).toEqual(['mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'mercury', 'venus', 'earth', 'mars']);
    expect(planetFor(day(2026, 10, 6))).toBe('earth');
  });

  it('flips at local midnight, not mid-day', () => {
    expect(planetFor(day(2026, 10, 7, 0))).toBe('mars');
    expect(planetFor(new Date(2026, 9, 7, 23, 59, 59))).toBe('mars');
    expect(planetFor(day(2026, 10, 8, 0))).toBe('jupiter');
  });

  it('keeps the cycle across month and year boundaries', () => {
    expect(planetFor(day(2026, 10, 31))).toBe('mars');
    expect(planetFor(day(2026, 11, 1))).toBe('jupiter');
    expect(planetFor(day(2026, 12, 31))).toBe('mercury');
    expect(planetFor(day(2027, 1, 1))).toBe('venus');
    expect(planetFor(day(2028, 3, 1))).toBe(next(planetFor(day(2028, 2, 29))));
  });

  it('steps exactly one planet over DST changes (EU and US spring and autumn)', () => {
    for (const [y, m, d] of [[2026, 3, 29], [2026, 10, 25], [2026, 3, 8], [2026, 11, 1]] as const) {
      expect(planetFor(day(y, m, d + 1, 1))).toBe(next(planetFor(day(y, m, d, 1))));
      expect(planetFor(day(y, m, d, 0))).toBe(planetFor(day(y, m, d, 23)));
    }
  });

  it('draws all eight planets so CSS can show the day\'s one', () => {
    const { back } = svg('planetarium');
    for (const planet of PLANETS) expect(back).toContain(`sc-pl-${planet}-body`);
  });

  it('keeps both nebulae clear of every planet and ring, all eight', () => {
    const { back } = svg('planetarium');
    const cells = [...back.matchAll(/<rect x="(\d+)" y="(\d+)"[^>]*class="sc-pl-([\w-]+)"/g)];
    const at = (pattern: RegExp): Set<string> => new Set(cells.filter((m) => pattern.test(m[3] ?? '')).map((m) => `${m[1]},${m[2]}`));
    const nebula = at(/^(teal|pink)(-[ld])?$/);
    const planet = at(new RegExp(`^(${PLANETS.join('|')})-`));
    expect(nebula.size).toBeGreaterThan(0);
    expect(planet.size).toBeGreaterThan(0);
    // A one-cell gap too, so a nebula never even touches a planet.
    const near = (cell: string): boolean => {
      const [x, y] = cell.split(',').map(Number) as [number, number];
      return [-1, 0, 1].some((dx) => [-1, 0, 1].some((dy) => planet.has(`${x + dx},${y + dy}`)));
    };
    expect([...nebula].filter(near)).toEqual([]);
  });

  it('keeps the galaxy whole and a cell clear of every planet and ring, all eight', () => {
    const touchesPlanet = (x: number, y: number): boolean => [-1, 0, 1].some((dx) => [-1, 0, 1].some((dy) => onAnyPlanet(x + dx, y + dy)));
    const galaxyCells = Array.from({ length: 48 * 48 }, (_, i) => [i % 48, Math.floor(i / 48)] as const).filter(([x, y]) => galaxy(x, y));
    expect(galaxyCells.length).toBeGreaterThan(50);
    expect(galaxyCells.filter(([x, y]) => touchesPlanet(x, y))).toEqual([]);
    // Fully visible: nothing in the scene (dome edge, rim) paints over any galaxy cell.
    expect(galaxyCells.filter(([x, y]) => planetarium.paint(x, y) !== galaxy(x, y))).toEqual([]);
  });
});

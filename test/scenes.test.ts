import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCENE_CHOICES } from '../src/main/menu';
import { has, svg } from '../src/renderer/scenes';
import { planetFor } from '../src/renderer/scenes/planetarium';

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

  it('starts on Mars on 2026-10-07 and alternates daily', () => {
    expect(planetFor(day(2026, 10, 7))).toBe('mars');
    expect(planetFor(day(2026, 10, 8))).toBe('neptune');
    expect(planetFor(day(2026, 10, 9))).toBe('mars');
    expect(planetFor(day(2026, 10, 6))).toBe('neptune');
  });

  it('flips at local midnight, not mid-day', () => {
    expect(planetFor(day(2026, 10, 7, 0))).toBe('mars');
    expect(planetFor(new Date(2026, 9, 7, 23, 59, 59))).toBe('mars');
    expect(planetFor(day(2026, 10, 8, 0))).toBe('neptune');
  });

  it('keeps alternating across month and year boundaries', () => {
    expect(planetFor(day(2026, 10, 31))).toBe('mars');
    expect(planetFor(day(2026, 11, 1))).toBe('neptune');
    expect(planetFor(day(2026, 12, 31))).toBe('neptune');
    expect(planetFor(day(2027, 1, 1))).toBe('mars');
    expect(planetFor(day(2028, 2, 29))).not.toBe(planetFor(day(2028, 3, 1)));
  });

  it('still alternates over DST changes (EU and US spring and autumn)', () => {
    for (const [y, m, d] of [[2026, 3, 29], [2026, 10, 25], [2026, 3, 8], [2026, 11, 1]] as const) {
      expect(planetFor(day(y, m, d, 1))).not.toBe(planetFor(day(y, m, d + 1, 1)));
      expect(planetFor(day(y, m, d, 0))).toBe(planetFor(day(y, m, d, 23)));
    }
  });

  it('draws both planets so CSS can show the day\'s one', () => {
    const { back } = svg('planetarium');
    expect(back).toContain('sc-pl-mars-cap');
    expect(back).toContain('sc-pl-nep-spot');
  });
});

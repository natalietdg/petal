import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCENE_CHOICES } from '../src/main/menu';
import { has, svg } from '../src/renderer/scenes';

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

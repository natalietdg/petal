import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CAT_CHOICES } from '../src/main/menu';
import { CATS, PROPS, SITTING, type Line, type Pet } from '../src/renderer/cat-art';

const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'cat.css'), 'utf8');
const styled = new Set([...css.matchAll(/\.px-(\w)\b/g)].map((m) => m[1]));
const cats: Record<string, Pet> = CATS;
const builtIn = CAT_CHOICES.filter(([id]) => Object.hasOwn(CATS, id));

const lines = (pet: Pet): readonly Line[] => [
  ...pet.sitting, ...pet.eyesOpen, ...(pet.eyesClosed ?? []), ...(pet.wings ?? []),
  ...(pet.tail ? [...pet.tail.up, ...pet.tail.down] : []),
];
const cells = (rows: readonly string[]): string[] => [...new Set(rows.join('').replace(/\./g, ''))];

describe('cat art', () => {
  it('every built-in cat in the menu has art and a toy', () => {
    expect(builtIn.map(([id]) => id).sort()).toEqual(Object.keys(CATS).sort());
    for (const [id] of builtIn) expect(Object.hasOwn(PROPS, id)).toBe(true);
  });

  it('cat names are unique, so the picker never shows two of one name', () => {
    const names = CAT_CHOICES.map(([, name]) => name);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(Object.keys(CATS))('%s draws on the 20x20 grid', (id) => {
    const pet = cats[id];
    const base = pet.base ?? SITTING;
    expect(base.every((row) => row.length === 20)).toBe(true);
    for (const [y, row] of lines(pet)) {
      expect(row.length).toBe(20);
      expect(y).toBeLessThan(20);
    }
  });

  it.each(Object.keys(CATS))('%s uses no cell letter without a colour', (id) => {
    const pet = cats[id];
    const used = cells([...(pet.base ?? SITTING), ...lines(pet).map(([, row]) => row), ...PROPS[id as keyof typeof PROPS].rows]);
    expect(used.filter((cell) => !styled.has(cell))).toEqual([]);
  });

  it('Hoshi has wings, a wand that sparkles, and no tail', () => {
    expect(CATS.hoshi.wings.length).toBeGreaterThan(0);
    expect(CATS.hoshi.tail).toBe(false);
    expect(PROPS.hoshi.name).toBe('wand');
    expect(PROPS.hoshi.rows.join('')).toContain('k');
  });
});

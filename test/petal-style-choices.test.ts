import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PETAL_STYLE_CHOICES, isPetalStyleFile } from '../src/shared/petal-style-choices';

const STYLES_DIR = path.join(__dirname, '..', 'resources', 'output-styles');

describe('Petal style choices', () => {
  it('match the bundled files: same names, and token sizes within 10% of chars/4', () => {
    for (const choice of PETAL_STYLE_CHOICES) {
      const text = fs.readFileSync(path.join(STYLES_DIR, choice.file), 'utf8');
      expect(text, choice.file).toMatch(new RegExp(`^name: ${choice.name}$`, 'm'));
      const measured = [...text].length / 4;
      expect(Math.abs(measured - choice.tokens) / measured, choice.file).toBeLessThan(0.1);
    }
    expect(PETAL_STYLE_CHOICES.map((c) => c.file).sort()).toEqual(fs.readdirSync(STYLES_DIR).filter((f) => f.endsWith('.md')).sort());
  });

  it('knows a Petal style file by its name', () => {
    expect(isPetalStyleFile('/Users/x/.claude/output-styles/petal-magazine.md')).toBe(true);
    expect(isPetalStyleFile('/Users/x/.claude/output-styles/magazine.md')).toBe(false);
  });
});

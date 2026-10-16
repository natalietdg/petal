// View › Bigger / Smaller Text / Actual Size: stepping and clamping for both panes.
import { describe, expect, it } from 'vitest';
import { READER_PERCENT, TERMINAL_FONT, clampSize, stepSize } from '../src/shared/text-size';

describe('text size ranges', () => {
  it('start at today\'s look: 16 px terminal, 100% reader', () => {
    expect(TERMINAL_FONT).toEqual({ min: 10, max: 28, step: 1, initial: 16 });
    expect(READER_PERCENT).toEqual({ min: 80, max: 160, step: 10, initial: 100 });
  });

  it('clamp to the bounds and snap onto the steps', () => {
    expect(clampSize(TERMINAL_FONT, 9)).toBe(10);
    expect(clampSize(TERMINAL_FONT, 29)).toBe(28);
    expect(clampSize(TERMINAL_FONT, 16.4)).toBe(16);
    expect(clampSize(READER_PERCENT, 104)).toBe(100);
    expect(clampSize(READER_PERCENT, 105)).toBe(110);
    expect(clampSize(READER_PERCENT, 70)).toBe(80);
    expect(clampSize(READER_PERCENT, 175)).toBe(160);
  });

  it('step one at a time and stop at the ends', () => {
    expect(stepSize(TERMINAL_FONT, 16, 1)).toBe(17);
    expect(stepSize(TERMINAL_FONT, 16, -1)).toBe(15);
    expect(stepSize(TERMINAL_FONT, 28, 1)).toBe(28);
    expect(stepSize(TERMINAL_FONT, 10, -1)).toBe(10);
    expect(stepSize(READER_PERCENT, 100, 1)).toBe(110);
    expect(stepSize(READER_PERCENT, 160, 1)).toBe(160);
    expect(stepSize(READER_PERCENT, 80, -1)).toBe(80);
  });

  it('walk the whole range: 18 steps for the terminal, 8 for the reader', () => {
    const walk = (range: typeof TERMINAL_FONT, from: number, by: 1 | -1) => {
      const seen = [from];
      for (let i = 0; i < 30; i += 1) seen.push(stepSize(range, seen.at(-1) ?? from, by));
      return [...new Set(seen)];
    };
    expect(walk(TERMINAL_FONT, 10, 1)).toHaveLength(19);
    expect(walk(READER_PERCENT, 160, -1)).toEqual([160, 150, 140, 130, 120, 110, 100, 90, 80]);
  });

  it('Actual Size goes back to the initial size from anywhere', () => {
    expect(stepSize(TERMINAL_FONT, 28, 0)).toBe(16);
    expect(stepSize(READER_PERCENT, 80, 0)).toBe(100);
  });
});

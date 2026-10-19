import { describe, expect, it } from 'vitest';
import { pastesImagePath, quotePaths } from '../src/shared/quote-path';

const PNG = '/var/folders/ab/T/petal-paste/paste-2026-10-19T01-02-03-000Z-1a2b3c4d.png';

describe('pastesImagePath', () => {
  it('sees an image-only message, as the reply box sends a pasted screenshot', () => {
    expect(pastesImagePath(quotePaths([PNG]))).toBe(true);
    expect(pastesImagePath(quotePaths([PNG, PNG]))).toBe(true);
  });

  it('sees an image after text, split before the absolute path as Claude Code splits it', () => {
    expect(pastesImagePath(`what is wrong here ${PNG}`)).toBe(true);
    expect(pastesImagePath(`look\n${PNG}`)).toBe(true);
  });

  it('sees quoted paths and every extension Claude Code attaches', () => {
    expect(pastesImagePath(quotePaths(['/tmp/My Shots/a b.jpg']))).toBe(true);
    for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'PNG']) expect(pastesImagePath(`/tmp/x.${ext}`)).toBe(true);
  });

  it('leaves plain text and other files alone, so they keep their one write with Enter', () => {
    expect(pastesImagePath('fix the png export')).toBe(false);
    expect(pastesImagePath('see /tmp/notes.md')).toBe(false);
    expect(pastesImagePath('rename logo.png to icon.png please')).toBe(false);
    expect(pastesImagePath('')).toBe(false);
  });
});

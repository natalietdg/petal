import { describe, expect, it } from 'vitest';
import { CATS } from '../src/renderer/cat-art';

describe('pet pronouns', () => {
  it('gives each built-in pet its pronoun', () => {
    const pronouns = Object.fromEntries(Object.entries(CATS).map(([id, pet]) => [id, pet.pronoun]));
    expect(pronouns).toEqual({ mika: 'she', corgi: 'he', miki: 'he', kira: 'she', hoshi: 'she' });
  });
});

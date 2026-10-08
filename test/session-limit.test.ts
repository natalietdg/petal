import { describe, expect, it } from 'vitest';
import { limitReached, overLimit } from '../src/shared/session-limit';

const view = (total: number, maxOpen: number) => ({ counts: { total }, maxOpen });

describe('limitReached', () => {
  it('lets a session start below the limit', () => {
    expect(limitReached(view(0, 2))).toBeNull();
    expect(limitReached(view(1, 2))).toBeNull();
  });

  it('blocks at the limit with the panel note', () => {
    expect(limitReached(view(2, 2))).toBe('2 open, your limit is 2');
  });

  it('blocks over the limit too', () => {
    expect(limitReached(view(5, 2))).toBe('5 open, your limit is 2');
  });

  it('never blocks when the count could not be read', () => {
    expect(limitReached({ error: 'sessions:snapshot failed' })).toBeNull();
  });
});

describe('overLimit', () => {
  it('is only past the limit, not at it', () => {
    expect(overLimit(view(2, 2))).toBe(false);
    expect(overLimit(view(3, 2))).toBe(true);
  });
});

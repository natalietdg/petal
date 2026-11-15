import { describe, expect, it } from 'vitest';
import { shouldRelist } from '../src/main/process-poll';

describe('process poll relisting', () => {
  it('lists on the first tick', () => {
    expect(shouldRelist(1000, null, false)).toBe(true);
  });

  it('reuses the last listing while every terminal is quiet', () => {
    expect(shouldRelist(10_000, { at: 1000 }, false)).toBe(false);
  });

  it('lists again after terminal output, which a claude starting or exiting always makes', () => {
    expect(shouldRelist(2000, { at: 1000 }, true)).toBe(true);
  });

  it('lists again after 15s of quiet, for a claude killed from outside', () => {
    expect(shouldRelist(16_000, { at: 1000 }, false)).toBe(true);
  });
});

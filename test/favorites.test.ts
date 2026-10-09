import { describe, expect, it } from 'vitest';
import { listedFor, MAX_FAVORITES, toggled } from '../src/shared/favorites';

const A = 'a1a1a1a1-0000-4000-8000-0000000000a1';
const B = 'b2b2b2b2-0000-4000-8000-0000000000b2';
const C = 'c3c3c3c3-0000-4000-8000-0000000000c3';
const sessions = [{ sessionId: A, title: 'newest' }, { sessionId: B, title: 'middle' }, { sessionId: C, title: 'oldest' }];

describe('favorites filter', () => {
  it('All lists every session in the order given', () => {
    expect(listedFor(sessions, [C], 'all').map((s) => s.sessionId)).toEqual([A, B, C]);
  });

  it('Favorites lists only starred sessions, keeping the list order (not star order)', () => {
    expect(listedFor(sessions, [C, A], 'favorites').map((s) => s.sessionId)).toEqual([A, C]);
  });

  it('a starred id whose session is gone is simply not shown', () => {
    const gone = 'deadbeef-0000-4000-8000-000000000000';
    expect(listedFor(sessions, [gone, B], 'favorites').map((s) => s.sessionId)).toEqual([B]);
    expect(listedFor(sessions, [gone], 'favorites')).toEqual([]);
  });

  it('no stars, empty Favorites', () => {
    expect(listedFor(sessions, [], 'favorites')).toEqual([]);
  });

  it('returns a new array, so sorting it leaves the sessions alone', () => {
    const listed = listedFor(sessions, [], 'all');
    listed.reverse();
    expect(sessions[0]!.sessionId).toBe(A);
  });
});

describe('favorites toggle', () => {
  it('stars at the end and unstars in place', () => {
    expect(toggled([], A)).toEqual([A]);
    expect(toggled([A], B)).toEqual([A, B]);
    expect(toggled([A, B, C], B)).toEqual([A, C]);
  });

  it('does not change the list it was given', () => {
    const before = [A];
    toggled(before, B);
    expect(before).toEqual([A]);
  });

  it('drops the oldest star past the cap', () => {
    const full = Array.from({ length: MAX_FAVORITES }, (_, i) => `id-${i}`);
    const next = toggled(full, A);
    expect(next).toHaveLength(MAX_FAVORITES);
    expect(next[0]).toBe('id-1');
    expect(next.at(-1)).toBe(A);
  });
});

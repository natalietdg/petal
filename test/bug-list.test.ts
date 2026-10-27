import { describe, expect, it } from 'vitest';
import { bugRows } from '../src/shared/bug-list';
import { parseCriteria } from '../src/shared/test-loop';
import type { BugState, QueuedBug } from '../src/shared/bug-queue';

const bugs = parseCriteria([
  '## Bugs',
  '- [fixed] tax rounds per order · test: src/tax.test.ts::rounds',
  '- [fail] coupon goes below zero · test: src/coupon.test.ts::caps · ticket: AB#12',
  '- [fail] place order stays enabled',
].join('\n')).bugs;

const queued = (name: string, state: BugState, since: number): QueuedBug => ({
  key: name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(), name, test: null, state, since, asked: false, testerRound: 1, rechecked: false,
});

describe('bugRows', () => {
  it('lists every criteria bug once when no loop has started', () => {
    const rows = bugRows(bugs, bugs, null);
    expect(rows.map((r) => [r.item?.name, r.queued])).toEqual([['tax rounds per order', null], ['coupon goes below zero', null], ['place order stays enabled', null]]);
  });

  it('joins queued bugs to their criteria line, queue order first, then the rest in file order', () => {
    const queue = [queued('place order stays enabled', 'open', 20), queued('Coupon goes below zero!', 'fixing', 30)];
    const rows = bugRows(bugs, bugs, queue);
    expect(rows.map((r) => [r.item?.name ?? null, r.queued?.state ?? null])).toEqual([
      ['place order stays enabled', 'open'],
      ['coupon goes below zero', 'fixing'],
      ['tax rounds per order', null],
    ]);
    expect(rows[1]?.item?.ticket).toBe('AB#12'); // the criteria details stay with the queued bug
  });

  it('keeps a sent bug with no criteria line, and hides a queued bug her filter hides', () => {
    const queue = [queued('Unit stage fails', 'verify', 10), queued('coupon goes below zero', 'fixing', 5)];
    const shown = bugs.filter((b) => b.ticket !== 'AB#12');
    const rows = bugRows(shown, bugs, queue);
    expect(rows.map((r) => [r.queued?.name ?? r.item?.name, r.item ? 'line' : 'sent'])).toEqual([
      ['Unit stage fails', 'sent'],
      ['tax rounds per order', 'line'],
      ['place order stays enabled', 'line'],
    ]);
  });
});

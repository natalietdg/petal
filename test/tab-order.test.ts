import { describe, expect, it } from 'vitest';
import { cycleTarget, neighbourOf, stripOrder } from '../src/renderer/tab-order';

describe('tab bar order skips agent terminals', () => {
  it('leaves agent tabs out, keeping the rest in creation order', () => {
    expect(stripOrder(['t1', 'm1', 't2', 'm2'], new Set(['m1', 'm2']))).toEqual(['t1', 't2']);
  });

  it('a popped-out agent (no longer in the set) is back in the bar', () => {
    expect(stripOrder(['t1', 'm1'], new Set())).toEqual(['t1', 'm1']);
  });

  it('cycling wraps over tab-bar tabs only', () => {
    const order = stripOrder(['t1', 'm1', 't2'], new Set(['m1']));
    expect(cycleTarget(order, 't1', 1)).toBe('t2');
    expect(cycleTarget(order, 't2', 1)).toBe('t1');
    expect(cycleTarget(order, 't1', -1)).toBe('t2');
  });

  it('cycling goes nowhere with one tab, no active tab, or an active id outside the bar', () => {
    expect(cycleTarget(['t1'], 't1', 1)).toBeNull();
    expect(cycleTarget(['t1', 't2'], null, 1)).toBeNull();
    expect(cycleTarget(['t1', 't2'], 'm1', 1)).toBeNull();
  });

  it('closing a tab shows its right neighbour, else its left, never an agent', () => {
    const order = stripOrder(['t1', 't2', 'm1'], new Set(['m1']));
    expect(neighbourOf(order, 't1')).toBe('t2');
    expect(neighbourOf(order, 't2')).toBe('t1');
    expect(neighbourOf(['t1'], 't1')).toBeNull();
    expect(neighbourOf(order, 'm1')).toBeNull();
  });
});

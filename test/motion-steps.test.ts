import { describe, expect, it } from 'vitest';
import { changePoints, stepAt, type SteppedAnimation } from '../src/renderer/motion-steps';

// Just the parts of an Animation that motion-steps reads.
const fake = (frames: { computedOffset: number; easing: string }[], timing: { direction?: string } = {}): SteppedAnimation => ({
  effect: { getKeyframes: () => frames, getTiming: () => ({ duration: 1000, delay: 0, direction: 'normal', ...timing }) },
});

describe('changePoints', () => {
  it('lists each step boundary of a steps() keyframe interval', () => {
    const blink = fake([{ computedOffset: 0, easing: 'steps(1)' }, { computedOffset: 0.5, easing: 'steps(1)' }, { computedOffset: 1, easing: 'steps(1)' }]);
    expect(changePoints(blink)).toEqual([0, 0.5, 1]);
    const snow = fake([{ computedOffset: 0, easing: 'steps(4, end)' }, { computedOffset: 1, easing: 'linear' }]);
    expect(changePoints(snow)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it('treats a continuous easing as changing all the time', () => {
    expect(changePoints(fake([{ computedOffset: 0, easing: 'ease-in-out' }, { computedOffset: 1, easing: 'ease-in-out' }]))).toBeNull();
  });

  it('mirrors the points for reversed directions', () => {
    const tail = fake([{ computedOffset: 0, easing: 'steps(1)' }, { computedOffset: 0.3, easing: 'steps(1)' }, { computedOffset: 1, easing: 'steps(1)' }], { direction: 'reverse' });
    expect(changePoints(tail)).toEqual([0, 0.3, 0.7, 1]);
  });
});

describe('stepAt', () => {
  const timing = { points: [0, 0.5, 1], duration: 1000, delay: 0 };

  it('stays the same within a stretch and moves on at each boundary', () => {
    expect(stepAt(timing, 100)).toBe(stepAt(timing, 400));
    expect(stepAt(timing, 600)).not.toBe(stepAt(timing, 400));
    expect(stepAt(timing, 1100)).not.toBe(stepAt(timing, 100)); // next iteration
  });

  it('honours delays and continuous easings', () => {
    expect(stepAt({ ...timing, delay: 500 }, 200)).toBe(-1);
    expect(stepAt({ ...timing, points: null }, 123)).toBe(123);
  });
});

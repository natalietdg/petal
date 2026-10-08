// Where a CSS animation's look can change, so the motion clock writes only then (no write, no frame).
// steps() easings change at a few points per keyframe interval; any other easing changes all the time.

const STEPS = /^steps\(\s*(\d+)/;

// Change points as fractions of one iteration, or null when the easing is continuous.
// A superset is fine: an extra point only costs one redundant write.
export function changePoints(animation: Animation): number[] | null {
  const effect = animation.effect as KeyframeEffect | null;
  if (!effect) return null;
  const frames = effect.getKeyframes();
  const points = new Set<number>([0]);
  for (let i = 0; i < frames.length; i += 1) {
    const from = Number(frames[i].computedOffset);
    const to = Number(frames[i + 1]?.computedOffset ?? 1);
    const easing = String(frames[i].easing);
    const count = easing === 'step-start' || easing === 'step-end' ? 1 : Number(STEPS.exec(easing)?.[1] ?? 0);
    if (!count) {
      if (to > from && frames.length > 1 && i < frames.length - 1) return null;
      continue;
    }
    for (let k = 0; k <= count; k += 1) points.add(from + ((to - from) * k) / count);
  }
  const { direction } = effect.getTiming();
  const all = direction === 'normal' || !direction ? [...points] : [...points].flatMap((p) => [p, 1 - p]);
  return [...new Set(all.map((p) => Math.min(Math.max(p, 0), 1)))].sort((a, b) => a - b);
}

export interface StepTiming {
  points: number[] | null;
  duration: number;
  delay: number;
}

export const stepTiming = (animation: Animation): StepTiming => {
  const timing = animation.effect?.getTiming();
  return { points: changePoints(animation), duration: Number(timing?.duration ?? 0), delay: Number(timing?.delay ?? 0) };
};

// Which stretch between change points the animation is in at `currentMs`; the same stretch looks the same.
export function stepAt({ points, duration, delay }: StepTiming, currentMs: number): number {
  const active = currentMs - delay;
  if (!points || !duration) return currentMs; // continuous: every tick differs
  if (active < 0) return -1;
  const iteration = Math.floor(active / duration);
  const progress = (active % duration) / duration;
  let index = 0;
  while (index + 1 < points.length && points[index + 1] <= progress) index += 1;
  return iteration * points.length + index;
}

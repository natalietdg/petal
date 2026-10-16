// Text size bounds for the terminal font (px) and the reader text (percent); config-store and the renderer share them.
export interface SizeRange {
  min: number;
  max: number;
  step: number;
  initial: number; // today's look
}

export const TERMINAL_FONT: Readonly<SizeRange> = Object.freeze({ min: 10, max: 28, step: 1, initial: 16 });
export const READER_PERCENT: Readonly<SizeRange> = Object.freeze({ min: 80, max: 160, step: 10, initial: 100 });

export type TextPane = 'terminal' | 'reader';
// View menu: Bigger Text, Smaller Text, Actual Size.
export type TextStep = 1 | -1 | 0;

// Onto the range's grid (counted from min), then inside its bounds.
export function clampSize(range: SizeRange, value: number): number {
  const snapped = range.min + Math.round((value - range.min) / range.step) * range.step;
  return Math.min(range.max, Math.max(range.min, snapped));
}

// One step bigger or smaller; 0 goes back to the initial size.
export function stepSize(range: SizeRange, value: number, step: TextStep): number {
  return step === 0 ? range.initial : clampSize(range, value + step * range.step);
}

// The reader's share of the window above the divider; the rest is the terminal.
export const READER_SPLIT = { min: 0.2, max: 0.85, initial: 0.65 } as const;

export const clampSplit = (fraction: number): number => Math.min(READER_SPLIT.max, Math.max(READER_SPLIT.min, fraction));

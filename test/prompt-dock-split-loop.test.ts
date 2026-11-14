import { describe, expect, it } from 'vitest';
import { READER_FLOOR_BANDS, READER_SPLIT, clampSplit, splitFloor } from '../src/shared/reader-split';

// A window where a 5-option picker fits in 12 terminal rows but not in fewer.
const TOTAL_PX = 800;
const ROW_PX = 20;
const PANE_EXTRA_PX = 40; // tab strip and padding
const FIXED_BANDS: Record<string, number> = { 'sessions-dock': 40, 'reader-head': 40, composer: 80 };
const OPTIONS = 5;
const ROWS_FOR_ALL_OPTIONS = 12;

// Claude Code scrolls the picker when rows are short; the card drops hidden options to one hint line.
function cardPx(rows: number): number {
  const visible = rows >= ROWS_FOR_ALL_OPTIONS ? OPTIONS : 2;
  return 120 + visible * 60 + (visible < OPTIONS ? 20 : 0);
}

function bandPx(id: string, rows: number): number {
  return id === 'prompt-dock' ? cardPx(rows) : FIXED_BANDS[id] ?? 0;
}

// One ResizeObserver round: bands → floor → split → terminal rows.
function settle(rounds: number): number[] {
  const splits: number[] = [];
  let rows = 40; // before the picker appears
  for (let i = 0; i < rounds; i++) {
    const bands = READER_FLOOR_BANDS.reduce((sum, id) => sum + bandPx(id, rows), 0);
    const split = clampSplit(Math.max(splitFloor(bands, TOTAL_PX), READER_SPLIT.initial));
    splits.push(split);
    rows = Math.floor(((1 - split) * TOTAL_PX - PANE_EXTRA_PX) / ROW_PX);
  }
  return splits;
}

describe('question card and terminal split', () => {
  it('settles on one split while a picker is open', () => {
    const tail = settle(10).slice(-4);
    expect(new Set(tail).size).toBe(1);
  });

  it('floor is the bands share of the height, zero for an unmeasured window', () => {
    expect(splitFloor(200, 800)).toBe(0.25);
    expect(splitFloor(200, 0)).toBe(0);
  });
});

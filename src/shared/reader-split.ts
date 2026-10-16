// The reader's share of the window above the divider; the rest is the terminal.
export const READER_SPLIT = { min: 0.2, max: 0.85, initial: 0.65 } as const;

export const clampSplit = (fraction: number): number => Math.min(READER_SPLIT.max, Math.max(READER_SPLIT.min, fraction));

// Claude Code's first-run screens (welcome, theme, sign-in) need this many rows; fewer and they scroll off the top.
export const CLAUDE_SETUP_ROWS = 24;

export interface PaneSize {
  totalPx: number; // the app's height less the divider
  rowPx: number; // one terminal row
  paneExtraPx: number; // the terminal pane beyond its rows: the tab strip and padding
}

// The reader share that leaves the terminal `rows` rows; never more than the usual share.
export function readerShareForRows(rows: number, { totalPx, rowPx, paneExtraPx }: PaneSize): number {
  if (totalPx <= 0 || rowPx <= 0) return READER_SPLIT.initial;
  return clampSplit(Math.min(READER_SPLIT.initial, 1 - (rows * rowPx + paneExtraPx) / totalPx));
}

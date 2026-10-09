// A reply with ## sections reads summary first: headline, abstract and status lines stay open, each section folds.

// A reply's top-level blocks: the bold headline, any <p>, a Doing/Recommend/Next block, a ## heading, anything else.
export type BlockKind = 'headline' | 'paragraph' | 'strip' | 'heading' | 'other';

export interface ReplyLayout {
  order: number[]; // block indices in reading order
  sections: number; // how many ## sections follow the summary
}

// Summary = headline + abstract, then every status strip, then the rest of the intro; sections keep their order.
export function layoutReply(blocks: readonly BlockKind[]): ReplyLayout {
  const firstHeading = blocks.indexOf('heading');
  const all = blocks.map((_, i) => i);
  if (firstHeading < 0) return { order: all, sections: 0 }; // no sections: the reply renders as it always has
  const head = blocks[0] === 'headline' ? (blocks[1] === 'paragraph' ? [0, 1] : [0]) : blocks[0] === 'paragraph' ? [0] : [];
  const strips = all.filter((i) => blocks[i] === 'strip');
  const rest = all.filter((i) => !head.includes(i) && blocks[i] !== 'strip');
  return { order: [...head, ...strips, ...rest], sections: blocks.filter((kind) => kind === 'heading').length };
}

// Which sections she opened: everything follows `all` (null: each section's own default), except the ones she flipped.
// done: Steps she ticked, as "section:step"; kept as long as the fold state, never saved.
export interface FoldState {
  all: boolean | null;
  flipped: Set<number>;
  done: Set<string>;
}

export const newFold = (): FoldState => ({ all: null, flipped: new Set(), done: new Set() });

// startsOpen: a section that opens by default (Steps), until Expand all or Collapse all decides for every section.
export const isOpen = (state: FoldState, index: number, startsOpen = false): boolean => (state.all ?? startsOpen) !== state.flipped.has(index);

export function toggleSection(state: FoldState, index: number): void {
  if (!state.flipped.delete(index)) state.flipped.add(index);
}

export function setAll(state: FoldState, open: boolean): void {
  state.all = open;
  state.flipped.clear();
}

export function allOpen(state: FoldState, count: number, startsOpen: ReadonlySet<number> = new Set()): boolean {
  for (let i = 0; i < count; i++) if (!isOpen(state, i, startsOpen.has(i))) return false;
  return true;
}

// Ticks or unticks one step; returns whether it is now done.
export function toggleDone(state: FoldState, step: string): boolean {
  if (state.done.delete(step)) return false;
  state.done.add(step);
  return true;
}

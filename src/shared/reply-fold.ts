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

// Which sections she opened: everything follows `all`, except the ones she flipped by hand.
export interface FoldState {
  all: boolean;
  flipped: Set<number>;
}

export const newFold = (): FoldState => ({ all: false, flipped: new Set() });

export const isOpen = (state: FoldState, index: number): boolean => state.all !== state.flipped.has(index);

export function toggleSection(state: FoldState, index: number): void {
  if (!state.flipped.delete(index)) state.flipped.add(index);
}

export function setAll(state: FoldState, open: boolean): void {
  state.all = open;
  state.flipped.clear();
}

export function allOpen(state: FoldState, count: number): boolean {
  for (let i = 0; i < count; i++) if (!isOpen(state, i)) return false;
  return true;
}

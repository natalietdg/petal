// The reader's contents rail: one line per reply on screen, named by its headline, or by its opening words when it has none.
export const RAIL_TITLE_MAX = 64;
export const RAIL_MIN_REPLIES = 2; // one reply needs no contents
export const RAIL_MIN_GUTTER_PX = 200; // narrower than this beside the column, the rail hides rather than squeeze the reply

export interface RailEntry { replyId: string; title: string }

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim();

function clip(text: string): string {
  if (text.length <= RAIL_TITLE_MAX) return text;
  const cut = text.slice(0, RAIL_TITLE_MAX - 1);
  const atWord = cut.lastIndexOf(' ');
  return `${(atWord > RAIL_TITLE_MAX / 2 ? cut.slice(0, atWord) : cut).trimEnd()}…`;
}

// headline: the reply's bold opening line, if it has one; opening: the reply's first paragraph.
export function railTitle(headline: string | null, opening: string): string {
  const named = squash(headline ?? '');
  if (named) return clip(named);
  const first = squash(opening).split(/(?<=[.!?])\s/)[0] ?? '';
  return first ? clip(first) : 'Reply';
}

export const showsRail = (entries: number, gutterPx: number, book: boolean): boolean =>
  !book && entries >= RAIL_MIN_REPLIES && gutterPx >= RAIL_MIN_GUTTER_PX;

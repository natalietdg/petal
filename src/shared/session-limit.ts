// Her open-Claude limit: one rule for every path that starts a Claude session.

interface LimitView {
  counts: { total: number }; // every Claude on this Mac, the count the Sessions pill shows
  maxOpen: number;
}

export const limitText = (total: number, maxOpen: number): string => `${total} open, your limit is ${maxOpen}`;
export const overLimit = ({ counts, maxOpen }: LimitView): boolean => counts.total > maxOpen;

// The limit note when one more session would pass her limit, else null. An unreadable count never blocks her.
export function limitReached(view: LimitView | { error: string }): string | null {
  if ('error' in view) return null;
  return view.counts.total >= view.maxOpen ? limitText(view.counts.total, view.maxOpen) : null;
}

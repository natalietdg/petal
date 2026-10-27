// The Testing tab's one bug list: the criteria file's bug lines joined with the loop's bug queue by bug key.
import { BUG_STATES, bugKey, type QueuedBug } from './bug-queue';
import type { CriteriaItem } from './test-loop';

export interface BugRow {
  key: string;
  item: CriteriaItem | null; // its criteria line: details, ticket, copy for ADO
  queued: QueuedBug | null; // its place in the loop's queue
}

// Queued bugs first, in queue order (state, then oldest); then lines the queue doesn't hold, in file order.
// shown: the lines her filter keeps; all: every line, so a queued bug the filter hides stays hidden.
export function bugRows(shown: readonly CriteriaItem[], all: readonly CriteriaItem[], queue: readonly QueuedBug[] | null): BugRow[] {
  const shownByKey = new Map(shown.map((item) => [bugKey(item.name), item]));
  const allKeys = new Set(all.map((item) => bugKey(item.name)));
  const queued = [...(queue ?? [])]
    .filter((bug) => shownByKey.has(bug.key) || !allKeys.has(bug.key))
    .sort((a, b) => BUG_STATES.indexOf(a.state) - BUG_STATES.indexOf(b.state) || a.since - b.since);
  const inQueue = new Set(queued.map((bug) => bug.key));
  return [
    ...queued.map((bug) => ({ key: bug.key, item: shownByKey.get(bug.key) ?? null, queued: bug })),
    ...shown.filter((item) => !inQueue.has(bugKey(item.name))).map((item) => ({ key: bugKey(item.name), item, queued: null })),
  ];
}

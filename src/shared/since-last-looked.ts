// The Board's "Since you last looked" line: what the activity feed recorded after the Board was last opened, counted by kind.
import { ACTIVITY_KINDS, type ActivityEvent, type ActivityKind } from './activity';

const COUNT_WORDS: Record<ActivityKind, [one: string, many: string]> = {
  task: ['task update', 'task updates'],
  edits: ['round of edits', 'rounds of edits'],
  test: ['test run', 'test runs'],
  conclusion: ['conclusion', 'conclusions'],
  library: ['Library update', 'Library updates'],
  clash: ['clash', 'clashes'],
  message: ['message', 'messages'],
  job: ['factory job changed', 'factory jobs changed'],
};

const counted = (n: number, kind: ActivityKind): string => `${n} ${COUNT_WORDS[kind][n === 1 ? 0 : 1]}`;

// lastLooked: ms since epoch, 0 when the Board was never opened (then there is nothing to compare, so no line).
// ago: how long ago that was, already in words ("2h ago").
export function sinceLine(events: readonly ActivityEvent[], lastLooked: number, ago: string): string | null {
  if (!lastLooked) return null;
  const fresh = events.filter((e) => e.at > lastLooked);
  if (!fresh.length) return `Nothing new since you last looked, ${ago}.`;
  const parts = ACTIVITY_KINDS
    .map((kind) => [kind, fresh.filter((e) => e.kind === kind).length] as const)
    .filter(([, n]) => n > 0)
    .map(([kind, n]) => counted(n, kind));
  return `Since you last looked, ${ago}: ${parts.join(' · ')}.`;
}

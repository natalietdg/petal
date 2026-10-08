// The three status lines a reply carries after its abstract: Doing, Recommend, Next.

export const STATUS_KEYS = ['doing', 'recommend', 'next'] as const;
export type StatusKey = typeof STATUS_KEYS[number];
export type StatusLines = Partial<Record<StatusKey, string>>;
export interface StatusLine { key: StatusKey; text: string }

export const STATUS_TITLES: Record<StatusKey, string> = { doing: 'Doing', recommend: 'Recommend', next: 'Next' };

// "**Doing:** x", "**Doing**: x" or "Doing: x"; the label in any case.
const LINE = /^\s*(?:\*\*|__)?(doing|recommend|next)(?:\s*:\s*(?:\*\*|__)|(?:\*\*|__)\s*:|\s*:)\s*(\S.*?)\s*$/i;
const FENCE = /^\s*(```|~~~)/;

export function parseStatusLine(line: string): StatusLine | null {
  const match = LINE.exec(line);
  if (!match?.[1] || !match[2]) return null;
  return { key: match[1].toLowerCase() as StatusKey, text: match[2] };
}

// Inline markers the strip shows as plain text.
const plain = (text: string): string => text.replace(/\*\*|__|==|`/g, '');

// One reply's status lines, outside code fences; the first of each label wins.
export function parseStatus(markdown: string): StatusLines {
  const found: StatusLines = {};
  let fenced = false;
  for (const line of markdown.split('\n')) {
    if (FENCE.test(line)) fenced = !fenced;
    if (fenced) continue;
    const status = parseStatusLine(line);
    if (status && !found[status.key]) found[status.key] = plain(status.text);
  }
  return found;
}

export const hasStatus = (lines: StatusLines): boolean => STATUS_KEYS.some((key) => lines[key]);

// Replies newest first: the first one carrying any status line.
export function newestStatus(newestFirst: readonly string[]): StatusLines | null {
  for (const markdown of newestFirst) {
    const lines = parseStatus(markdown);
    if (hasStatus(lines)) return lines;
  }
  return null;
}

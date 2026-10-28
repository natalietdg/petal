// The Confirmed page: what a session's replies checked, decided, finished, and still have running.
import { codeFenceTracker, parseStatusLine } from './status-lines';
import { stripPasted } from './pasted-content';

export interface ConfirmedReply {
  id: string | undefined;
  markdown: string;
  prompt: string;
}

export type ConfirmedPill = 'In progress' | 'Waiting on you';

export interface ConfirmedItem {
  text: string; // markdown, rendered inline
  context: string; // the reply's headline, plain text, or ''
  answer?: string; // her next prompt, for a decision
  pill?: ConfirmedPill;
  replyId: string | undefined;
}

export interface ConfirmedGroups {
  verified: ConfirmedItem[];
  decided: ConfirmedItem[];
  done: ConfirmedItem[];
  progress: ConfirmedItem[];
}

export const GROUP_ORDER = ['verified', 'decided', 'done', 'progress'] as const;
export const GROUP_TITLES: Record<keyof ConfirmedGroups, string> = { verified: 'Verified', decided: 'Decided', done: 'Done', progress: 'In progress' };

type Label = 'checked' | 'decide' | 'done' | 'result';

// "**Done:** x", "**Done**: x", "- **Result:** x"; bold only, so a prose "Done:" stays prose.
const LABEL_LINE = /^ {0,3}(?:[-*+]\s+)?(?:\*\*|__)\s*(checked|decide|done|result)\s*:?\s*(?:\*\*|__)\s*:?\s*(\S.*?)\s*$/i;
const HEADLINE = /^ {0,3}(?:\*\*|__)(\S.*?\S|\S)(?:\*\*|__)\s*$/;
const BREAKS_PARAGRAPH = /^ {0,3}(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>|(?:\*\*|__)\S)/;
const NOTHING_RUNNING = /^nothing\b|^(?:none|idle)\b/i;

interface Found { label: Label; text: string }

const plain = (text: string): string => text.replace(/\*\*|__|`/g, '').trim();

// One reply's bold label lines outside code; a paragraph's following lines join its label line.
function labelLines(markdown: string): { headline: string; found: Found[] } {
  const inCode = codeFenceTracker();
  const found: Found[] = [];
  let headline = '';
  let open: Found | null = null;
  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    if (inCode(line)) { open = null; continue; }
    const match = LABEL_LINE.exec(line);
    if (match?.[1] && match[2]) {
      open = { label: match[1].toLowerCase() as Label, text: match[2] };
      found.push(open);
      continue;
    }
    if (!headline && !found.length) headline = plain(HEADLINE.exec(line)?.[1] ?? '');
    if (!line.trim() || BREAKS_PARAGRAPH.test(line) || parseStatusLine(line)) open = null;
    else if (open) open.text += ` ${line.trim()}`;
  }
  return { headline, found };
}

const answerFrom = (prompt: string | undefined): string => (prompt ? stripPasted(prompt).replace(/\s+/g, ' ').trim() : '');

// The newest reply's Doing line, unless it says nothing is running.
function doingNow(markdown: string): string | null {
  const inCode = codeFenceTracker();
  for (const line of markdown.split('\n')) {
    if (inCode(line)) continue;
    const status = parseStatusLine(line);
    if (status?.key === 'doing') return NOTHING_RUNNING.test(plain(status.text)) ? null : status.text;
  }
  return null;
}

// Replies newest first; `waiting` is her prompts sent after the newest reply, oldest first.
export function confirmedItems(newestFirst: readonly ConfirmedReply[], waiting: readonly string[] = []): ConfirmedGroups {
  const groups: ConfirmedGroups = { verified: [], decided: [], done: [], progress: [] };
  newestFirst.forEach((reply, index) => {
    const { headline, found } = labelLines(reply.markdown);
    const item = (text: string): ConfirmedItem => ({ text, context: headline, replyId: reply.id });
    for (const { label, text } of found) {
      if (label === 'checked') groups.verified.push(item(text));
      else if (label === 'done' || label === 'result') groups.done.push(item(text));
    }
    const decide = found.filter((f) => f.label === 'decide').at(-1);
    if (!decide) return;
    const answer = answerFrom(index > 0 ? newestFirst[index - 1]?.prompt : waiting[0]);
    if (answer) groups.decided.push({ ...item(decide.text), answer });
    else groups.progress.push({ ...item(decide.text), pill: 'Waiting on you' });
  });
  const newest = newestFirst[0];
  const doing = newest ? doingNow(newest.markdown) : null;
  if (newest && doing) groups.progress.unshift({ text: doing, context: labelLines(newest.markdown).headline, pill: 'In progress', replyId: newest.id });
  return groups;
}

export const confirmedCount = (groups: ConfirmedGroups): number => GROUP_ORDER.reduce((sum, key) => sum + groups[key].length, 0);

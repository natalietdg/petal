// The Confirmed page: what a session's replies checked, decided, finished, and still have running.
import { codeFenceTracker, parseStatusLine } from './status-lines';
import { stripPasted } from './pasted-content';
import { imageCodePath, imageTextPaths, isLocalImageSrc } from './image-paths';

export interface ConfirmedReply {
  id: string | undefined;
  markdown: string;
  prompt: string;
}

export type ConfirmedPill = 'In progress' | 'Waiting on you';

export interface ConfirmedItem {
  text: string; // markdown, rendered inline; for a screen, the image path
  context: string; // the reply's headline, plain text, or ''
  answer?: string; // her next prompt, for a decision
  pill?: ConfirmedPill;
  image?: string; // a screen's path, as the reply wrote it
  replyId: string | undefined;
}

export interface ConfirmedGroups {
  screens: ConfirmedItem[];
  features: ConfirmedItem[];
  facts: ConfirmedItem[];
  decided: ConfirmedItem[];
  done: ConfirmedItem[];
  progress: ConfirmedItem[];
}

export type GroupKey = keyof ConfirmedGroups;

// The page's sections in order; Verified splits into three titled parts.
export const SECTIONS: { key: string; title: string; parts: { key: GroupKey; title: string | null }[] }[] = [
  { key: 'verified', title: 'Verified', parts: [{ key: 'screens', title: 'Screens' }, { key: 'features', title: 'Features' }, { key: 'facts', title: 'Facts' }] },
  { key: 'decided', title: 'Decided', parts: [{ key: 'decided', title: null }] },
  { key: 'done', title: 'Done', parts: [{ key: 'done', title: null }] },
  { key: 'progress', title: 'In progress', parts: [{ key: 'progress', title: null }] },
];

type Label = 'checked' | 'verified' | 'decide' | 'done' | 'result';

// "**Done:** x", "**Done**: x", "- **Result:** x"; bold only, so a prose "Done:" stays prose.
const LABEL_LINE = /^ {0,3}(?:[-*+]\s+)?(?:\*\*|__)\s*(checked|verified|decide|done|result)\s*:?\s*(?:\*\*|__)\s*:?\s*(\S.*?)\s*$/i;
const HEADLINE = /^ {0,3}(?:\*\*|__)(\S.*?\S|\S)(?:\*\*|__)\s*$/;
const BREAKS_PARAGRAPH = /^ {0,3}(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>|(?:\*\*|__)\S)/;
const NOTHING_RUNNING = /^nothing\b|^(?:none|idle)\b/i;
const MD_IMAGE = /!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const MD_LINK_TARGET = /\]\([^)]*\)/g;
const INLINE_CODE = /`([^`\n]+)`/g;

interface Found { label: Label; text: string }

const plain = (text: string): string => text.replace(/\*\*|__|`/g, '').trim();

// "the toolbar renders" reads "The toolbar renders"; code or bold at the start is left as written.
const capitalised = (text: string): string => text.replace(/^[a-z]/, (letter) => letter.toUpperCase());

// Pictures one line shows, the way the reply renders them: Markdown images, inline-code paths, then paths in the prose.
function lineImages(line: string): string[] {
  const images = [...line.matchAll(MD_IMAGE)].map((m) => m[1] ?? '').filter(isLocalImageSrc);
  const codePaths = [...line.matchAll(INLINE_CODE)].map((m) => imageCodePath(m[1] ?? '')).filter((p): p is string => Boolean(p));
  const prose = line.replace(MD_IMAGE, ' ').replace(INLINE_CODE, ' ').replace(MD_LINK_TARGET, ']');
  return [...images, ...codePaths, ...imageTextPaths(prose)];
}

// One reply's bold label lines and pictures outside code; a paragraph's following lines join its label line.
function readReply(markdown: string): { headline: string; found: Found[]; images: string[] } {
  const inCode = codeFenceTracker();
  const found: Found[] = [];
  const images = new Set<string>();
  let headline = '';
  let open: Found | null = null;
  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    if (inCode(line)) { open = null; continue; }
    for (const image of lineImages(line)) images.add(image);
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
  return { headline, found, images: [...images] };
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

const LABEL_GROUP: Partial<Record<Label, GroupKey>> = { checked: 'facts', verified: 'features', done: 'done', result: 'done' };

// Replies newest first; `waiting` is her prompts sent after the newest reply, oldest first.
export function confirmedItems(newestFirst: readonly ConfirmedReply[], waiting: readonly string[] = []): ConfirmedGroups {
  const groups: ConfirmedGroups = { screens: [], features: [], facts: [], decided: [], done: [], progress: [] };
  newestFirst.forEach((reply, index) => {
    const { headline, found, images } = readReply(reply.markdown);
    const item = (text: string): ConfirmedItem => ({ text: capitalised(text), context: headline, replyId: reply.id });
    for (const image of images) groups.screens.push({ text: image, context: headline, image, replyId: reply.id });
    for (const { label, text } of found) {
      const group = LABEL_GROUP[label];
      if (group) groups[group].push(item(text));
    }
    const decide = found.filter((f) => f.label === 'decide').at(-1);
    if (!decide) return;
    const answer = answerFrom(index > 0 ? newestFirst[index - 1]?.prompt : waiting[0]);
    if (answer) groups.decided.push({ ...item(decide.text), answer });
    else groups.progress.push({ ...item(decide.text), pill: 'Waiting on you' });
  });
  const newest = newestFirst[0];
  const doing = newest ? doingNow(newest.markdown) : null;
  if (newest && doing) groups.progress.unshift({ text: capitalised(doing), context: readReply(newest.markdown).headline, pill: 'In progress', replyId: newest.id });
  return groups;
}

export const confirmedCount = (groups: ConfirmedGroups): number => Object.values(groups).reduce((sum, items) => sum + items.length, 0);

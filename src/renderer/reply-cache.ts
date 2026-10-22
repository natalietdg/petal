// Each reply's rendered nodes, reused while its text is unchanged, so a redraw re-parses only the reply that changed.
import * as markdown from './markdown';
import { replyBlocks } from './reply-blocks';
import { copyReplyBar } from './copy-reply-button';
import { promptBubble } from './prompt-bubble';
import type { Reply } from '../shared/types';

export interface RenderedReply {
  blocks: HTMLElement[]; // one rendered block per text Claude wrote in the turn
  copy: HTMLElement;
  bubble: HTMLElement | null; // her prompt above the reply
  send: HTMLElement | null; // the Send to button; the reader swaps in a fresh one on every draw
  turn: { article: HTMLElement; time: HTMLElement } | null; // its earlier-turn article, once it has been shown as one
  diagramsDrawn: boolean;
}

const MAX_KEPT = 60; // the 20 replies the reader shows, for about three tabs

interface Kept {
  signature: string;
  rendered: RenderedReply;
}
const kept = new Map<string, Kept>();

// Everything the rendered nodes depend on; any change renders the reply afresh.
const signatureOf = (reply: Reply, cwd: string | null): string =>
  [cwd ?? '', reply.prompt, (reply.breaks ?? []).join(','), reply.markdown].join('\u0000');

function build(reply: Reply, key: string, cwd: string | null): RenderedReply {
  const blocks = replyBlocks(reply.markdown, reply.breaks)
    .map((block, i) => markdown.render(block, { fold: i ? `${key}#${i}` : key, images: { cwd } }));
  return {
    blocks,
    copy: copyReplyBar(reply.markdown, () => blocks),
    bubble: reply.prompt ? promptBubble('reader-you', reply.prompt) : null,
    send: null,
    turn: null,
    diagramsDrawn: false,
  };
}

// key: the reply's identity (its id, or its opening words), which is also its fold key.
export function renderedReply(reply: Reply, key: string, cwd: string | null): RenderedReply {
  const signature = signatureOf(reply, cwd);
  const known = kept.get(key);
  kept.delete(key); // re-added below, so the map stays in least-recently-shown order
  const rendered = known?.signature === signature ? known.rendered : build(reply, key, cwd);
  kept.set(key, { signature, rendered });
  if (kept.size > MAX_KEPT) kept.delete(kept.keys().next().value ?? key);
  return rendered;
}

// A theme switch: diagrams take their colours from the theme, so every reply renders afresh.
export function forgetAll(): void {
  kept.clear();
}

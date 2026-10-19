// Groups Claude Code jsonl entries into replies: all assistant text between two user prompts.
import { contentItems, imagePasteIds, imageSources, isAgentMessage, isUserTurn, queuedPromptText, rawPromptText } from './prompts';
import { placeImageSources } from '../shared/image-paths';
import type { TranscriptEntry } from './transcript-entry';
import type { Reply, WaitingPrompt } from '../shared/types';

const MAX_REPLIES = 20;

export function assistantText(entry: TranscriptEntry): string {
  if (entry.type !== 'assistant' || entry.isSidechain) return '';
  return contentItems(entry)
    .filter((item): item is typeof item & { text: string } => item.type === 'text' && Boolean(item.text?.trim()))
    .map((item) => item.text.trim())
    .join('\n\n');
}

export class ReplyCollector {
  private readonly maxReplies: number;
  private readonly replies: Reply[] = [];
  private turnOpen = false;
  private waitingPrompts: WaitingPrompt[] = []; // her prompts since Claude last wrote text
  private imageTurn: { holder: { prompt: string }; ids: number[] } | null = null; // her latest prompt, until its image paths arrive
  promptCount = 0; // her prompts so far; the renderer matches its sent-message echoes against it

  constructor(maxReplies = MAX_REPLIES) {
    this.maxReplies = maxReplies;
  }

  // Returns true when the visible replies changed.
  add(entry: TranscriptEntry): boolean {
    const sources = imageSources(entry);
    if (sources.length) return this.placeSources(sources);
    const queued = queuedPromptText(entry);
    if (isUserTurn(entry) || queued) {
      this.turnOpen = false; // Claude's answer to a queued message is a new reply too
      const prompt = queued || rawPromptText(entry); // the bubble splits out pasted blocks
      if (!prompt) return false;
      this.imageTurn = null;
      if (this.adoptLatePrompt(entry, prompt)) return true;
      const waiting = { id: entry.uuid, timestamp: entry.timestamp, prompt };
      this.waitingPrompts.push(waiting);
      this.imageTurn = { holder: waiting, ids: imagePasteIds(entry) };
      this.promptCount += 1;
      return true; // shown at once, before any reply
    }
    if (isAgentMessage(entry)) {
      this.turnOpen = false; // Claude's answer to it is a new reply, not more of the one above
      return false;
    }
    const text = assistantText(entry);
    if (!text) return false;

    const open = this.turnOpen ? this.replies.at(-1) : undefined;
    if (open) {
      open.markdown += '\n\n';
      open.breaks = [...(open.breaks ?? []), open.markdown.length]; // where this text starts, so it never folds into a section above
      open.markdown += text;
    } else {
      // What she asked, shown above the reply; two sends before Claude answers share one bubble.
      const prompt = this.waitingPrompts.map((p) => p.prompt).join('\n\n');
      const reply: Reply = { id: entry.uuid, timestamp: entry.timestamp, markdown: text, prompt };
      this.replies.push(reply);
      if (this.imageTurn) this.imageTurn.holder = reply; // its paths can land after the reply starts
      this.waitingPrompts = [];
      this.turnOpen = true;
      if (this.replies.length > this.maxReplies) this.replies.shift();
    }
    return true;
  }

  // Claude Code can write a turn's first reply line before the prompt that started it (the prompt line carries the
  // turn's attachments). A prompt timestamped no later than the newest reply, which has no prompt yet, belongs to it.
  private adoptLatePrompt(entry: TranscriptEntry, prompt: string): boolean {
    const newest = this.replies.at(-1);
    if (!newest || newest.prompt || this.waitingPrompts.length) return false;
    const promptAt = Date.parse(entry.timestamp ?? '');
    const replyAt = Date.parse(newest.timestamp ?? '');
    if (!Number.isFinite(promptAt) || !Number.isFinite(replyAt) || promptAt > replyAt) return false;
    newest.prompt = prompt;
    this.imageTurn = { holder: newest, ids: imagePasteIds(entry) };
    this.promptCount += 1;
    return true;
  }

  // Her pasted images' paths, put where their "[Image #n]" sits so the bubble shows the pictures.
  private placeSources(sources: string[]): boolean {
    if (!this.imageTurn) return false;
    const { holder, ids } = this.imageTurn;
    holder.prompt = placeImageSources(holder.prompt, sources, ids);
    this.imageTurn = null;
    return true;
  }

  // Her prompts that Claude hasn't written any text for yet, oldest first.
  waiting(): WaitingPrompt[] {
    return [...this.waitingPrompts];
  }

  newestFirst(): Reply[] {
    return [...this.replies].reverse();
  }
}

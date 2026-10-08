// Groups Claude Code jsonl entries into replies: all assistant text between two user prompts.
import { contentItems, isUserTurn, rawPromptText } from './prompts';
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
  promptCount = 0; // her prompts so far; the renderer matches its sent-message echoes against it

  constructor(maxReplies = MAX_REPLIES) {
    this.maxReplies = maxReplies;
  }

  // Returns true when the visible replies changed.
  add(entry: TranscriptEntry): boolean {
    if (isUserTurn(entry)) {
      this.turnOpen = false;
      const prompt = rawPromptText(entry); // the bubble splits out pasted blocks
      if (!prompt) return false;
      this.waitingPrompts.push({ id: entry.uuid, timestamp: entry.timestamp, prompt });
      this.promptCount += 1;
      return true; // shown at once, before any reply
    }
    const text = assistantText(entry);
    if (!text) return false;

    const open = this.turnOpen ? this.replies.at(-1) : undefined;
    if (open) {
      open.markdown += `\n\n${text}`;
    } else {
      // What she asked, shown above the reply; two sends before Claude answers share one bubble.
      const prompt = this.waitingPrompts.map((p) => p.prompt).join('\n\n');
      this.replies.push({ id: entry.uuid, timestamp: entry.timestamp, markdown: text, prompt });
      this.waitingPrompts = [];
      this.turnOpen = true;
      if (this.replies.length > this.maxReplies) this.replies.shift();
    }
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

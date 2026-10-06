// Groups Claude Code jsonl entries into replies: all assistant text between two user prompts.
import { contentItems, isUserTurn, promptText } from './prompts';
import type { TranscriptEntry } from './transcript-entry';
import type { Reply } from '../shared/types';

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
  private lastPrompt = '';

  constructor(maxReplies = MAX_REPLIES) {
    this.maxReplies = maxReplies;
  }

  // Returns true when the visible replies changed.
  add(entry: TranscriptEntry): boolean {
    if (isUserTurn(entry)) {
      this.turnOpen = false;
      this.lastPrompt = promptText(entry) || this.lastPrompt; // what she asked, shown above the reply
      return false;
    }
    const text = assistantText(entry);
    if (!text) return false;

    const open = this.turnOpen ? this.replies.at(-1) : undefined;
    if (open) {
      open.markdown += `\n\n${text}`;
    } else {
      this.replies.push({ id: entry.uuid, timestamp: entry.timestamp, markdown: text, prompt: this.lastPrompt });
      this.lastPrompt = '';
      this.turnOpen = true;
      if (this.replies.length > this.maxReplies) this.replies.shift();
    }
    return true;
  }

  newestFirst(): Reply[] {
    return [...this.replies].reverse();
  }
}

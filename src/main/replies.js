// Groups Claude Code jsonl entries into replies: all assistant text between two user prompts.
const { contentItems, isUserTurn, promptText } = require('./prompts');

const MAX_REPLIES = 20;

function assistantText(entry) {
  if (entry.type !== 'assistant' || entry.isSidechain) return '';
  return contentItems(entry)
    .filter((item) => item.type === 'text' && item.text?.trim())
    .map((item) => item.text.trim())
    .join('\n\n');
}

class ReplyCollector {
  constructor(maxReplies = MAX_REPLIES) {
    this.maxReplies = maxReplies;
    this.replies = [];
    this.turnOpen = false;
    this.lastPrompt = '';
  }

  // Returns true when the visible replies changed.
  add(entry) {
    if (isUserTurn(entry)) {
      this.turnOpen = false;
      this.lastPrompt = promptText(entry) || this.lastPrompt; // what she asked, shown above the reply
      return false;
    }
    const text = assistantText(entry);
    if (!text) return false;

    if (this.turnOpen) {
      this.replies[this.replies.length - 1].markdown += `\n\n${text}`;
    } else {
      this.replies.push({ id: entry.uuid, timestamp: entry.timestamp, markdown: text, prompt: this.lastPrompt });
      this.lastPrompt = '';
      this.turnOpen = true;
      if (this.replies.length > this.maxReplies) this.replies.shift();
    }
    return true;
  }

  newestFirst() {
    return [...this.replies].reverse();
  }
}

module.exports = { ReplyCollector, assistantText };

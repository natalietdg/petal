// The reviewer's prompt for one turn: the recorded reasoning as numbered excerpts, each function's diff, and the JSON to
// answer with. Emails and secret-looking values are removed from everything sent. Also the local token estimate.
import { diffText } from '../shared/line-diff';
import { CHARS_PER_TOKEN, CLAUDE_CODE_OVERHEAD_TOKENS, OUTPUT_TOKENS_PER_CALL } from '../shared/library-cost';
import { TOKENS_PER_ANSWER, redactSecrets, type FunctionCard, type ReasoningExcerpt } from '../shared/code-review';

const FUNCTIONS_PER_CALL = 24; // a big turn goes in several calls, so no answer list gets cut off
const MAX_REASONING_CHARS = 14_000;
const EXPLORE_TOKENS_PER_CALL = 4000; // the reviewer may read a file or two for context

export interface ReviewPrompt {
  text: string;
  ids: Map<string, string>; // F1 -> card key
}

const INSTRUCTIONS = `You are reviewing code that another Claude session wrote. For EVERY function listed, explain why it is written like this.
For each one give:
- shape: the shape chosen (structure, data flow, notable choices), in one or two sentences
- driver: the constraint or requirement that drove it
- alternatives: the alternatives a reader might expect, and why not those
- risk: any risk, edge case or debt; say "none seen" if none
- basis: "recorded" only when a quote copied exactly from one of the R excerpts below supports your answer; otherwise "inferred"
- quote: the exact words from that excerpt (at most two sentences), or null when inferred
An inferred answer is your own reading; say so plainly, never present it as the session's stated reason.
You may read files in this repository for context. Do not change anything.
Reply with JSON only, no prose and no code fence, exactly one answer per function id and no other ids:
{"answers":[{"id":"F1","shape":"…","driver":"…","alternatives":"…","risk":"…","basis":"recorded","quote":"…"}]}`;

// The excerpts, newest kept when they don't all fit.
function reasoningBlock(reasoning: readonly ReasoningExcerpt[]): string {
  const kept: string[] = [];
  let size = 0;
  for (const r of [...reasoning].reverse()) {
    const line = `[R${r.id}] (${r.kind === 'thinking' ? 'thinking' : 'said'}) ${r.text}`;
    if (size + line.length > MAX_REASONING_CHARS) break;
    kept.unshift(line);
    size += line.length;
  }
  return kept.length ? kept.join('\n\n') : '(The session recorded no reasoning for this turn. Every answer is inferred.)';
}

const functionBlock = (id: string, card: FunctionCard): string => {
  const what = card.kind === 'function' ? `function ${card.name}` : card.kind === 'module' ? 'module level (code outside any function)' : 'changed lines';
  const after = card.reasoning ? ` · written after R${card.reasoning}` : '';
  const state = !card.before ? ' · new' : !card.after ? ' · removed' : '';
  return `[${id}] ${card.display} · ${what}${state}${after}\n\`\`\`diff\n${diffText(card.before, card.after)}\n\`\`\``;
};

// One prompt per batch of functions.
export function reviewPrompts(cards: readonly FunctionCard[], reasoning: readonly ReasoningExcerpt[]): ReviewPrompt[] {
  const prompts: ReviewPrompt[] = [];
  for (let start = 0; start < cards.length; start += FUNCTIONS_PER_CALL) {
    const batch = cards.slice(start, start + FUNCTIONS_PER_CALL);
    const ids = new Map(batch.map((card, i) => [`F${i + 1}`, card.key]));
    const blocks = batch.map((card, i) => functionBlock(`F${i + 1}`, card));
    const text = `${INSTRUCTIONS}\n\n## Recorded reasoning\n\n${reasoningBlock(reasoning)}\n\n## Functions\n\n${blocks.join('\n\n')}\n`;
    prompts.push({ text: redactSecrets(text), ids });
  }
  return prompts;
}

// Tokens to read and write, counted locally like the Library's estimate; no call is made.
export function estimateTokens(prompts: readonly ReviewPrompt[]): number {
  return prompts.reduce((sum, p) => {
    const read = Math.ceil(p.text.length / CHARS_PER_TOKEN) + CLAUDE_CODE_OVERHEAD_TOKENS + EXPLORE_TOKENS_PER_CALL;
    return sum + read + Math.max(OUTPUT_TOKENS_PER_CALL, p.ids.size * TOKENS_PER_ANSWER);
  }, 0);
}

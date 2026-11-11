// A headline is the main point in ten words or fewer. A longer one is still shown, with its word count beside it,
// so the length is seen before it is read.
export const HEADLINE_WORD_BUDGET = 10;

export const wordCount = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

// Every word Claude wrote in a session so far, as "9.8k words" or "640 words", for the reader's status line.
export function sessionWordsLine(markdowns: readonly string[]): string {
  const total = markdowns.reduce((sum, text) => sum + wordCount(text), 0);
  const shown = total >= 10_000 ? `${Math.round(total / 1000)}k` : total >= 1000 ? `${(total / 1000).toFixed(1)}k` : String(total);
  return `${shown} words this session`;
}

// The word count when the headline is over budget, otherwise null.
export function headlineOverBudget(text: string): number | null {
  const words = wordCount(text);
  return words > HEADLINE_WORD_BUDGET ? words : null;
}

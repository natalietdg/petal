// "## Open threads": questions a reply left open, each with the check that would settle it.

// "Open threads", "Open thread", "4. Open threads", any case; the number is what wrapStory leaves in front.
const THREADS_HEADING = /^(?:\d+[.)]\s*)?open\s+threads?$/i;
export const isOpenThreadsHeading = (text: string): boolean => THREADS_HEADING.test(text.trim().replace(/:$/, '').trim());

// "Checked:" opens the evidence line under the dek; "Assumed" titles the sidebar of things taken on trust.
export const isCheckedLabel = (text: string): boolean => /^\s*checked\s*:?\s*$/i.test(text);
export const isAssumedTitle = (text: string): boolean => /^\s*assumed\s*:?\s*$/i.test(text);

// Where the last "Check:" starts in an item's text, after some question; -1 when the item has none.
export function threadCheckStart(text: string): number {
  let at = -1;
  for (const match of text.matchAll(/(^|[\s(])check\s*:/gi)) {
    const start = match.index + (match[1]?.length ?? 0);
    if (text.slice(0, start).trim()) at = start;
  }
  return at;
}

export interface Thread {
  question: string;
  check: string | null;
}

const tidy = (text: string): string => text.replace(/\s+/g, ' ').trim();

// One item's plain text split into its question and its check.
export function splitThread(text: string): Thread {
  const at = threadCheckStart(text);
  if (at < 0) return { question: tidy(text), check: null };
  const check = tidy(text.slice(at).replace(/^check\s*:/i, '')).replace(/^[(]|[)]$/g, '').trim();
  return { question: tidy(text.slice(0, at)).replace(/\s*[(]$/, ''), check: check || null };
}

// What a card sends as her next message: the question, and the check so Claude knows what to run.
export const threadPrompt = ({ question, check }: Thread): string => (check ? `${question} Check: ${check}` : question);

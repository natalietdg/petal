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

// ---- Threads read straight from a reply's markdown (the Testing tab's distillation; the reader builds cards from the DOM).
const MD_HEADING = /^\s*#{1,6}\s+(.+?)\s*#*\s*$/;
const MD_ITEM = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;
const FENCE_LINE = /^\s*(```|~~~)/;
const plainText = (text: string): string => text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*|__|`/g, '').replace(/(^|[\s(])[*_]([^*_]+)[*_](?=[\s).,:;!?]|$)/g, '$1$2');

// The first "## Open threads" section's items as threads; continuation lines join their item; code is skipped.
export function parseThreads(markdown: string, cap = 12): Thread[] {
  const items: string[] = [];
  let inSection = false;
  let fenced = false;
  let done = false;
  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    if (FENCE_LINE.test(line)) { fenced = !fenced; continue; }
    if (fenced || done) continue;
    const heading = MD_HEADING.exec(line);
    if (heading) {
      if (inSection) { done = true; continue; }
      inSection = isOpenThreadsHeading(plainText(heading[1] ?? ''));
      continue;
    }
    if (!inSection) continue;
    if (/^\s*(?:\*\*|__)[^*_]+(?:\*\*|__)?\s*:/.test(line) && !MD_ITEM.test(line)) { done = true; continue; } // a "**Loop:**" or "**Course:**" line ends the list
    const item = MD_ITEM.exec(line);
    if (item && (item[1] ?? '').length < 4) items.push(item[2] ?? '');
    else if (line.trim() && items.length) items[items.length - 1] += ` ${line.trim()}`;
  }
  return items.map((text) => splitThread(plainText(text))).filter((t) => t.question).slice(0, cap);
}

// A thread only she can settle says so in its Check: "Check: needs you · which plan is right".
export const threadNeedsYou = (thread: Thread): boolean => /\bneeds\s+you\b/i.test(thread.check ?? '');

const words = (text: string): Set<string> => new Set(text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2));

// The same thread asked again, maybe reworded: equal text, or most of its words shared.
export function sameThread(a: string, b: string): boolean {
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return a.trim().toLowerCase() === b.trim().toLowerCase();
  let shared = 0;
  for (const w of x) if (y.has(w)) shared += 1;
  return shared / Math.max(x.size, y.size) >= 0.6;
}

// A session's conclusion: her "conclude" prompt and Claude's Conclusion / Result / Impact reply to it.
import { stripPasted } from './pasted-content';

export interface Conclusion {
  title: string; // the bold line above the labels, or ''
  conclusion: string;
  result: string;
  impact: string;
  at: string | null; // when Claude answered the conclude prompt
}

export const CONCLUSION_FIELDS = ['conclusion', 'result', 'impact'] as const;
type Field = (typeof CONCLUSION_FIELDS)[number];

const MAX_PROMPT_CHARS = 80;
// "conclude", "Conclude.", "conclude: shipped", "conclude — shipped"; a note needs a separator,
// so a sentence like "conclude the refactor later" stays an ordinary prompt.
const CONCLUDE = /^conclude(?:\s*[.!]+)?(?:\s*[:,\-–—]\s*\S[\s\S]*)?$/i;

export function isConcludePrompt(prompt: string): boolean {
  const text = stripPasted(prompt).trim();
  return text.length <= MAX_PROMPT_CHARS && CONCLUDE.test(text);
}

// Only a bare "conclude" (or "Conclude." / "conclude!") ends the session. A note such as
// "conclude, but keep it open" or a paste alongside it still pins the banner, and the session stays.
const CONCLUDE_ALONE = /^conclude\s*[.!]*$/i;
export const isClosingConcludePrompt = (rawPrompt: string): boolean => CONCLUDE_ALONE.test(rawPrompt.trim());

const timeOf = (iso: string | null | undefined): number | null => {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(ms) ? null : ms;
};

// Still the session's last word: nothing newer came after it. An unknown time never hides it (as on the board).
export function conclusionIsLatest(conclusion: Conclusion, laterTimes: readonly (string | null | undefined)[]): boolean {
  const at = timeOf(conclusion.at);
  return at === null || laterTimes.every((time) => (timeOf(time) ?? at) <= at);
}

// **Conclusion:** · **Conclusion.** · **Conclusion**: · Conclusion: · ## Conclusion; optionally as a list item.
const LABEL = /^\s*(?:[-*+]\s+)?(?:(?:\*\*|__)\s*(conclusion|result|impact)\s*[:.]?\s*(?:\*\*|__)\s*:?|(conclusion|result|impact)\s*:|#{1,6}\s+(conclusion|result|impact)\s*[:.]?\s*$)\s*(.*)$/i;
const HEADING = /^\s*#{1,6}\s/;
const TITLE = /^\s*(?:#{1,6}\s+.+|(?:\*\*|__).+(?:\*\*|__))\s*$/;

const plain = (text: string): string => text.replace(/\*\*|__|`/g, '').replace(/^#{1,6}\s+/, '').replace(/\s+/g, ' ').trim();

function labelOf(line: string): { field: Field; rest: string } | null {
  const match = LABEL.exec(line);
  const name = match && (match[1] ?? match[2] ?? match[3]);
  return name ? { field: name.toLowerCase() as Field, rest: match[4] ?? '' } : null;
}

const firstParagraph = (lines: string[]): string => {
  const start = lines.findIndex((line) => line.trim());
  if (start === -1) return '';
  const end = lines.findIndex((line, i) => i > start && !line.trim());
  return plain(lines.slice(start, end === -1 ? undefined : end).join(' '));
};

// Reads Claude's reply; with none of the labels, its first paragraph stands in as the conclusion.
export function parseConclusion(reply: string, at: string | null = null): Conclusion | null {
  const lines = reply.split(/\r?\n/);
  const found: Partial<Record<Field, string>> = {};
  let title = '';
  let current: { field: Field; parts: string[] } | null = null;
  const close = () => {
    if (current && !found[current.field]) found[current.field] = plain(current.parts.join(' '));
    current = null;
  };
  for (const line of lines) {
    const label = labelOf(line);
    if (label) {
      close();
      current = { field: label.field, parts: label.rest.trim() ? [label.rest] : [] };
      continue;
    }
    if (!current) {
      if (!title && Object.keys(found).length === 0 && TITLE.test(line)) title = plain(line);
      continue;
    }
    if (!line.trim()) {
      if (current.parts.length) close(); // a heading label's text may start after a blank line
      continue;
    }
    if (HEADING.test(line)) close();
    else current.parts.push(line);
  }
  close();
  if (CONCLUSION_FIELDS.some((field) => found[field])) {
    return { title, conclusion: found.conclusion ?? '', result: found.result ?? '', impact: found.impact ?? '', at };
  }
  const fallback = firstParagraph(lines);
  return fallback ? { title: '', conclusion: fallback, result: '', impact: '', at } : null;
}

// The one line History shows under the row's title.
export const conclusionGist = (c: Conclusion): string => c.conclusion || c.result || c.impact || c.title;

export const sameConclusion = (a: Conclusion | null, b: Conclusion | null): boolean => JSON.stringify(a) === JSON.stringify(b);

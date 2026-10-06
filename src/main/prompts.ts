// What counts as a real user prompt in a Claude Code transcript (not a tool result, wrapper or reminder).
import { isTextItem, type ContentItem, type TranscriptEntry } from './transcript-entry';

const WRAPPER = /^\s*<(command-|local-command|system-reminder|bash-|user-prompt-submit-hook|task-notification)/;
const INTERRUPTED = /^\[Request interrupted/;

export function contentItems(entry: TranscriptEntry): ContentItem[] {
  const content = entry.message?.content;
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return Array.isArray(content) ? content : [];
}

// Any user turn boundary; matches how the reader groups replies.
export function isUserTurn(entry: TranscriptEntry): boolean {
  if (entry.type !== 'user' || entry.isMeta || entry.isSidechain) return false;
  return !contentItems(entry).some((item) => item.type === 'tool_result');
}

// The typed prompt text, or '' when the turn is a wrapper, reminder or interruption.
export function promptText(entry: TranscriptEntry): string {
  if (!isUserTurn(entry)) return '';
  const text = contentItems(entry)
    .filter(isTextItem)
    .map((item) => item.text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ''))
    .join(' ')
    .trim();
  return WRAPPER.test(text) || INTERRUPTED.test(text) ? '' : text;
}

// A slash-command turn ("/release args") as typed, or '' when the turn isn't one.
export function commandText(entry: TranscriptEntry): string {
  if (!isUserTurn(entry)) return '';
  const text = contentItems(entry).filter(isTextItem).map((item) => item.text).join(' ');
  const name = /<command-name>\s*([^<]+?)\s*<\/command-name>/.exec(text)?.[1];
  if (!name) return '';
  const args = /<command-args>\s*([\s\S]*?)\s*<\/command-args>/.exec(text)?.[1] ?? '';
  return `${name.startsWith('/') ? name : `/${name}`}${args ? ` ${args}` : ''}`;
}

export const trimTo = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

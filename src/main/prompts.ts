// What counts as a real user prompt in a Claude Code transcript (not a tool result, wrapper or reminder).
import { isTextItem, type ContentItem, type TranscriptEntry } from './transcript-entry';
import { stripPasted } from '../shared/pasted-content';

const WRAPPER = /^\s*<(command-|local-command|system-reminder|bash-|user-prompt-submit-hook|task-notification)/;
const INTERRUPTED = /^\[Request interrupted/;

export function contentItems(entry: TranscriptEntry): ContentItem[] {
  const content = entry.message?.content;
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return Array.isArray(content) ? content : [];
}

// Any user turn boundary; matches how the reader groups replies.
export function isUserTurn(entry: TranscriptEntry): boolean {
  if (entry.type !== 'user' || entry.isMeta || entry.isSidechain || entry.isCompactSummary) return false; // a compact summary is Claude Code's, not hers
  return !contentItems(entry).some((item) => item.type === 'tool_result');
}

// A message from another agent that Claude answers in a new turn of its own: a subagent's hand-back, or a peer's SendMessage.
// Mid-turn ones arrive as queued_command attachments instead, and stay part of the turn.
export const isAgentMessage = (entry: TranscriptEntry): boolean =>
  entry.type === 'user' && !entry.isSidechain && (entry.origin?.handback === true || entry.origin?.kind === 'peer');

const promptOf = (items: ContentItem[]): string => {
  const text = items
    .filter(isTextItem)
    .map((item) => item.text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ''))
    .join(' ')
    .trim();
  return WRAPPER.test(text) || INTERRUPTED.test(text) ? '' : text;
};

// The prompt as logged, paste wrappers kept for the bubbles; '' when the turn is a wrapper, reminder or interruption.
export function rawPromptText(entry: TranscriptEntry): string {
  return isUserTurn(entry) ? promptOf(contentItems(entry)) : '';
}

// Her message sent while Claude works: Claude Code logs it only as a queued_command attachment, never a user entry.
export function queuedPromptText(entry: TranscriptEntry): string {
  const queued = entry.type === 'attachment' && !entry.isSidechain ? entry.attachment : undefined;
  if (queued?.type !== 'queued_command' || queued.commandMode !== 'prompt' || (queued.origin?.kind ?? 'human') !== 'human') return '';
  const { prompt } = queued;
  return promptOf(typeof prompt === 'string' ? [{ type: 'text', text: prompt }] : Array.isArray(prompt) ? prompt : []);
}

// The prompt as plain text for titles, previews and search: paste wrapper tags removed.
export const promptText = (entry: TranscriptEntry): string => stripPasted(rawPromptText(entry));

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

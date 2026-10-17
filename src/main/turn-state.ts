// Busy or idle read from the transcript itself, for Claude Code before 2.1.119 (its session file has no `status`).
import type { ContentItem, TranscriptEntry } from './transcript-entry';

// After the log's last change Claude counts as busy this long, so a reply that lands between two ticks is still seen.
export const QUIET_MS = 2500;

// Local commands (/model, /cost) answer themselves; nothing waits on Claude after them.
const LOCAL_COMMAND = /^\s*<(command-name|command-message|command-args|local-command-stdout|local-command-stderr)>/;
const INTERRUPTED = /^\s*\[Request interrupted by user/;

const textOf = (content: string | ContentItem[]): string =>
  (typeof content === 'string' ? content : content.map((item) => (item.type === 'text' ? item.text ?? '' : '')).join(''));

// Whether Claude still owes a turn after this entry; null when the entry says nothing about it.
export function turnOpenAfter(entry: TranscriptEntry): boolean | null {
  if (entry.isSidechain || entry.isMeta || entry.isCompactSummary) return null;
  const content = entry.message?.content;
  if (content === undefined) return null;
  if (entry.type === 'assistant') {
    const items = typeof content === 'string' ? [{ type: 'text', text: content }] : content;
    const usesTool = items.some((item) => item.type === 'tool_use') || entry.message?.stop_reason === 'tool_use';
    const wroteText = items.some((item) => item.type === 'text');
    return usesTool || (!entry.message?.stop_reason && !wroteText); // a thinking block alone: the text is still coming
  }
  if (entry.type !== 'user') return null;
  const hasToolResult = typeof content !== 'string' && content.some((item) => item.type === 'tool_result');
  if (hasToolResult) return true; // Claude carries on after a tool
  const text = textOf(content);
  if (INTERRUPTED.test(text)) return false;
  if (LOCAL_COMMAND.test(text)) return null;
  return true; // her prompt
}

// Folds entries into one open/closed flag.
export class TurnTracker {
  open = false;

  // True when the flag changed.
  add(entry: TranscriptEntry): boolean {
    const next = turnOpenAfter(entry);
    if (next === null || next === this.open) return false;
    this.open = next;
    return true;
  }
}

// The status to use: the session file's when it has one, otherwise derived from the log.
export function derivedStatus(fileStatus: string | undefined, turnOpen: boolean, lastChangeAt: number, now: number): string {
  if (fileStatus !== undefined) return fileStatus;
  return turnOpen || now - lastChangeAt < QUIET_MS ? 'busy' : 'idle';
}

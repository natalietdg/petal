// Plain-words activity lines from the tail of a Claude Code jsonl (read-only, last 64KB).
import path from 'node:path';
import { readTail } from './jsonl-window';
import type { ContentItem, TranscriptEntry } from './transcript-entry';

const TAIL_BYTES = 64 * 1024;
const MAX_TAIL_BYTES = 256 * 1024; // big attachment entries can push the last reply past 64KB
const SNIPPET = 60;

export interface Activity {
  text: string | undefined; // undefined for a nameless tool_use, as before
  at: string | undefined;
}

const clip = (text: unknown): string => {
  const flat = String(text ?? '').replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim();
  return flat.length > SNIPPET ? `${flat.slice(0, SNIPPET)}…` : flat;
};

const readTailEntries = (file: string, bytes: number): TranscriptEntry[] => readTail(file, bytes).entries;

function describeTool({ name, input = {} }: ContentItem): string | undefined {
  const base = (file: unknown) => path.basename(String(file ?? ''));
  switch (name) {
    case 'Bash': return clip(input.description || input.command);
    case 'Edit': case 'MultiEdit': case 'Write': case 'NotebookEdit': return `Editing ${base(input.file_path ?? input.notebook_path)}`;
    case 'Read': return `Reading ${base(input.file_path)}`;
    case 'Grep': case 'Glob': return 'Searching';
    case 'Agent': case 'Task': return `Subagent: ${clip(input.description)}`;
    default: return name;
  }
}

function activitiesOf(entry: TranscriptEntry): Activity[] {
  const content = entry.message?.content;
  if (entry.type !== 'assistant' || !Array.isArray(content)) return [];
  return content.flatMap((item): Activity[] => {
    if (item.type === 'tool_use') return [{ text: describeTool(item), at: entry.timestamp }];
    if (item.type === 'text' && item.text?.trim()) return [{ text: `Replied: ${clip(item.text)}`, at: entry.timestamp }];
    return [];
  });
}

// Newest-last activity lines found in the file's tail; widens the tail once if it holds none.
export function recentActivity(file: string, count: number): Activity[] {
  const found = readTailEntries(file, TAIL_BYTES).flatMap(activitiesOf);
  const lines = found.length ? found : readTailEntries(file, MAX_TAIL_BYTES).flatMap(activitiesOf);
  return lines.slice(-count);
}

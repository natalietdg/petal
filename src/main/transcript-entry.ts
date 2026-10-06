// The parts of a Claude Code jsonl line Petal reads. The format is undocumented, so every field is optional.
export interface ToolInput {
  file_path?: string;
  notebook_path?: string;
  description?: string;
  command?: string;
}

export interface ContentItem {
  type: string;
  text?: string;
  name?: string;
  input?: ToolInput;
}

export type TextItem = ContentItem & { type: 'text'; text: string };

export interface TranscriptEntry {
  type?: string;
  uuid?: string;
  timestamp?: string;
  isMeta?: boolean;
  isSidechain?: boolean;
  cwd?: unknown;
  aiTitle?: string;
  message?: { role?: string; content?: string | ContentItem[] };
}

export const isTextItem = (item: ContentItem): item is TextItem => item.type === 'text';

// Parsed lines are trusted to match TranscriptEntry; every reader stays defensive about missing fields.
export const parseEntry = (line: string): TranscriptEntry => JSON.parse(line) as TranscriptEntry;

// The parts of a Claude Code jsonl line Petal reads. The format is undocumented, so every field is optional.
export interface ToolInput {
  file_path?: string;
  notebook_path?: string;
  description?: string;
  command?: string;
  questions?: unknown; // AskUserQuestion; validated in pending-question.ts
  pattern?: string;
  query?: string;
  url?: string;
  skill?: string;
  message?: string; // SubagentHandback: the agent's final report
}

export interface ContentItem {
  type: string;
  text?: string;
  name?: string;
  id?: string;
  tool_use_id?: string;
  input?: ToolInput;
  content?: unknown; // tool_result payload: a string or text blocks
  is_error?: boolean;
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
  origin?: { kind?: string; handback?: boolean }; // a subagent's hand-back arrives as a meta user entry with handback: true
  message?: { role?: string; content?: string | ContentItem[]; stop_reason?: string | null };
  attachment?: { type?: string; commandMode?: string; prompt?: string | ContentItem[]; origin?: { kind?: string } }; // queued_command: her message sent while Claude works
}

export const isTextItem = (item: ContentItem): item is TextItem => item.type === 'text';

// Parsed lines are trusted to match TranscriptEntry; every reader stays defensive about missing fields.
export const parseEntry = (line: string): TranscriptEntry => JSON.parse(line) as TranscriptEntry;

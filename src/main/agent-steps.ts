// A subagent's jsonl in plain words: one line per step, timeline items, and running/finished/stalled.
import path from 'node:path';
import { contentItems, promptText, trimTo } from './prompts';
import type { ContentItem, TranscriptEntry } from './transcript-entry';

export const STALLED_AFTER_MS = 10 * 60 * 1000; // no write for this long while unfinished
const TARGET_MAX = 60;
const SHORT_COMMAND = 40; // a Bash command this short reads better than its description
const PREVIEW_MAX = 300;
const HANDBACK = 'SubagentHandback';
export const NO_STEP = 'Starting';

export type AgentStatus = 'running' | 'finished' | 'stalled';

export type TimelineItem =
  | { kind: 'prompt'; text: string }
  | { kind: 'step'; id: string; tool: string; summary: string; at?: string }
  | { kind: 'result'; toolUseId: string; ok: boolean; preview: string }
  | { kind: 'text'; markdown: string; at?: string }
  | { kind: 'report'; markdown: string; at?: string };

const clip = (text: unknown): string => trimTo(String(text ?? ''), TARGET_MAX);
const base = (file: unknown): string => path.basename(String(file ?? ''));
// mcp__server__tool reads as just "tool".
const toolLabel = (name = ''): string => name.split('__').at(-1) || name;

function hostOf(url: unknown): string {
  try {
    return new URL(String(url)).host;
  } catch {
    return clip(url);
  }
}

function bashStep(command = '', description = ''): string {
  const oneLine = !command.includes('\n') && command.length <= SHORT_COMMAND;
  if (command && (oneLine || !description)) return `Running ${clip(command)}`;
  return clip(description) || 'Running a command';
}

// "Reading sessions-monitor.ts", "Running npm test", "Editing print.css".
export function stepSummary({ name = '', input = {} }: ContentItem): string {
  switch (name) {
    case 'Read': return `Reading ${base(input.file_path)}`;
    case 'Edit': case 'MultiEdit': case 'NotebookEdit': return `Editing ${base(input.file_path ?? input.notebook_path)}`;
    case 'Write': return `Writing ${base(input.file_path)}`;
    case 'Bash': return bashStep(input.command, input.description);
    case 'Grep': return `Searching for “${clip(input.pattern)}”`;
    case 'Glob': return `Finding ${clip(input.pattern)}`;
    case 'WebFetch': return `Fetching ${hostOf(input.url)}`;
    case 'WebSearch': return `Searching the web for “${clip(input.query)}”`;
    case 'Agent': case 'Task': return `Starting an agent: ${clip(input.description)}`;
    case 'Skill': return `Using the ${clip(input.skill)} skill`;
    case 'ToolSearch': return 'Loading tools';
    case 'TodoWrite': return 'Updating the to-do list';
    case HANDBACK: return 'Sending the final report';
    default: return `Using ${toolLabel(name)}`;
  }
}

// A tool result as short plain text; never the whole payload.
export function resultPreview(content: unknown): string {
  const text = typeof content === 'string' ? content
    : Array.isArray(content) ? content.map((part: { type?: string; text?: string }) => (part?.type === 'text' ? part.text ?? '' : `[${part?.type ?? 'item'}]`)).join('\n')
      : '';
  const trimmed = text.trim();
  return trimmed.length > PREVIEW_MAX ? `${trimmed.slice(0, PREVIEW_MAX)}…` : trimmed;
}

const toolUses = (entry: TranscriptEntry): ContentItem[] => contentItems(entry).filter((item) => item.type === 'tool_use');
const isToolResultTurn = (entry: TranscriptEntry): boolean => contentItems(entry).some((item) => item.type === 'tool_result');

// The agent is done: it handed its report back, or ended its turn without asking for a tool.
export function finishesAgent(entry: TranscriptEntry): boolean {
  if (entry.type !== 'assistant') return false;
  const uses = toolUses(entry);
  return uses.some((item) => item.name === HANDBACK) || (entry.message?.stop_reason === 'end_turn' && uses.length === 0);
}

// The last assistant turn decides, unless a new prompt came after it; other lines leave it as it was.
export function finishedAfter(finished: boolean, entry: TranscriptEntry): boolean {
  if (!contentItems(entry).length || entry.isMeta) return finished;
  if (entry.type === 'assistant') return finishesAgent(entry);
  if (entry.type === 'user' && !isToolResultTurn(entry)) return false;
  return finished;
}

export const isFinished = (entries: readonly TranscriptEntry[]): boolean => entries.reduce(finishedAfter, false);

export function latestStep(entries: readonly TranscriptEntry[]): string | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const use = toolUses(entries[i] ?? {}).at(-1);
    if (use) return stepSummary(use);
  }
  return null;
}

export const agentStatus = (finished: boolean, updatedAt: number, now: number): AgentStatus =>
  finished ? 'finished' : now - updatedAt > STALLED_AFTER_MS ? 'stalled' : 'running';

function assistantItems(entry: TranscriptEntry): TimelineItem[] {
  const at = entry.timestamp;
  const endsTurn = finishesAgent(entry);
  return contentItems(entry).flatMap((item): TimelineItem[] => {
    if (item.type === 'tool_use' && item.name === HANDBACK) return [{ kind: 'report', markdown: String(item.input?.message ?? ''), at }];
    if (item.type === 'tool_use') return [{ kind: 'step', id: item.id ?? '', tool: toolLabel(item.name), summary: stepSummary(item), at }];
    if (item.type === 'text' && item.text?.trim()) return [{ kind: endsTurn ? 'report' : 'text', markdown: item.text, at }];
    return [];
  });
}

// Timeline rows for one jsonl line; thinking, attachments and meta lines show nothing.
export function timelineItems(entry: TranscriptEntry): TimelineItem[] {
  if (entry.isMeta) return [];
  if (entry.type === 'assistant') return assistantItems(entry);
  if (entry.type !== 'user') return [];
  if (isToolResultTurn(entry)) {
    return contentItems(entry).filter((item) => item.type === 'tool_result')
      .map((item): TimelineItem => ({ kind: 'result', toolUseId: item.tool_use_id ?? '', ok: !item.is_error, preview: resultPreview(item.content) }));
  }
  const text = promptText({ ...entry, isSidechain: false }); // every subagent turn is sidechain
  return text ? [{ kind: 'prompt', text }] : [];
}

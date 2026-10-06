// A past session's conversation, a page at a time from the end: her prompts and Claude's replies, no tool noise.
import fs from 'node:fs';
import { readTurns, type Turn } from './handoff';

export const TURNS_PER_PAGE = 30;

export interface TurnPage {
  turns: { index: number; prompt: string; reply: string }[];
  start: number;
  total: number;
}

// The page ending just before `before` (default: the newest turn), at most `perPage` long.
export function pageOfTurns(turns: readonly Turn[], before: number | undefined, perPage = TURNS_PER_PAGE): TurnPage {
  const end = Math.min(before ?? turns.length, turns.length);
  const start = Math.max(0, end - perPage);
  return {
    turns: turns.slice(start, end).map((turn, i) => ({ index: start + i, prompt: turn.prompt, reply: turn.reply.join('\n\n') })),
    start,
    total: turns.length,
  };
}

// Cached by mtime, so "Show earlier" doesn't re-read the transcript.
const turnCache = new Map<string, { mtimeMs: number; turns: Turn[] }>();
export async function turnsFor(file: string): Promise<Turn[]> {
  const { mtimeMs } = fs.statSync(file);
  const cached = turnCache.get(file);
  if (cached?.mtimeMs === mtimeMs) return cached.turns;
  const turns = await readTurns(file);
  turnCache.set(file, { mtimeMs, turns });
  return turns;
}

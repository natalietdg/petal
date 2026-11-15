// Per-session spend from transcripts, read incrementally: each tick reads only the bytes added since the last one.
// Main log plus its subagents' logs; a message id counts once (Claude Code repeats usage on every block of a message).
import fs from 'node:fs';
import path from 'node:path';
import { splitCompleteLines } from './transcript';
import { addUsage, NO_TOKENS, usageOf, type TokenUsage } from '../shared/token-usage';
import { contextWindowFor, newTokens, type SessionSpend } from '../shared/session-spend';

interface FileCount {
  offset: number;
  carry: Buffer; // a line (or character) still being written
  byId: Map<string, TokenUsage>;
  loose: TokenUsage;
  context: number; // latest main-chain assistant turn
  maxContext: number;
  model: string | null;
}

const READ_CHUNK = 4 * 1024 * 1024; // per file per tick, so a first look at a long log never stalls the main thread
const counts = new Map<string, FileCount>();
const fresh = (): FileCount => ({ offset: 0, carry: Buffer.alloc(0), byId: new Map(), loose: NO_TOKENS, context: 0, maxContext: 0, model: null });

function addLine(count: FileCount, line: string): void {
  let entry: { type?: string; isSidechain?: boolean; message?: { model?: unknown; usage?: Record<string, unknown> } };
  try { entry = JSON.parse(line); } catch { return; }
  const found = usageOf(entry);
  if (!found) return;
  if (found.id) count.byId.set(found.id, found.usage); else count.loose = addUsage(count.loose, found.usage);
  if (entry.type !== 'assistant' || entry.isSidechain) return;
  const u = found.usage;
  count.context = u.input + u.cacheRead + u.cacheWrite;
  count.maxContext = Math.max(count.maxContext, count.context);
  if (typeof entry.message?.model === 'string' && !entry.message.model.startsWith('<')) count.model = entry.message.model;
}

// Reads what was appended since last time; a shorter file was rewritten, so it starts over.
function update(file: string, full = false): FileCount | null {
  const stat = fs.statSync(file, { throwIfNoEntry: false });
  if (!stat) { counts.delete(file); return null; }
  let count = counts.get(file);
  if (!count || stat.size < count.offset) count = fresh();
  while (stat.size > count.offset) {
    const fd = fs.openSync(file, 'r');
    try {
      const buffer = Buffer.alloc(Math.min(stat.size - count.offset, READ_CHUNK));
      fs.readSync(fd, buffer, 0, buffer.length, count.offset);
      const { lines, rest } = splitCompleteLines(count.carry, buffer); // splits on bytes, so a chunk ending mid-character is safe
      count.carry = rest;
      for (const line of lines) if (line) addLine(count, line);
      count.offset += buffer.length;
    } finally {
      fs.closeSync(fd);
    }
    if (!full) break; // the next tick reads on
  }
  counts.set(file, count);
  return count;
}

const totalOf = (count: FileCount): TokenUsage => [...count.byId.values()].reduce(addUsage, count.loose);

function subagentLogs(transcript: string): string[] {
  const dir = path.join(transcript.replace(/\.jsonl$/, ''), 'subagents');
  try {
    return fs.readdirSync(dir).filter((name) => name.endsWith('.jsonl')).map((name) => path.join(dir, name));
  } catch {
    return [];
  }
}

// null when the log isn't there (yet). full: read to the end now (a conclusion's line), not a chunk per tick.
export function sessionSpend(transcript: string, { full = false } = {}): SessionSpend | null {
  try {
    const main = update(transcript, full);
    if (!main) return null;
    const usage = subagentLogs(transcript).map((file) => update(file, full)).filter((c): c is FileCount => c !== null).map(totalOf).reduce(addUsage, totalOf(main));
    return { newTokens: newTokens(usage), cacheRead: usage.cacheRead, contextTokens: main.context, contextWindow: contextWindowFor(main.model, main.maxContext) };
  } catch {
    return null; // a log vanishing mid-read: no figure this tick
  }
}

export const resetForTests = (): void => counts.clear();

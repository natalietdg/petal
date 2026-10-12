// Finds a session's latest conclusion in its log: Claude's text answering her newest "conclude" prompt.
// The state is plain data, so a scan can stop at any line and resume later from a stored byte offset.
import fs from 'node:fs';
import { commandText, isHandback, isUserTurn, promptText, queuedPromptText } from './prompts';
import { assistantText } from './replies';
import { parseEntry, type TranscriptEntry } from './transcript-entry';
import { splitCompleteLines } from './transcript';
import { isConcludePrompt, parseConclusion, type Conclusion } from '../shared/conclusion';

const MAX_REPLY_CHARS = 16 * 1024; // a conclusion is a few lines; the rest of a long reply is never shown
const CHUNK_BYTES = 1024 * 1024;
const MAY_CONCLUDE = /conclude/i; // lines without the word can't start a conclusion, so they skip JSON.parse

export interface ScanState {
  offset: number; // bytes read so far, always at a line boundary
  pending: { promptAt: string | null; at: string | null; text: string } | null; // a conclude prompt and Claude's answer so far
  conclusion: Conclusion | null; // the last finished one
}

export const emptyScan = (): ScanState => ({ offset: 0, pending: null, conclusion: null });

const promptOf = (entry: TranscriptEntry): string => queuedPromptText(entry) || promptText(entry) || commandText(entry);

function finish(state: ScanState): void {
  const { pending } = state;
  if (pending?.text) state.conclusion = parseConclusion(pending.text, pending.at ?? pending.promptAt) ?? state.conclusion;
  state.pending = null;
}

export function addEntry(state: ScanState, entry: TranscriptEntry): void {
  const prompt = promptOf(entry);
  if (prompt) {
    finish(state);
    if (isConcludePrompt(prompt)) state.pending = { promptAt: entry.timestamp ?? null, at: null, text: '' };
    return;
  }
  // A wrapper or hand-back before Claude has answered keeps the conclude waiting; after, it ends the answer.
  if (isUserTurn(entry) || isHandback(entry)) {
    if (state.pending?.text) finish(state);
    return;
  }
  const text = state.pending ? assistantText(entry) : '';
  if (!text || !state.pending) return;
  state.pending.at ??= entry.timestamp ?? null;
  if (state.pending.text.length < MAX_REPLY_CHARS) state.pending.text = state.pending.text ? `${state.pending.text}\n\n${text}` : text;
}

export function addLine(state: ScanState, line: string): void {
  if (!line || (!state.pending && !MAY_CONCLUDE.test(line))) return;
  try {
    addEntry(state, parseEntry(line));
  } catch {
    // Skip malformed lines.
  }
}

// The answer still being written counts too, so the banner shows as soon as Claude replies.
export const currentConclusion = (state: ScanState): Conclusion | null =>
  (state.pending?.text ? parseConclusion(state.pending.text, state.pending.at ?? state.pending.promptAt) : null) ?? state.conclusion;

// Reads from state.offset to the end of the file, a chunk at a time; a trailing half line waits for the next scan.
export async function scanFile(file: string, state: ScanState): Promise<ScanState> {
  const next: ScanState = structuredClone(state);
  const handle = await fs.promises.open(file, 'r');
  try {
    const buffer = Buffer.alloc(CHUNK_BYTES);
    let carry: Buffer = Buffer.alloc(0);
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, CHUNK_BYTES, next.offset + carry.length);
      if (!bytesRead) break;
      const { lines, rest } = splitCompleteLines(carry, buffer.subarray(0, bytesRead));
      next.offset += carry.length + bytesRead - rest.length;
      carry = rest;
      for (const line of lines) addLine(next, line);
    }
  } finally {
    await handle.close();
  }
  return next;
}

// Builds the Library: after a session concludes, its claude exits or its tab closes, one headless Claude run reads
// the part of its log not read before and returns new domain knowledge, which library-store.ts merges into notes.
// Off unless she turns it on (config library.autoBuild); behind the Claude folder gate; one run at a time; never blocks the UI.
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import * as configStore from './config-store';
import { allowedClaudeHome } from './claude-folder';
import { claudePath, runClaude } from './claude-cli';
import { readJsonOrSetAside, writeJsonAtomic } from './atomic-file';
import { commandText, promptText } from './prompts';
import { assistantText } from './replies';
import { parseEntry } from './transcript-entry';
import { canonicalCategory, cleanFact, listEntries, mergeTopics, squash, STARTER_CATEGORIES, type TopicInput } from './library-store';
import { counters, isSnapshotRun, libraryFixture } from './snapshot-mode';
import type { LibraryRunResult } from '../shared/library';

export const CHUNK_BYTES = 1024 * 1024; // of raw log per Claude call; tool output makes logs bulky
export const DIGEST_CHARS = 30_000; // of prompts and replies sent per call
const MESSAGE_CHARS = 3000;
export const MAX_CHUNKS_PER_RUN = 3;
export const MAX_REPLY_CHARS = 64 * 1024;
const MAX_TOPICS = 8;
const MAX_FACTS = 12;
const MAX_OFFSETS = 500;

export interface SessionTarget {
  sessionId: string;
  transcript: string; // the session's jsonl
}

type Offsets = Record<string, { offset: number; at: string }>;
const offsetsFile = () => path.join(app.getPath('userData'), 'library-offsets.json');

export function loadOffsets(): Offsets {
  const data = readJsonOrSetAside(offsetsFile());
  return data && typeof data === 'object' && !Array.isArray(data) ? (data as Offsets) : {};
}

// Newest MAX_OFFSETS kept, so the file never grows without end.
export function saveOffset(sessionId: string, offset: number, now = new Date()): void {
  const all = { ...loadOffsets(), [sessionId]: { offset, at: now.toISOString() } };
  const kept = Object.entries(all).sort((a, b) => b[1].at.localeCompare(a[1].at)).slice(0, MAX_OFFSETS);
  writeJsonAtomic(offsetsFile(), Object.fromEntries(kept));
}

export interface Chunk {
  digest: string; // "User: …" and "Claude: …" lines
  next: number; // byte offset to start from next time
  atEnd: boolean;
}

// The log from `offset`: at most CHUNK_BYTES, whole lines only, and stops early once the digest is full.
// A log shorter than the offset was replaced, so it is read from the start.
export function readChunk(file: string, offset: number, { chunkBytes = CHUNK_BYTES, digestChars = DIGEST_CHARS } = {}): Chunk {
  const size = fs.statSync(file).size;
  const start = offset > size ? 0 : offset;
  const buffer = Buffer.alloc(Math.min(chunkBytes, size - start));
  const fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, buffer, 0, buffer.length, start); } finally { fs.closeSync(fd); }
  const lastNewline = buffer.lastIndexOf(0x0a);
  // No newline in a full buffer: one huge line (a pasted file); skip past it rather than stall.
  const usable = lastNewline === -1 ? (buffer.length === chunkBytes ? buffer.length : 0) : lastNewline + 1;
  const parts: string[] = [];
  let used = 0;
  let at = 0;
  while (at < usable) {
    const end = buffer.indexOf(0x0a, at);
    const lineEnd = end === -1 || end >= usable ? usable : end + 1;
    const line = buffer.subarray(at, lineEnd).toString('utf8').trim();
    const text = lineText(line);
    if (text && used + text.length > digestChars && parts.length) break; // the rest waits for the next chunk
    if (text) { parts.push(text); used += text.length + 1; }
    at = lineEnd;
  }
  return { digest: parts.join('\n'), next: start + at, atEnd: start + at >= size };
}

function lineText(line: string): string {
  if (!line) return '';
  try {
    const entry = parseEntry(line);
    if (entry.isSidechain) return ''; // subagents' own talk
    const prompt = promptText(entry) || commandText(entry);
    if (prompt) return `User: ${squash(prompt, MESSAGE_CHARS)}`;
    const reply = entry.type === 'assistant' ? assistantText(entry) : '';
    return reply ? `Claude: ${squash(reply, MESSAGE_CHARS)}` : '';
  } catch {
    return '';
  }
}

export function promptFor(digest: string, categories: readonly string[]): string {
  const offered = [...new Set([...categories, ...STARTER_CATEGORIES])].join(', ');
  return `You keep a library of DOMAIN KNOWLEDGE learned from work sessions with Claude Code.
Domain knowledge is a durable fact about the subject matter: how a system, business process, API, data model or field works;
what a term means; a rule or constraint of the domain. It is NOT task status, progress, plans, the user's preferences or
working style, or a description of code changes made in this session.

From the session below, list only genuinely new, durable domain facts that were stated or confirmed. Group them by topic
(a short noun phrase, e.g. "Payout cutoff times"). Pick each topic's category, its function or area, from this list,
and invent a new short one only when none fits: ${offered}.
Each fact is one self-contained sentence, readable without the session. Evidence is a short pointer to where it came from.
If there is nothing, answer {"topics": []}.

Answer with JSON only, no prose:
{"topics": [{"topic": "<topic>", "category": "<category>", "facts": ["<fact>"], "evidence": "<evidence>"}]}

Session:
${digest}`;
}

const textOf = (value: unknown): string => (typeof value === 'string' ? value : '');

// The CLI's JSON envelope, then the {...} or [...] inside its result, wrapped in prose or a fence or not.
export function parseTopics(stdout: string): TopicInput[] {
  if (stdout.length > MAX_REPLY_CHARS) throw new Error('Reply too large');
  let text = stdout;
  try {
    const envelope = JSON.parse(stdout) as { result?: unknown; is_error?: unknown; topics?: unknown };
    if (envelope?.is_error === true) throw new Error(`Claude error: ${squash(envelope.result, 200)}`);
    if (typeof envelope?.result === 'string') text = envelope.result;
  } catch (error) {
    if ((error as Error).message.startsWith('Claude error')) throw error;
  }
  const open = text.search(/[[{]/);
  const close = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (open === -1 || close < open) throw new Error('No JSON in reply');
  const json = JSON.parse(text.slice(open, close + 1)) as unknown;
  const list = Array.isArray(json) ? json : (json as { topics?: unknown })?.topics;
  if (!Array.isArray(list)) throw new Error('No topics list in reply');
  return list.flatMap((raw): TopicInput[] => {
    if (!raw || typeof raw !== 'object') return [];
    const item = raw as Record<string, unknown>;
    const topic = squash(item.topic ?? item.title, 80);
    const rawFacts = Array.isArray(item.facts) ? item.facts : textOf(item.facts).split(/\r?\n/);
    const facts = rawFacts.map((f) => cleanFact(textOf(f))).filter(Boolean).slice(0, MAX_FACTS);
    if (!topic || !facts.length) return [];
    return [{ topic, category: squash(item.category, 32), facts, evidence: squash(item.evidence, 300) }];
  }).slice(0, MAX_TOPICS);
}

// ---- The queue: one run at a time, each session queued once until its run starts.

type Extractor = (prompt: string) => Promise<string>;
let chain: Promise<unknown> = Promise.resolve();
const queued = new Map<string, Promise<LibraryRunResult>>();
let active = 0;
const changeListeners = new Set<() => void>();

export const isRunning = (): boolean => active > 0 || queued.size > 0;
export function onChange(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => { changeListeners.delete(listener); };
}

// In a snapshot run only the harness's stub answers; a real claude never runs there.
async function extractor(): Promise<Extractor | null> {
  if (isSnapshotRun()) return libraryFixture.extract;
  if (!(await claudePath())) return null;
  const { model } = configStore.load().organizer;
  return (prompt) => runClaude(prompt, { model });
}

// Only a log under her Claude folder, outside snapshot runs; nothing else is ever read here.
function readableLog(transcript: string): boolean {
  if (isSnapshotRun()) return true; // the harness's fixture logs live in its scratch folder
  const home = allowedClaudeHome();
  return Boolean(home) && path.resolve(transcript).startsWith(path.resolve(home as string) + path.sep);
}

async function runSession(target: SessionTarget, force: boolean): Promise<LibraryRunResult> {
  const result: LibraryRunResult = { added: 0, updated: 0 };
  if (!allowedClaudeHome()) return { ...result, skipped: 'Petal isn’t reading your Claude folder' };
  if (!force && !configStore.load().library.autoBuild) return { ...result, skipped: 'Build my Library is off' };
  if (!readableLog(target.transcript)) return { ...result, skipped: 'not a Claude session log' };
  const run = await extractor();
  if (!run) {
    if (isSnapshotRun()) counters.libraryRunsSkipped += 1;
    return { ...result, skipped: isSnapshotRun() ? 'snapshot run' : 'Claude Code isn’t installed' };
  }
  let offset = loadOffsets()[target.sessionId]?.offset ?? 0;
  for (let i = 0; i < MAX_CHUNKS_PER_RUN; i += 1) {
    const chunk = readChunk(target.transcript, offset);
    if (chunk.next === offset && !chunk.digest) break; // nothing new
    if (chunk.digest) {
      const categories = listEntries().map((e) => e.category);
      const topics = parseTopics(await run(promptFor(chunk.digest, categories)))
        .map((t) => ({ ...t, category: canonicalCategory(t.category, categories) }));
      const merged = mergeTopics(topics, { sessionId: target.sessionId, date: new Date().toISOString().slice(0, 10) });
      result.added += merged.added;
      result.updated += merged.updated;
    }
    offset = chunk.next;
    saveOffset(target.sessionId, offset); // after the merge, so a failed call is retried next time
    if (chunk.atEnd) break;
  }
  return result;
}

// Queues a session; a second call while it waits shares the first. force: the Library's "Add from this session".
export function queueSession(target: SessionTarget, { force = false }: { force?: boolean } = {}): Promise<LibraryRunResult> {
  const waiting = queued.get(target.sessionId);
  if (waiting) return waiting;
  const job = chain.then(async () => {
    queued.delete(target.sessionId);
    active += 1;
    try {
      const result = await runSession(target, force);
      if (result.added || result.updated) for (const listener of changeListeners) listener();
      return result;
    } catch (error) {
      console.error(`[petal] library skipped ${target.sessionId}:`, String((error as Error).message ?? error).split('\n')[0]);
      return { added: 0, updated: 0, skipped: `couldn’t read Claude’s answer (${String((error as Error).message ?? error).split('\n')[0]})` };
    } finally {
      active -= 1;
    }
  });
  queued.set(target.sessionId, job);
  chain = job;
  return job;
}

// For the triggers: fire and forget, never throws.
export function harvest(session: { sessionId?: string | null; transcript?: string | null } | null | undefined): void {
  if (!session?.sessionId || !session.transcript) return;
  void queueSession({ sessionId: session.sessionId, transcript: session.transcript });
}

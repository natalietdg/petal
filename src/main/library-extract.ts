// Builds the Library: after a session concludes, its claude exits or its tab closes, one headless Claude run reads
// the part of its log not read before and returns new domain knowledge, which library-store.ts merges into notes.
// The same run also returns lessons (how to work) when Learn lessons is on: one call for both, lessons-store.ts keeps them.
// Off unless she turns one on (library.autoBuild, lessons.learn); behind the Claude folder gate; one run at a time; never blocks the UI.
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import * as configStore from './config-store';
import { backgroundModel } from './config-store';
import { allowedClaudeHome } from './claude-folder';
import { claudePath, runClaude } from './claude-cli';
import { MAX_REPLY_CHARS, replyJson } from './claude-reply';
import { LESSON_SHAPE, LESSONS_INSTRUCTIONS, lessonsFrom, lessonsPromptFor, parseLessons } from './lessons-extract';
import { addLessons } from './lessons-store';
import type { LessonInput } from '../shared/lessons';
import { readJsonOrSetAside, writeJsonAtomic } from './atomic-file';
import { commandText, promptText } from './prompts';
import { assistantText } from './replies';
import { parseEntry } from './transcript-entry';
import { canonicalCategory, cleanFact, knownTopics, listEntries, mergeTopics, squash, STARTER_CATEGORIES, type TopicInput } from './library-store';
import { counters, isSnapshotRun, libraryFixture } from './snapshot-mode';
import * as librarySessions from './library-sessions';
import type { LibraryRunResult } from '../shared/library';
import { NO_USAGE, addUsage, usageOfReply, type TokenUsage } from '../shared/library-cost';
import type { NoteRef } from '../shared/session-info';
import { recordActivity } from './activity-feed';
import { sessionTitleFor } from './session-title';
import { recordRun } from './library-cost-store';

export const CHUNK_BYTES = 1024 * 1024; // of raw log per Claude call; tool output makes logs bulky
export const DIGEST_CHARS = 30_000; // of prompts and replies sent per call
const MESSAGE_CHARS = 3000;
export const MAX_CHUNKS_PER_RUN = 3;
export { MAX_REPLY_CHARS };
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
  cwd: string | null; // the session's folder, from its first line that names one
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
  let cwd: string | null = null;
  while (at < usable) {
    const end = buffer.indexOf(0x0a, at);
    const lineEnd = end === -1 || end >= usable ? usable : end + 1;
    const { text, cwd: lineCwd } = lineText(buffer.subarray(at, lineEnd).toString('utf8').trim());
    if (text && used + text.length > digestChars && parts.length) break; // the rest waits for the next chunk
    if (text) { parts.push(text); used += text.length + 1; }
    cwd ??= lineCwd;
    at = lineEnd;
  }
  return { digest: parts.join('\n'), next: start + at, atEnd: start + at >= size, cwd };
}

// The chunks one run reads from `offset`, in order: the build and its token estimate both walk exactly these.
export function* runChunks(file: string, offset: number): Generator<Chunk> {
  let at = offset;
  for (let i = 0; i < MAX_CHUNKS_PER_RUN; i += 1) {
    const chunk = readChunk(file, at);
    if (chunk.next === at && !chunk.digest) return; // nothing new
    yield chunk;
    at = chunk.next;
    if (chunk.atEnd) return;
  }
}

function lineText(line: string): { text: string; cwd: string | null } {
  if (!line) return { text: '', cwd: null };
  try {
    const entry = parseEntry(line);
    const cwd = typeof entry.cwd === 'string' && path.isAbsolute(entry.cwd) ? entry.cwd : null;
    if (entry.isSidechain) return { text: '', cwd: null }; // subagents' own talk
    const prompt = promptText(entry) || commandText(entry);
    if (prompt) return { text: `User: ${squash(prompt, MESSAGE_CHARS)}`, cwd };
    const reply = entry.type === 'assistant' ? assistantText(entry) : '';
    return { text: reply ? `Claude: ${squash(reply, MESSAGE_CHARS)}` : '', cwd };
  } catch {
    return { text: '', cwd: null };
  }
}

const TOPIC_SHAPE = '{"topic": "<topic>", "category": "<category>", "facts": ["<fact>"], "evidence": "<evidence>"}';

export function promptFor(digest: string, categories: readonly string[], known = ''): string {
  return `${libraryInstructions(categories, known)}
Answer with JSON only, no prose:
{"topics": [${TOPIC_SHAPE}]}

Session:
${digest}`;
}

// One call for both: the Library's instructions, then the lessons', and one answer holding both lists.
export function combinedPromptFor(digest: string, categories: readonly string[], known = ''): string {
  return `${libraryInstructions(categories, known)}
${LESSONS_INSTRUCTIONS}

Answer with JSON only, no prose, with both lists (either may be empty):
{"topics": [${TOPIC_SHAPE}], "lessons": [${LESSON_SHAPE}]}

Session:
${digest}`;
}

function libraryInstructions(categories: readonly string[], known: string): string {
  const offered = [...new Set([...categories, ...STARTER_CATEGORIES])].join(', ');
  const existing = known
    ? `\nThe library already has these notes, as title (category): first fact. When a topic is one of them, use that exact title,
even when the session words it differently or abbreviates it (SI and Settlement Instruction are the same topic):
${known}
`
    : '';
  return `You keep a library of DOMAIN KNOWLEDGE learned from work sessions with Claude Code.
Domain knowledge is a durable fact about the subject matter: how a system, business process, API, data model or field works;
what a term means; a rule or constraint of the domain. It is NOT task status, progress, plans, the user's preferences or
working style, or a description of code changes made in this session.

From the session below, list only genuinely new, durable domain facts that were stated or confirmed. Group them by topic
(a short noun phrase, e.g. "Payout cutoff times"). Pick each topic's category, its function or area, from this list,
and invent a new short one only when none fits: ${offered}.
Each fact is one self-contained sentence, readable without the session. Evidence is a short pointer to where it came from.
If there is nothing, answer {"topics": []}.
${existing}`;
}

const textOf = (value: unknown): string => (typeof value === 'string' ? value : '');

// A Library-only answer: {"topics": [...]} or a bare array.
export function parseTopics(stdout: string): TopicInput[] {
  const json = replyJson(stdout);
  const list = Array.isArray(json) ? json : (json as { topics?: unknown })?.topics;
  if (!Array.isArray(list)) throw new Error('No topics list in reply');
  return topicsFrom(list);
}

// A combined answer: both lists; one missing reads as empty, both missing is a broken answer.
export function parseCombined(stdout: string): { topics: TopicInput[]; lessons: LessonInput[] } {
  const json = replyJson(stdout) as { topics?: unknown; lessons?: unknown } | null;
  const topics = json && typeof json === 'object' && !Array.isArray(json) ? json.topics : undefined;
  const lessons = json && typeof json === 'object' && !Array.isArray(json) ? json.lessons : undefined;
  if (!Array.isArray(topics) && !Array.isArray(lessons)) throw new Error('No topics or lessons list in reply');
  return { topics: Array.isArray(topics) ? topicsFrom(topics) : [], lessons: lessonsFrom(lessons) };
}

function topicsFrom(list: unknown[]): TopicInput[] {
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
const reading = new Set<string>(); // sessions queued or being read now
const changeListeners = new Set<() => void>();
const sessionListeners = new Set<(sessionId: string) => void>();
const lessonListeners = new Set<() => void>();

export const isRunning = (): boolean => active > 0 || queued.size > 0;
export const isReadingSession = (sessionId: string): boolean => reading.has(sessionId);
export function onChange(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => { changeListeners.delete(listener); };
}
// A run kept new lessons, so an open Lessons view relists.
export function onLessons(listener: () => void): () => void {
  lessonListeners.add(listener);
  return () => { lessonListeners.delete(listener); };
}
// A session started or finished being read, so its conclusion's This session line can redraw.
export function onSessionChange(listener: (sessionId: string) => void): () => void {
  sessionListeners.add(listener);
  return () => { sessionListeners.delete(listener); };
}
const sessionChanged = (sessionId: string): void => { for (const listener of sessionListeners) listener(sessionId); };

// In a snapshot run only the harness's stub answers; a real claude never runs there.
// Runs on the Model for background work (Customize › Organizer), read per run so a change applies to the next one.
async function extractor(): Promise<Extractor | null> {
  if (isSnapshotRun()) return libraryFixture.extract;
  if (!(await claudePath())) return null;
  return (prompt) => runClaude(prompt, { model: backgroundModel(configStore.load()) });
}

// What one run asks for: the Library when it is on or she clicked, lessons when Learn lessons is on.
export function runWants(force: boolean, config = configStore.load()): { library: boolean; lessons: boolean } {
  return { library: force || config.library.autoBuild, lessons: config.lessons.learn };
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
  const wants = runWants(force);
  if (!wants.library && !wants.lessons) return { ...result, skipped: 'Build my Library is off' };
  if (!readableLog(target.transcript)) return { ...result, skipped: 'not a Claude session log' };
  const run = await extractor();
  if (!run) {
    if (isSnapshotRun()) counters.libraryRunsSkipped += 1;
    return { ...result, skipped: isSnapshotRun() ? 'snapshot run' : 'Claude Code isn’t installed' };
  }
  const offset = loadOffsets()[target.sessionId]?.offset ?? 0;
  let cwd: string | null = null; // a later chunk may not repeat the folder
  const notes = { added: [] as NoteRef[], updated: [] as NoteRef[] };
  for (const chunk of runChunks(target.transcript, offset)) {
    if (chunk.digest) {
      const categories = wants.library ? listEntries().map((e) => e.category) : [];
      const answer = await askFor(run, wants, chunk.digest, categories);
      if (answer.usage) result.usage = addUsage(result.usage ?? NO_USAGE, answer.usage);
      if (wants.library) {
        const topics = answer.topics.map((t) => ({ ...t, category: canonicalCategory(t.category, categories) }));
        const merged = mergeTopics(topics, { sessionId: target.sessionId, date: new Date().toISOString().slice(0, 10) });
        result.added += merged.added;
        result.updated += merged.updated;
        for (const { slug, title, added } of merged.notes) (added ? notes.added : notes.updated).push({ slug, title });
      }
      if (answer.lessons.length) result.lessons = (result.lessons ?? 0) + addLessons(answer.lessons, { sessionId: target.sessionId, cwd: chunk.cwd ?? cwd }).length;
    }
    cwd ??= chunk.cwd;
    saveOffset(target.sessionId, chunk.next); // after the merge, so a failed call is retried next time
  }
  if (wants.library) librarySessions.record(target.sessionId, notes); // a lessons-only run says nothing about the Library
  return result;
}

type Wants = { library: boolean; lessons: boolean };

// The prompt one call sends, shaped by what the run wants; the estimate measures it with an empty digest.
export function promptOf(wants: Wants, digest: string, categories: readonly string[]): string {
  if (wants.library && wants.lessons) return combinedPromptFor(digest, categories, knownTopics());
  if (wants.lessons) return lessonsPromptFor(digest);
  return promptFor(digest, categories, knownTopics());
}

// One call per chunk; the reply's usage counts toward the run's tokens.
async function askFor(run: Extractor, wants: Wants, digest: string, categories: readonly string[]): Promise<{ topics: TopicInput[]; lessons: LessonInput[]; usage: TokenUsage | null }> {
  const stdout = await run(promptOf(wants, digest, categories));
  const usage = usageOfReply(stdout); // null when the reply carries none
  if (wants.library && wants.lessons) return { ...parseCombined(stdout), usage };
  if (wants.lessons) return { topics: [], lessons: parseLessons(stdout), usage };
  return { topics: parseTopics(stdout), lessons: [], usage };
}

const notes = (n: number): string => `${n} note${n === 1 ? '' : 's'}`;

// The activity feed's line for a run that added or updated notes.
function recordLibraryRun(sessionId: string, { added, updated }: LibraryRunResult): void {
  const parts = [added ? `${notes(added)} added` : '', updated ? `${updated} updated` : ''].filter(Boolean).join(', ');
  const name = sessionTitleFor(sessionId);
  recordActivity({ kind: 'library', sessionId, sessionName: name, branch: null, repo: null, text: `Library: ${parts} from ${name}` });
}

// Queues a session; a second call while it waits shares the first. force: an explicit click (Add to Library, Read past sessions).
export function queueSession(target: SessionTarget, { force = false }: { force?: boolean } = {}): Promise<LibraryRunResult> {
  const waiting = queued.get(target.sessionId);
  if (waiting) return waiting;
  const willRead = force || configStore.load().library.autoBuild; // a run that skips at once never shows as reading
  if (willRead) {
    reading.add(target.sessionId);
    sessionChanged(target.sessionId);
  }
  const job = chain.then(async () => {
    queued.delete(target.sessionId);
    active += 1;
    try {
      const result = await runSession(target, force);
      if (result.added || result.updated) {
        for (const listener of changeListeners) listener();
        recordLibraryRun(target.sessionId, result);
      }
      if (result.lessons) for (const listener of lessonListeners) listener();
      return result;
    } catch (error) {
      console.error(`[petal] library skipped ${target.sessionId}:`, String((error as Error).message ?? error).split('\n')[0]);
      return { added: 0, updated: 0, skipped: `couldn’t read Claude’s answer (${String((error as Error).message ?? error).split('\n')[0]})` };
    } finally {
      active -= 1;
      if (!queued.has(target.sessionId)) reading.delete(target.sessionId); // queued again meanwhile: still reading
      if (willRead) sessionChanged(target.sessionId);
    }
  });
  queued.set(target.sessionId, job);
  chain = job;
  return job;
}

// For the triggers: fire and forget, never throws.
export function harvest(session: { sessionId?: string | null; transcript?: string | null } | null | undefined): void {
  if (!session?.sessionId || !session.transcript) return;
  void queueSession({ sessionId: session.sessionId, transcript: session.transcript }).then((result) => {
    if (!result.usage) return;
    recordRun('auto', 1, result.usage);
    for (const listener of changeListeners) listener(); // an open Library shows the new token count
  });
}

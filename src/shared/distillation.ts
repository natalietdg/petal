// Distillation: each test-loop round, Claude asks itself a few pointed questions, answers them from evidence,
// leaves what it could not settle as "## Open threads", and picks a course. Petal reads all three from replies.
// Pure, so vitest covers it; main stores records in <repo>/.petal/distillation.jsonl, the renderer draws them.
import { codeFenceTracker } from './status-lines';
import { parseLoop } from './loop-line';
import { parseThreads, sameThread, threadNeedsYou, type Thread } from './reply-threads';

export const COURSES = ['add-scenarios', 'retest', 'fix-bug', 'hand-to-you'] as const;
export type Course = typeof COURSES[number];
export const COURSE_WORDS: Record<Course, string> = { 'add-scenarios': 'Add scenarios', retest: 'Retest', 'fix-bug': 'Fix bug', 'hand-to-you': 'Hand to you' };

export const DISTILL_PATH = '.petal/distillation.jsonl';
export const DISTILL_FILE_CAP = 1024 * 1024; // bytes read
export const RECORDS_CAP = 400; // per project, newest kept
export const QUESTIONS_CAP = 8;
const TEXT_CAP = 400;

// verdict: a revisit of an earlier round's open thread says whether it was settled, carried or dropped.
export type Verdict = 'settled' | 'carried' | 'dropped';
export interface DistillQuestion { q: string; a: string; needsYou: boolean; verdict?: Verdict }
export interface DistillThread extends Thread { needsYou: boolean }

export interface Distillation {
  questions: DistillQuestion[];
  course: Course | null; // null until the Course line is written
  reason: string;
  threads: DistillThread[]; // the reply's "## Open threads": what the round could not settle from evidence
  malformed: number; // list lines in the section that are not a Q/A pair
}

// One round's distillation, as stored: the reply it came from is its id.
export interface DistillRecord {
  id: string;
  sessionId: string | null;
  at: number;
  round: number | null;
  total: number | null;
  questions: DistillQuestion[];
  course: Course;
  reason: string;
  threads: DistillThread[];
}

const HEADING = /^\s*#{1,6}\s+distillation\b/i;
const ANY_HEADING = /^\s*#{1,6}\s/;
const LIST_LINE = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;
const Q_START = /^(?:\*\*|__)?q(?:uestion)?\s*(?:\d+)?\s*(?::\s*(?:\*\*|__)|(?:\*\*|__)\s*:|:)\s*(.*)$/i;
const A_START = /^(?:[-*+]\s+)?(?:\*\*|__)?a(?:nswer)?\s*(?::\s*(?:\*\*|__)|(?:\*\*|__)\s*:|:)\s*(.*)$/i;
// " · A: ", " - A: ", " — A: " or " | A: " between a question and its answer on one line.
const INLINE_A = /\s+(?:[·•|]|[-–—]{1,2})\s+(?:\*\*|__)?a(?:nswer)?\s*(?::\s*(?:\*\*|__)|(?:\*\*|__)\s*:|:)\s*/i;
const COURSE_LINE = /^\s*(?:[-*+]\s+)?(?:\*\*|__)?course(?:\s*:\s*(?:\*\*|__)|(?:\*\*|__)\s*:|\s*:)\s*(.+)$/i;
const NEEDS_YOU = /^(?:\*\*|__|`)?needs\s+you(?:\*\*|__|`)?\s*(?:[·•:,;.|]|[-–—]{1,2})?\s*/i;
const VERDICT = /^(?:\*\*|__|`)?(settled|carried(?:\s+forward)?|still\s+open|dropped)(?:\*\*|__|`)?\s*(?:[·•:,;.|]|[-–—]{1,2})?\s*/i;

const COURSE_NAMES: [Course, RegExp][] = [
  ['add-scenarios', /^add\s+(?:more\s+)?scenarios?\b/i],
  ['retest', /^re-?test\b/i],
  ['fix-bug', /^fix(?:\s+the)?\s+bugs?\b/i],
  ['hand-to-you', /^(?:hand(?:\s+it)?\s+(?:to|over\s+to|back\s+to)\s+you|hand\s*(?:off|over)|human\s+hand(?:off|over))\b/i],
];

const clean = (text: string): string => text.replace(/\s+/g, ' ').replace(/^(?:\*\*|__)+|(?:\*\*|__)+$/g, '').trim().slice(0, TEXT_CAP);

// "add scenarios · the empty cart path has no test" -> add-scenarios, "the empty cart path has no test".
export function parseCourse(line: string): { course: Course; reason: string } | null {
  const body = COURSE_LINE.exec(line)?.[1];
  if (!body) return null;
  const text = body.replace(/^(?:\*\*|__|`)+/, '').trim();
  for (const [course, pattern] of COURSE_NAMES) {
    const match = pattern.exec(text);
    if (!match) continue;
    const rest = text.slice(match[0].length).replace(/^(?:\*\*|__|`)+/, '').replace(/^\s*(?:[·•:,;.|(]|[-–—]{1,2})?\s*(?:because\b)?\s*/i, '').replace(/\)\s*$/, '');
    return { course, reason: clean(rest) };
  }
  return null;
}

// An answer that starts with "needs you" is a question only she can answer; the marker is dropped from the text.
// "settled · ...", "carried · ..." or "dropped · ..." answers a revisited thread.
function answerOf(raw: string): { a: string; needsYou: boolean; verdict?: Verdict } {
  const text = clean(raw);
  const marker = NEEDS_YOU.exec(text);
  if (marker) return { a: clean(text.slice(marker[0].length)), needsYou: true };
  const verdict = VERDICT.exec(text);
  if (!verdict) return { a: text, needsYou: false };
  const word = (verdict[1] ?? '').toLowerCase();
  return { a: clean(text.slice(verdict[0].length)), needsYou: false, verdict: word.startsWith('settled') ? 'settled' : word.startsWith('dropped') ? 'dropped' : 'carried' };
}

// The first "## Distillation" section of a reply, outside code; null when there is none.
export function parseDistillation(markdown: string): Distillation | null {
  const inCode = codeFenceTracker();
  let inSection = false;
  let found = false;
  let pending: string | null = null; // a question still waiting for its answer line
  const out: Distillation = { questions: [], course: null, reason: '', threads: [], malformed: 0 };
  const push = (q: string, a: string) => {
    const answer = answerOf(a);
    if (!clean(q) || (!answer.a && !answer.needsYou)) { out.malformed += 1; return; }
    if (out.questions.length < QUESTIONS_CAP) out.questions.push({ q: clean(q), ...answer });
  };
  for (const raw of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    if (inCode(raw)) continue;
    // The Course line counts anywhere after the heading, so one written just below the section still lands.
    const course = found && !out.course ? parseCourse(raw) : null;
    if (course) { out.course = course.course; out.reason = course.reason; continue; }
    if (HEADING.test(raw)) { if (found) { inSection = false; continue; } found = true; inSection = true; continue; }
    if (ANY_HEADING.test(raw)) { inSection = false; continue; }
    if (!inSection || !raw.trim()) continue;
    const item = LIST_LINE.exec(raw)?.[1]?.trim() ?? null;
    const line = item ?? raw.trim();
    const answer = A_START.exec(line);
    if (answer && pending !== null) { push(pending, answer[1] ?? ''); pending = null; continue; }
    const question = Q_START.exec(line);
    if (question) {
      if (pending !== null) out.malformed += 1; // the last question never got an answer
      const body = question[1] ?? '';
      const split = INLINE_A.exec(body);
      if (split) { push(body.slice(0, split.index), body.slice(split.index + split[0].length)); pending = null; } else pending = body;
      continue;
    }
    if (item !== null) out.malformed += 1;
  }
  if (pending !== null) out.malformed += 1;
  if (!found) return null;
  out.threads = parseThreads(markdown).map((t) => ({ ...t, needsYou: threadNeedsYou(t) }));
  return out;
}

export const needsHuman = (d: Pick<Distillation, 'course' | 'questions' | 'threads'>): boolean =>
  d.course === 'hand-to-you' || d.questions.some((q) => q.needsYou) || d.threads.some((t) => t.needsYou);

const askedOfHer = (d: Pick<Distillation, 'questions' | 'threads'>): string[] =>
  [...d.questions.filter((q) => q.needsYou).map((q) => q.q), ...d.threads.filter((t) => t.needsYou).map((t) => t.question)];

// The one line the reader and Board cards lead with.
export function handoffQuestion(d: Pick<Distillation, 'course' | 'questions' | 'reason' | 'threads'>): string {
  return askedOfHer(d)[0] || d.reason || 'Claude handed the test loop to you.';
}

export interface ReplyLike { id?: string | undefined; markdown: string; timestamp?: string | undefined }

// One reply as a record, when its distillation is complete (it has a Course line).
export function recordOf(reply: ReplyLike, sessionId: string | null): DistillRecord | null {
  if (!reply.id) return null;
  const d = parseDistillation(reply.markdown);
  if (!d?.course) return null;
  const loop = parseLoop(reply.markdown);
  const at = Date.parse(reply.timestamp ?? '');
  return { id: reply.id, sessionId, at: Number.isFinite(at) ? at : 0, round: loop?.round ?? null, total: loop?.total ?? null, questions: d.questions, course: d.course, reason: d.reason, threads: d.threads };
}

// Replies newest first -> records oldest first; only replies at or after `since` (ms) count.
export function recordsFromReplies(newestFirst: readonly ReplyLike[], sessionId: string | null, since = 0): DistillRecord[] {
  const out: DistillRecord[] = [];
  for (const reply of newestFirst) {
    const record = recordOf(reply, sessionId);
    if (!record) continue;
    if (since && record.at && record.at < since) break;
    out.push(record);
  }
  return out.reverse();
}

// Stored and live records together: one per reply id, the later copy winning, oldest first.
export function mergeRecords(...lists: readonly (readonly DistillRecord[])[]): DistillRecord[] {
  const byId = new Map<string, DistillRecord>();
  for (const list of lists) for (const record of list) byId.set(record.id, record);
  return [...byId.values()].sort((a, b) => a.at - b.at);
}

// A tab's open hand-off: its newest reply asks for her and she has not written since.
export interface Handoff { replyId: string; question: string; asks: string[]; course: Course | null; reason: string }

export function openHandoff(newestFirst: readonly ReplyLike[], waiting: number): Handoff | null {
  const newest = newestFirst[0];
  if (!newest?.id || waiting > 0) return null;
  const d = parseDistillation(newest.markdown);
  if (!d || !needsHuman(d)) return null;
  const asks = askedOfHer(d);
  return { replyId: newest.id, question: handoffQuestion(d), asks, course: d.course, reason: d.reason };
}

// What her answer sends: the question it answers, then her words, then go on.
export function handoffAnswer(handoff: Pick<Handoff, 'question'>, answer: string): string {
  const q = handoff.question.length > 160 ? `${handoff.question.slice(0, 159).trimEnd()}…` : handoff.question;
  return `On your distillation question "${q}": ${answer.trim()}\nCarry on with the test loop from here.`;
}

// ---- The jsonl file: one record per line; a line that is not a valid record is skipped.
const VERDICTS: readonly Verdict[] = ['settled', 'carried', 'dropped'];
const THREADS_CAP = 12;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const numberOrNull = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

export function toRecord(raw: unknown): DistillRecord | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id || !COURSES.includes(raw.course as Course) || !Array.isArray(raw.questions)) return null;
  const questions = raw.questions.filter(isRecord).filter((q) => typeof q.q === 'string' && typeof q.a === 'string')
    .slice(0, QUESTIONS_CAP).map((q) => ({ q: clean(String(q.q)), a: clean(String(q.a)), needsYou: q.needsYou === true, ...(VERDICTS.includes(q.verdict as Verdict) ? { verdict: q.verdict as Verdict } : {}) }));
  const threads = (Array.isArray(raw.threads) ? raw.threads : []).filter(isRecord).filter((t) => typeof t.question === 'string' && t.question)
    .slice(0, THREADS_CAP).map((t) => ({ question: clean(String(t.question)), check: typeof t.check === 'string' ? clean(t.check) : null, needsYou: t.needsYou === true }));
  return {
    id: raw.id.slice(0, 200), sessionId: typeof raw.sessionId === 'string' ? raw.sessionId : null, at: numberOrNull(raw.at) ?? 0,
    round: numberOrNull(raw.round), total: numberOrNull(raw.total), questions, course: raw.course as Course, reason: typeof raw.reason === 'string' ? clean(raw.reason) : '', threads,
  };
}

export function parseJsonl(text: string): DistillRecord[] {
  const out: DistillRecord[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { const record = toRecord(JSON.parse(line)); if (record) out.push(record); } catch { /* a torn or hand-edited line */ }
  }
  return mergeRecords(out);
}

export const toJsonl = (records: readonly DistillRecord[]): string => records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : '');

// Records grouped by session, each oldest first; sessions newest first by their latest record.
export function bySession(records: readonly DistillRecord[]): { sessionId: string | null; records: DistillRecord[] }[] {
  const groups = new Map<string | null, DistillRecord[]>();
  for (const record of mergeRecords(records)) groups.set(record.sessionId, [...(groups.get(record.sessionId) ?? []), record]);
  return [...groups].map(([sessionId, list]) => ({ sessionId, records: list })).sort((a, b) => (b.records.at(-1)?.at ?? 0) - (a.records.at(-1)?.at ?? 0));
}

// The Activity feed's line for a course decision.
export const courseText = (record: Pick<DistillRecord, 'course' | 'reason' | 'round'>, repo: string): string =>
  `Test loop${record.round ? ` round ${record.round}` : ''} in ${repo}: ${COURSE_WORDS[record.course].toLowerCase()}${record.reason ? ` · ${record.reason}` : ''}`;

// ---- Each open thread's fate across rounds: still open, settled, carried forward, or dropped with a reason.
export type ThreadStatus =
  | { kind: 'open' }
  | { kind: 'settled' | 'carried' | 'dropped'; round: number | null; note: string };

// The first later round that revisits the thread decides: a Q/A with a verdict (a plain answer settles it),
// or the thread listed as open again (carried). No later mention: still open.
export function threadStatus(records: readonly DistillRecord[], index: number, thread: Pick<Thread, 'question'>): ThreadStatus {
  for (const later of records.slice(index + 1)) {
    const revisit = later.questions.find((q) => !q.needsYou && sameThread(q.q, thread.question));
    const kind = revisit?.verdict ?? (revisit ? 'settled' : null);
    if (kind === 'settled' || kind === 'dropped') return { kind, round: later.round, note: revisit?.a ?? '' };
    if (kind === 'carried' || later.threads.some((t) => sameThread(t.question, thread.question))) return { kind: 'carried', round: later.round, note: revisit?.a ?? '' };
  }
  return { kind: 'open' };
}

export function statusWord(status: ThreadStatus): string {
  if (status.kind === 'open') return 'open';
  if (status.kind === 'carried') return `carried${status.round ? ` to round ${status.round}` : ''}`;
  return `${status.kind}${status.round ? ` in round ${status.round}` : ''}`;
}

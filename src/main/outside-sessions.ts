// Claude Code sessions Petal did not start (VS Code, iTerm, the desktop app): what waits on her, read from their
// session file and transcript only, and a read-only source the reader can follow. Petal never types into them.
import fs from 'node:fs';
import { readTail } from './jsonl-window';
import { claudeFolderAllowed } from './claude-folder';
import { ReplyCollector } from './replies';
import { pendingAsk } from './subsessions';
import { transcriptPath, type SessionFile } from './claude-session';
import { liveSessions } from './sessions-monitor';
import { isSnapshotRun, panelFixture } from './snapshot-mode';
import * as history from './history';
import { laneItems, waitingItems } from '../shared/waiting';
import { OUTSIDE_REASONS, RECENT_HOURS } from '../shared/outside-sessions';
import { repoLabel } from './repo-label';
import type { SessionSignals } from '../shared/needs-you';
import type { FollowedSession } from './reader-feed';
import type { TranscriptEntry } from './transcript-entry';

const TAIL_BYTES = 256 * 1024;
const RECENT_REPLIES = 3;
const ENDED_SHOWN = 8;

// Claude Code 2.1.325 writes status "waiting" (waitingFor "input needed") while it waits on her; older versions never do.
type WithStatus = SessionFile & { status?: string; waitingFor?: unknown; statusUpdatedAt?: unknown };

interface TailFacts {
  question: number | null; // an unanswered AskUserQuestion, since
  decide: { text: string; replyId: string | undefined; at: number | null } | null;
}

const tailCache = new Map<string, { size: number; mtime: number; facts: TailFacts }>();
const timeOf = (iso: string | undefined): number | null => {
  const ms = Date.parse(iso ?? '');
  return Number.isFinite(ms) ? ms : null;
};

export function tailFacts(entries: readonly TranscriptEntry[], sessionId: string): TailFacts {
  const asking = pendingAsk(entries) === 'question';
  const askEntry = asking ? [...entries].reverse().find((e) => e.type === 'assistant') : undefined;
  const collector = new ReplyCollector(RECENT_REPLIES);
  for (const entry of entries) collector.add(entry);
  const item = laneItems(waitingItems([{ tabId: sessionId, title: '', replies: collector.newestFirst(), waiting: collector.waiting() }]))[0];
  return { question: asking ? timeOf(askEntry?.timestamp) ?? Date.now() : null, decide: item ? { text: item.text, replyId: item.replyId, at: item.at } : null };
}

function factsOf(file: string, sessionId: string): TailFacts | null {
  const stat = fs.statSync(file, { throwIfNoEntry: false });
  if (!stat) return null;
  const hit = tailCache.get(file);
  if (hit && hit.size === stat.size && hit.mtime === stat.mtimeMs) return hit.facts;
  const facts = tailFacts(readTail(file, TAIL_BYTES).entries, sessionId);
  tailCache.set(file, { size: stat.size, mtime: stat.mtimeMs, facts });
  return facts;
}

// One session's wait, strongest first: a question in the transcript, Claude Code's own "waiting" status, an open Decide line.
// The status says it waits but not on what (a permission prompt never reaches the transcript), so that row names no cause.
export function outsideSignal(session: WithStatus, title: string, facts: TailFacts | null): SessionSignals {
  const base = { sessionId: session.sessionId, tabId: null, windowId: null, title, children: [], outside: true };
  const statusSince = typeof session.statusUpdatedAt === 'number' ? session.statusUpdatedAt : null;
  if (facts?.question) return { ...base, ask: 'question', askSince: facts.question, decide: null, reason: OUTSIDE_REASONS.question };
  if (session.status === 'waiting') return { ...base, ask: 'question', askSince: statusSince, decide: null, reason: OUTSIDE_REASONS.unknown };
  if (facts?.decide) return { ...base, ask: null, askSince: null, decide: facts.decide, reason: OUTSIDE_REASONS.decide };
  return { ...base, ask: null, askSince: null, decide: null };
}

// Every live session no Petal window holds; headless children roll up to their parent instead.
export function outsideSignals(live: readonly SessionFile[], inPetal: ReadonlySet<string>, nameOf: (s: SessionFile) => string): SessionSignals[] {
  if (!claudeFolderAllowed()) return []; // nothing is read from a folder she hasn't allowed
  return live.filter((s) => !inPetal.has(s.sessionId) && s.entrypoint !== 'sdk-cli').map((s) => {
    let facts: TailFacts | null;
    try { facts = factsOf(transcriptPath(s), s.sessionId); } catch { facts = null; } // unreadable log: the status still counts
    return outsideSignal(s, nameOf(s), facts);
  });
}

// Live session files; a snapshot run's are the panel fixture's, so a followed fixture session reads as live.
export const liveNow = (): SessionFile[] => (isSnapshotRun() ? panelFixture.sessions ?? [] : liveSessions());

// What the reader follows: the live session file each tick (for busy and idle), else History's record of an ended one.
export function followSource(sessionId: string): () => FollowedSession | null {
  return () => {
    if (!claudeFolderAllowed()) return null;
    const live = liveNow().find((s) => s.sessionId === sessionId) as WithStatus | undefined;
    if (live) return { ...live, status: live.status === 'busy' ? 'busy' : 'idle', transcript: transcriptPath(live) };
    const record = history.findRecord(sessionId);
    return record ? { sessionId, transcript: record.file, cwd: record.cwd ?? undefined, status: 'idle' } : null;
  };
}

// Board's Ended today: sessions that stopped in the last 12 hours and no Petal tab holds; each opens read-only.
export interface EndedSession { sessionId: string; title: string; place: string; cwd: string | null; endedAt: number }
const ENDED_CACHE_MS = 30_000; // the Board ticks every 2s; History's week of logs need not be listed that often
let endedCache: { at: number; list: history.ListedSession[] } | null = null;

export function endedToday(live: readonly string[], inPetal: ReadonlySet<string>, now = Date.now()): EndedSession[] {
  if (!endedCache || now - endedCache.at > ENDED_CACHE_MS) endedCache = { at: now, list: history.listSessions() };
  const since = now - RECENT_HOURS * 60 * 60 * 1000;
  return endedCache.list
    .filter((r) => r.lastAt >= since && !r.headless && !live.includes(r.sessionId) && !inPetal.has(r.sessionId))
    .slice(0, ENDED_SHOWN)
    .map((r) => ({ sessionId: r.sessionId, title: r.title || r.firstPrompt, place: repoLabel(r.cwd) ?? r.shortCwd, cwd: r.cwd, endedAt: r.lastAt }));
}

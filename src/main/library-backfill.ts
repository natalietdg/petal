// Read past sessions: finds her Claude Code logs from a chosen range and feeds them, newest first, through the
// Library's one-at-a-time queue (library-extract.ts). Offsets mean nothing is read twice, so a rerun resumes.
// An explicit click, so it runs with Build my Library off; never without the Claude folder gate.
import fs from 'node:fs';
import path from 'node:path';
import { allowedClaudeHome } from './claude-folder';
import { CHUNK_BYTES, MAX_CHUNKS_PER_RUN, loadOffsets, queueSession, type SessionTarget } from './library-extract';
import { estimateSessions } from './library-estimate';
import { recordRun } from './library-cost-store';
import { IDLE_BACKFILL, type BackfillDays, type BackfillPlan, type BackfillState } from '../shared/library';
import { NO_USAGE, addUsage } from '../shared/library-cost';

const DAY_MS = 24 * 60 * 60 * 1000;
const HEAD_BYTES = 64 * 1024; // enough of a log to tell a subagent's own log apart
const NO_FOLDER = 'Petal isn’t reading your Claude folder';
// A skip that would repeat for every log, so the rest are not tried.
const STOPS_ALL = new Set([NO_FOLDER, 'Claude Code isn’t installed', 'snapshot run']);

export interface PastSession extends SessionTarget {
  modifiedMs: number;
  unread: number; // bytes after the saved offset
}

// A log whose user and assistant lines are all marked sidechain is a subagent's, not a session she had.
export function sidechainOnly(file: string): boolean {
  if (path.basename(file).startsWith('agent-')) return true;
  const buffer = Buffer.alloc(Math.min(HEAD_BYTES, fs.statSync(file).size));
  const fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, buffer, 0, buffer.length, 0); } finally { fs.closeSync(fd); }
  let talk = 0;
  for (const line of buffer.toString('utf8').split('\n')) {
    let entry: { type?: unknown; isSidechain?: unknown };
    try { entry = JSON.parse(line) as typeof entry; } catch { continue; } // the cut-off last line
    if (entry.type !== 'user' && entry.type !== 'assistant') continue;
    if (entry.isSidechain !== true) return false;
    talk += 1;
  }
  return talk > 0;
}

// Session logs sit one level down, projects/<folder>/<session id>.jsonl; subagents' logs live deeper and are left out.
// days 0 is every log. Fully read logs and subagent-only logs are skipped. Newest first.
export function listPastSessions(home: string, { days, now = Date.now() }: { days: BackfillDays; now?: number }): PastSession[] {
  const projects = path.join(home, 'projects');
  if (!fs.existsSync(projects)) return [];
  const since = days ? now - days * DAY_MS : 0;
  const offsets = loadOffsets();
  const found: PastSession[] = [];
  for (const folder of fs.readdirSync(projects, { withFileTypes: true })) {
    if (!folder.isDirectory()) continue;
    const dir = path.join(projects, folder.name);
    for (const file of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!file.isFile() || !file.name.endsWith('.jsonl')) continue;
      const transcript = path.join(dir, file.name);
      const { size, mtimeMs } = fs.statSync(transcript);
      if (mtimeMs < since) continue;
      const sessionId = file.name.slice(0, -'.jsonl'.length);
      const read = offsets[sessionId]?.offset ?? 0;
      const unread = read > size ? size : size - read; // a shorter log was replaced and is read again
      if (unread <= 0 || sidechainOnly(transcript)) continue;
      found.push({ sessionId, transcript, modifiedMs: mtimeMs, unread });
    }
  }
  return found.sort((a, b) => b.modifiedMs - a.modifiedMs);
}

// One Claude call per CHUNK_BYTES not yet read, at most MAX_CHUNKS_PER_RUN a session; a rerun picks up any rest.
export const callsFor = (unread: number): number => Math.min(MAX_CHUNKS_PER_RUN, Math.max(1, Math.ceil(unread / CHUNK_BYTES)));

export function planBackfill(days: BackfillDays, now = Date.now()): BackfillPlan | { skipped: string } {
  const home = allowedClaudeHome();
  if (!home) return { skipped: NO_FOLDER };
  const sessions = listPastSessions(home, { days, now });
  return { days, sessions: sessions.length, calls: sessions.reduce((sum, s) => sum + callsFor(s.unread), 0), estimate: estimateSessions(sessions) };
}

// ---- The run: one at a time in the background, until done or stopped; gone on restart, offsets keep the place.
let state: BackfillState = { ...IDLE_BACKFILL };
let stopRequested = false;
let current: Promise<void> = Promise.resolve();
const listeners = new Set<(state: BackfillState) => void>();

export const backfillState = (): BackfillState => ({ ...state });
export const whenIdle = (): Promise<void> => current;
export function onBackfill(listener: (state: BackfillState) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function set(next: Partial<BackfillState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener(backfillState());
}

export function startBackfill(days: BackfillDays, now = Date.now()): BackfillState | { skipped: string } {
  if (state.running) return backfillState();
  const home = allowedClaudeHome();
  if (!home) return { skipped: NO_FOLDER };
  const sessions = listPastSessions(home, { days, now });
  stopRequested = false;
  set({ ...IDLE_BACKFILL, running: sessions.length > 0, total: sessions.length, days });
  current = (async () => {
    try {
      for (const session of sessions) {
        if (stopRequested) break;
        const result = await queueSession(session, { force: true });
        const usage = result.usage ? addUsage(state.usage ?? NO_USAGE, result.usage) : state.usage;
        set({ done: state.done + 1, added: state.added + result.added, updated: state.updated + result.updated, usage });
        if (result.skipped && STOPS_ALL.has(result.skipped)) { set({ note: result.skipped }); break; }
      }
    } finally {
      if (state.usage) recordRun('past', state.done, state.usage);
      set({ running: false, stopping: false });
    }
  })();
  return backfillState();
}

// Ends after the run in progress; the queue never cuts a Claude call short.
export function stopBackfill(): BackfillState {
  if (state.running) { stopRequested = true; set({ stopping: true }); }
  return backfillState();
}

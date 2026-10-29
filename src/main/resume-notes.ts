// On quit, a resume note per open tab in ~/.petal/resume/<stamp>/ plus index.md. Bounded in time, never throws into quit.
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { petalDir } from './petal-home';
import { repoBranch, repoRoot } from './repo-label';
import { tabLabel } from './tabs';
import { buildIndex, buildResumeNote, folderStamp, NO_GIT, noteFileName, type IndexEntry, type ResumeGit, type ResumeSession } from './resume-notes-text';
import type { TabSession, TabSessions } from './tab-session';

export const BUDGET_MS = 3000; // the longest quit waits for the notes
const GIT_TIMEOUT_MS = 1500;
const WRITE_RESERVE_MS = 500; // kept back from git for writing the files
const CLOSING_CAPTURE_MS = 10_000; // a last-window capture older than this belongs to a close that didn't quit

export const resumeRoot = (): string => path.join(petalDir(), 'resume');

// What one tab showed at this moment; synchronous, so it can run while a window is closing.
export function captureTab(tab: TabSession): ResumeSession {
  const followed = tab.feed.session;
  const replies = tab.feed.shownReplies; // newest first
  const waiting = tab.feed.waitingPrompts;
  const lastReply = replies[0];
  const newestAt = [waiting.at(-1)?.timestamp, lastReply?.timestamp].filter((t): t is string => Boolean(t)).sort().at(-1) ?? null;
  return {
    title: tabLabel(tab),
    sessionId: followed?.sessionId ?? null,
    cwd: followed?.cwd ?? null,
    running: followed?.status === 'busy' || followed?.status === 'waiting',
    agent: tab.agent,
    lastActive: newestAt,
    lastPrompt: waiting.at(-1)?.prompt ?? replies.find((r) => r.prompt)?.prompt ?? '',
    lastReply: lastReply?.markdown ?? '',
    waiting: waiting.map((w) => w.prompt),
  };
}

export const captureTabs = (tabs: Iterable<TabSession>): ResumeSession[] => [...tabs].map(captureTab);

type StatusRead = { ok: string } | { timedOut: true } | { failed: true };

function gitStatus(cwd: string, timeout: number): Promise<StatusRead> {
  return new Promise((resolve) => {
    // GIT_OPTIONAL_LOCKS=0: a read never takes the index lock from her running git.
    execFile('git', ['status', '--short'], { cwd, timeout, encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }, (error, stdout) => {
      if (!error) resolve({ ok: stdout });
      else resolve(error.killed ? { timedOut: true } : { failed: true });
    });
  });
}

// Branch from HEAD on disk; uncommitted files from git, within what is left of the budget.
async function gitFor(cwd: string | null, deadline: number): Promise<ResumeGit> {
  if (!cwd || !repoRoot(cwd)) return NO_GIT;
  const branch = repoBranch(cwd);
  const left = deadline - Date.now();
  if (left <= 0) return { branch, status: null, notes: ['Uncommitted files skipped: out of time at quit.'] };
  const read = await gitStatus(cwd, Math.min(GIT_TIMEOUT_MS, left));
  if ('ok' in read) return { branch, status: read.ok, notes: [] };
  if ('timedOut' in read) return { branch, status: null, notes: [`Uncommitted files skipped: git status took over ${Math.min(GIT_TIMEOUT_MS, left)}ms.`] };
  return { branch, status: null, notes: [] };
}

export interface WriteResult {
  dir: string;
  files: string[]; // note file names, without index.md
  ms: number;
}

// Writes every note in parallel, then the index. One tab per session id; a second tab on the same one adds nothing.
export async function writeResumeNotes(tabs: readonly ResumeSession[], { root = resumeRoot(), now = new Date(), budgetMs = BUDGET_MS } = {}): Promise<WriteResult> {
  const started = Date.now();
  const deadline = started + budgetMs - WRITE_RESERVE_MS;
  const dir = path.join(root, folderStamp(now));
  await fs.mkdir(dir, { recursive: true });
  const seen = new Set<string>();
  const entries = tabs.flatMap((session): IndexEntry[] => {
    if (!session.sessionId) return [{ session, file: null }];
    if (seen.has(session.sessionId)) return [];
    seen.add(session.sessionId);
    return [{ session, file: noteFileName(session.title, session.sessionId) }];
  });
  await Promise.all(entries.map(async ({ session, file }) => {
    if (!file || !session.sessionId) return;
    const git = await gitFor(session.cwd, deadline);
    await fs.writeFile(path.join(dir, file), buildResumeNote({ ...session, sessionId: session.sessionId }, git));
  }));
  await fs.writeFile(path.join(dir, 'index.md'), buildIndex(entries, now));
  return { dir, files: entries.flatMap((e) => (e.file ? [e.file] : [])), ms: Date.now() - started };
}

let closing: { at: number; tabs: ResumeSession[] } | null = null;
let quitWrite: Promise<void> | null = null;
let written = false;

// The last window is closing: its tabs are stopped before quit starts, so read them now.
export function noteClosingWindow(sessions: TabSessions): void {
  closing = { at: Date.now(), tabs: captureTabs(sessions.values()) };
}

// True once this run's quit notes are written (or given up on); quit no longer waits.
export const quitNotesDone = (): boolean => written;

// Once per run, from any quit route. Resolves within the budget and never rejects.
export function writeOnQuit(sessions: TabSessions): Promise<void> {
  quitWrite ??= (async () => {
    try {
      const live = captureTabs(sessions.values());
      const tabs = live.length || !closing || Date.now() - closing.at > CLOSING_CAPTURE_MS ? live : closing.tabs;
      let timer: NodeJS.Timeout | undefined;
      const late = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), BUDGET_MS); });
      const result = await Promise.race([writeResumeNotes(tabs), late]).finally(() => clearTimeout(timer));
      if (!result) console.warn('[petal] resume notes: gave up after the time budget');
    } catch (error) {
      console.error('[petal] resume notes failed:', error);
    } finally {
      written = true;
    }
  })();
  return quitWrite;
}

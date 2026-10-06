// Runs her shell command once per finished reply: reply markdown on stdin, PETAL_* env vars, 30s limit.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { app, Notification } from 'electron';
import * as configStore from './config-store';
import { claudePath, cleanEnv } from './claude-cli';
import type { Reply } from '../shared/types';

export const TIMEOUT_MS = 30_000;
const MAX_RUNS = 5; // ring buffer shown on the Customize page
const STDERR_CHARS = 200;
const MAX_SEEN = 500; // reply ids remembered for dedupe
const MAX_REPLY_FILES = 20;

export interface HookRun {
  at: string;
  title: string | null;
  test: boolean;
  exitCode: number | null;
  timedOut?: boolean;
  ms: number;
  stderr: string;
}

export type HookTestResult = HookRun | { skipped: string };

interface RunOptions {
  replyId: string;
  markdown: string;
  sessionId?: string | null;
  title?: string | null;
  cwd?: string | null;
  test?: boolean;
  timeoutMs?: number;
}

const SAMPLE_REPLY = `**Petal's response hook works.**

This is a sample reply sent by "Test hook". A real one arrives each time Claude finishes a turn.`;

const seen = new Set<string>();
const runs: HookRun[] = [];
let skippedInSnapshot = 0;

export const hookDir = (): string => path.join(app.getPath('userData'), 'hook');
const isSnapshotRun = () => process.env.PASTEL_SNAPSHOT === '1';
const safeName = (id: string) => String(id).replace(/[^a-zA-Z0-9-]/g, '').slice(0, 64) || 'reply';

function remember(id: string): void {
  seen.add(id);
  if (seen.size > MAX_SEEN) {
    const oldest = seen.values().next().value;
    if (oldest !== undefined) seen.delete(oldest);
  }
}

function record(run: HookRun): HookRun {
  runs.unshift(run);
  runs.length = Math.min(runs.length, MAX_RUNS);
  return run;
}

// Keeps the newest reply files only; older ones were already handed to their hook run.
function writeReplyFile(id: string, markdown: string): string {
  fs.mkdirSync(hookDir(), { recursive: true });
  const file = path.join(hookDir(), `${safeName(id)}.md`);
  fs.writeFileSync(file, markdown);
  const old = fs.readdirSync(hookDir()).filter((f) => f.endsWith('.md'))
    .map((f) => ({ f, mtime: fs.statSync(path.join(hookDir(), f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime).slice(MAX_REPLY_FILES);
  for (const { f } of old) fs.rmSync(path.join(hookDir(), f), { force: true });
  return file;
}

const firstLine = (markdown: string) => (String(markdown).split('\n').find((l) => l.trim()) ?? '')
  .replace(/[*_`#>=]/g, '').trim().slice(0, 140);

function notify(title: string | null | undefined, markdown: string): void {
  if (!Notification.isSupported()) return;
  new Notification({ title: title || 'Claude replied', body: firstLine(markdown) }).show();
}

// Resolves with the run record; never rejects, so callers can fire and forget.
export async function runCommand(command: string, { replyId, markdown, sessionId, title, cwd, test = false, timeoutMs = TIMEOUT_MS }: RunOptions): Promise<HookRun> {
  const started = Date.now();
  const base = { at: new Date(started).toISOString(), title: title || null, test };
  let replyFile: string;
  try {
    replyFile = writeReplyFile(replyId, markdown);
  } catch (error) {
    return record({ ...base, exitCode: null, ms: 0, stderr: `Could not write the reply file: ${(error as Error).message}` });
  }
  const dir = cwd && fs.existsSync(cwd) ? cwd : os.homedir();
  const env = { ...cleanEnv(await claudePath()), PETAL_SESSION_ID: sessionId ?? '', PETAL_SESSION_TITLE: title ?? '', PETAL_CWD: dir, PETAL_REPLY_FILE: replyFile };

  return new Promise((resolve) => {
    let stderr = '';
    let timedOut = false;
    let child: ChildProcess | undefined;
    let done = false; // 'error' and 'close' can both fire
    const finish = (exitCode: number | null, extra = '') => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(record({ ...base, exitCode, timedOut, ms: Date.now() - started, stderr: `${extra}${stderr}`.trim().slice(0, STDERR_CHARS) }));
    };
    // Own process group, so the timeout also stops whatever the login shell started.
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-(child?.pid ?? NaN), 'SIGKILL'); } catch { child?.kill('SIGKILL'); }
    }, timeoutMs);
    try {
      child = spawn(process.env.SHELL || '/bin/zsh', ['-lc', command], { cwd: dir, env, detached: true, stdio: ['pipe', 'ignore', 'pipe'] });
    } catch (error) {
      finish(null, `Could not start: ${(error as Error).message}`);
      return;
    }
    child.stderr?.on('data', (chunk) => { if (stderr.length < STDERR_CHARS * 4) stderr += chunk; });
    child.stdin?.on('error', () => {}); // a command that ignores stdin closes the pipe early
    child.stdin?.end(markdown);
    child.on('error', (error) => finish(null, `Could not start: ${error.message}\n`));
    child.on('close', (code) => finish(timedOut ? null : code, timedOut ? `Timed out after ${timeoutMs / 1000}s\n` : ''));
  });
}

// Called by the reader once per finished turn. Returns the run promise, or null when nothing ran.
export function onReplyFinished({ reply, sessionId, title, cwd }: { reply: Reply; sessionId: string; title: string; cwd: string | null }): Promise<HookRun> | null {
  if (isSnapshotRun()) { skippedInSnapshot += 1; return null; } // snapshot runs never run her command
  if (!reply?.id || seen.has(reply.id)) return null;
  remember(reply.id);
  const { command, notify: wantsNotice } = configStore.load().responseHook;
  if (wantsNotice) notify(title, reply.markdown);
  if (!command) return null;
  return runCommand(command, { replyId: reply.id, markdown: reply.markdown, sessionId, title, cwd });
}

// "Test hook": the saved command, once, with a sample reply.
export function test(): Promise<HookTestResult> {
  if (isSnapshotRun()) return Promise.resolve({ skipped: 'snapshot run' });
  const { command } = configStore.load().responseHook;
  if (!command) return Promise.resolve({ skipped: 'no command set' });
  return runCommand(command, { replyId: `test-${Date.now()}`, markdown: SAMPLE_REPLY, sessionId: 'test', title: 'Petal test', cwd: os.homedir(), test: true });
}

export const recentRuns = (): HookRun[] => runs.map((run) => ({ ...run }));
export const stats = (): { skippedInSnapshot: number; runs: number } => ({ skippedInSnapshot, runs: runs.length });

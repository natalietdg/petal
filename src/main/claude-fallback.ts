// Claude Code before 2.1.75 writes no ~/.claude/sessions/<pid>.json, so its transcript is found from its folder and start time.
// The pure part (pickTranscript) decides; the rest gathers facts with async reads only.
import { open, readdir, stat, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { allowedClaudeHome } from './claude-folder';
import { isClaudeCli, projectSlug, readSessionFileAsync, type ClaudeSession, type ProcessRow } from './claude-session';
import type { ReaderNotice, SessionChoice } from '../shared/types';

// First release that writes sessions/<pid>.json at the REPL (bisected: 2.1.74 never does).
export const SESSION_FILE_VERSION = '2.1.75';
const HEAD_BYTES = 64 * 1024; // the first entries of a log; enough for a timestamp and her first prompt
const SCAN_MS = 1500; // one folder scan serves every tab's tick in this window
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---- Versions

export const parseVersion = (text: string): string | null => /\b(\d+\.\d+\.\d+)\b/.exec(text)?.[1] ?? null;

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

export const needsUpdate = (version: string | null): boolean => version !== null && compareVersions(version, SESSION_FILE_VERSION) < 0;

// ---- How claude was launched

export interface Launch {
  sessionId: string | null; // --session-id <uuid>
  resume: string | null; // --resume <uuid>; a bare --resume opens a picker, so it names nothing
  continued: boolean; // --continue
}

export function parseLaunch(args: string): Launch {
  const words = args.trim().split(/\s+/);
  const launch: Launch = { sessionId: null, resume: null, continued: false };
  const uuidAt = (i: number) => (UUID.test(words[i] ?? '') ? words[i] : null);
  words.forEach((word, i) => {
    const [flag, inline] = word.split('=', 2);
    const value = inline !== undefined ? (UUID.test(inline) ? inline : null) : uuidAt(i + 1);
    if (flag === '--resume' || flag === '-r') launch.resume = value;
    else if (flag === '--session-id') launch.sessionId = value;
    else if (flag === '--continue' || flag === '-c') launch.continued = true;
  });
  return launch;
}

// ---- The pick, from facts alone

export interface TranscriptHead {
  sessionId: string;
  file: string;
  firstAt: number | null; // ms of its first timestamped entry
  modifiedAt: number;
  version: string | null; // the Claude Code that wrote it
  prompt: string | null; // her first message, for the "which one is this tab's" choice
}

export interface FolderClaude {
  pid: number;
  startedAt: number;
  version: string | null;
  launch: Launch;
  claimed: string | null; // sessionId known to be its own: its session file, or her pick
}

export type Pick =
  | { kind: 'found'; head: TranscriptHead }
  | { kind: 'ambiguous'; candidates: TranscriptHead[] }
  | { kind: 'none' };

const newest = (heads: TranscriptHead[]): TranscriptHead | undefined => [...heads].sort((a, b) => b.modifiedAt - a.modifiedAt)[0];

// Which log is target's, among every claude running in the same folder. Prefers none over a wrong guess.
// A log born after a claude started can be its own; when several could own it, the one still without a log
// takes it (the newer claude's first prompt), and if that still leaves more than one, nobody does.
export function pickTranscript(targetPid: number, claudes: readonly FolderClaude[], heads: readonly TranscriptHead[]): Pick {
  const target = claudes.find((c) => c.pid === targetPid);
  if (!target) return { kind: 'none' };
  const owner = new Map<string, number>(); // sessionId -> pid
  for (const c of claudes) if (c.claimed) owner.set(c.claimed, c.pid);
  const owns = (pid: number) => [...owner.values()].includes(pid);
  const ambiguous: TranscriptHead[] = [];

  const born = heads.filter((h) => h.firstAt !== null && !owner.has(h.sessionId)).sort((a, b) => (a.firstAt ?? 0) - (b.firstAt ?? 0));
  for (const head of born) {
    const at = head.firstAt ?? 0;
    const eligible = claudes.filter((c) => c.startedAt <= at && !(c.version && head.version && c.version !== head.version));
    const logless = eligible.filter((c) => !owns(c.pid));
    const winner = eligible.length === 1 ? eligible[0] : logless.length === 1 ? logless[0] : null;
    if (winner) owner.set(head.sessionId, winner.pid);
    else if (eligible.some((c) => c.pid === targetPid)) ambiguous.push(head);
  }

  const mine = newest(heads.filter((h) => owner.get(h.sessionId) === targetPid)); // newest covers /clear
  if (mine) return { kind: 'found', head: mine };
  if (ambiguous.length) return { kind: 'ambiguous', candidates: ambiguous };

  // Nothing new yet: a resumed or continued claude carries on an older log.
  const free = heads.filter((h) => !owner.has(h.sessionId));
  const named = target.launch.sessionId ?? target.launch.resume;
  const resumed = named ? free.find((h) => h.sessionId === named) : undefined;
  if (resumed) return { kind: 'found', head: resumed };
  const continued = target.launch.continued ? newest(free.filter((h) => h.firstAt === null || h.firstAt < target.startedAt)) : undefined;
  return continued ? { kind: 'found', head: continued } : { kind: 'none' };
}

// ---- Reading the facts (async only)

const run = (file: string, args: string[], timeout = 3000): Promise<string | null> =>
  new Promise((resolve) => execFile(file, args, { timeout, env: { ...process.env, LC_ALL: 'C' } }, (error, stdout) => resolve(error ? null : stdout)));

interface ProcessFacts { cwd: string; startedAt: number; exe: string | null }
const factsCache = new Map<number, Promise<ProcessFacts | null>>();

// lsof gives the cwd and the executable; ps gives the start time ("Fri Oct 16 17:20:15 2026", local).
async function readFacts(pid: number): Promise<ProcessFacts | null> {
  const [lsof, lstart] = await Promise.all([
    run('/usr/sbin/lsof', ['-a', '-p', String(pid), '-d', 'cwd,txt', '-Fn']),
    run('/bin/ps', ['-o', 'lstart=', '-p', String(pid)]),
  ]);
  const named = new Map<string, string>(); // fd ("cwd", "txt") -> its first path
  let fd = '';
  for (const line of (lsof ?? '').split('\n')) {
    if (line.startsWith('f')) fd = line.slice(1);
    else if (line.startsWith('n') && !named.has(fd)) named.set(fd, line.slice(1));
  }
  const cwd = named.get('cwd');
  const startedAt = Date.parse(lstart?.trim() ?? '');
  if (!cwd || Number.isNaN(startedAt)) return null;
  return { cwd, exe: named.get('txt') ?? null, startedAt };
}

export function processFacts(pid: number): Promise<ProcessFacts | null> {
  let facts = factsCache.get(pid);
  if (!facts) {
    facts = readFacts(pid);
    factsCache.set(pid, facts);
    void facts.then((f) => { if (!f) factsCache.delete(pid); }); // a failed read is retried next tick
  }
  return facts;
}

// Cached facts belong to a pid that may be reused once its process exits.
function forgetExited(processes: readonly ProcessRow[]): void {
  const running = new Set(processes.map((p) => p.pid));
  for (const pid of factsCache.keys()) if (!running.has(pid)) factsCache.delete(pid);
}

const versionCache = new Map<string, Promise<string | null>>();

// `<claude> --version`, once per binary. An npm install runs as `node <script>` and renames itself "claude",
// which hides the script; then the version is unknown here (never node's own) and comes from its log instead.
export function claudeVersion(exe: string | null, args: string): Promise<string | null> {
  if (!exe) return Promise.resolve(null);
  const isNodeExe = path.basename(exe) === 'node';
  const script = isNodeExe ? args.trim().split(/\s+/).find((word, i) => i > 0 && word.includes('/')) ?? null : null;
  if (isNodeExe && !script) return Promise.resolve(null);
  const key = script ? `${exe} ${script}` : exe;
  let version = versionCache.get(key);
  if (!version) {
    version = run(exe, script ? [script, '--version'] : ['--version'], 5000).then((out) => (out ? parseVersion(out) : null));
    versionCache.set(key, version);
  }
  return version;
}

interface Scan { at: number; heads: Promise<TranscriptHead[]> }
const scans = new Map<string, Scan>();
const headCache = new Map<string, TranscriptHead>(); // a log's first entry never changes once written

async function readHead(file: string, modifiedAt: number): Promise<TranscriptHead> {
  const cached = headCache.get(file);
  if (cached) return { ...cached, modifiedAt };
  const head: TranscriptHead = { sessionId: path.basename(file, '.jsonl'), file, firstAt: null, modifiedAt, version: null, prompt: null };
  let handle: FileHandle | null = null;
  try {
    handle = await open(file, 'r');
    const buffer = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEAD_BYTES, 0);
    for (const line of buffer.subarray(0, bytesRead).toString('utf8').split('\n')) {
      let entry: { sessionId?: unknown; timestamp?: unknown; version?: unknown; type?: unknown; message?: { content?: unknown } };
      try { entry = JSON.parse(line); } catch { continue; } // the cut-off last line, or a blank
      if (typeof entry.sessionId === 'string' && UUID.test(entry.sessionId)) head.sessionId = entry.sessionId;
      const at = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : NaN;
      if (head.firstAt === null && !Number.isNaN(at)) head.firstAt = at;
      if (!head.version && typeof entry.version === 'string') head.version = parseVersion(entry.version);
      if (!head.prompt && entry.type === 'user' && typeof entry.message?.content === 'string') head.prompt = entry.message.content.slice(0, 120);
      if (head.firstAt !== null && head.version && head.prompt) break;
    }
  } catch {
    return head; // vanished between listing and reading
  } finally {
    await handle?.close();
  }
  if (head.firstAt !== null && head.prompt) headCache.set(file, head);
  return head;
}

// Logs in one project folder that matter for claudes started at or after `since`, plus every log's name and mtime.
async function scanFolder(dir: string, since: number): Promise<TranscriptHead[]> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith('.jsonl'));
  } catch {
    return []; // no folder yet: claude makes it on her first prompt
  }
  const heads = await Promise.all(names.map(async (name) => {
    const file = path.join(dir, name);
    const info = await stat(file).catch(() => null);
    if (!info) return null;
    const modifiedAt = info.mtimeMs;
    // Only a log touched since the earliest claude started can be one of theirs; the rest need no read.
    return modifiedAt >= since ? readHead(file, modifiedAt) : { sessionId: name.slice(0, -6), file, firstAt: null, modifiedAt, version: null, prompt: null };
  }));
  return heads.filter((h): h is TranscriptHead => h !== null);
}

function folderHeads(dir: string, since: number): Promise<TranscriptHead[]> {
  const key = `${dir}\n${since}`;
  const scan = scans.get(key);
  if (scan && Date.now() - scan.at < SCAN_MS) return scan.heads;
  const heads = scanFolder(dir, since);
  for (const [k, s] of scans) if (Date.now() - s.at >= SCAN_MS) scans.delete(k);
  scans.set(key, { at: Date.now(), heads });
  return heads;
}

// ---- The tab's answer

export interface FallbackResult {
  session: ClaudeSession | null;
  notice: ReaderNotice | null;
}

const choiceOf = (head: TranscriptHead): SessionChoice => ({
  sessionId: head.sessionId,
  startedAt: head.firstAt === null ? null : new Date(head.firstAt).toISOString(),
  prompt: head.prompt,
});

// The session for the claude at pid, which has no session file. picks: pid -> sessionId she chose, across tabs.
export async function findFallbackSession(pid: number, args: string, processes: readonly ProcessRow[], picks: ReadonlyMap<number, string>): Promise<FallbackResult> {
  forgetExited(processes);
  const facts = await processFacts(pid);
  const version = facts ? await claudeVersion(facts.exe, args) : null;
  const hint = (known: string | null) => (needsUpdate(known) ? known : null);
  const oldVersion = hint(version);
  const home = allowedClaudeHome();
  if (!facts || !home) return { session: null, notice: oldVersion ? { oldVersion, choices: [] } : null };

  const others = processes.filter((p) => p.pid !== pid && isClaudeCli(p.comm, p.args));
  const othersFacts = await Promise.all(others.map(async (p) => ({ p, f: await processFacts(p.pid) })));
  const sameFolder = [{ p: { pid, args }, f: facts }, ...othersFacts.filter(({ f }) => f?.cwd === facts.cwd).map(({ p, f }) => ({ p: { pid: p.pid, args: p.args ?? '' }, f: f as ProcessFacts }))];
  const claudes: FolderClaude[] = await Promise.all(sameFolder.map(async ({ p, f }) => ({
    pid: p.pid,
    startedAt: f.startedAt,
    version: p.pid === pid ? version : await claudeVersion(f.exe, p.args),
    launch: parseLaunch(p.args),
    claimed: picks.get(p.pid) ?? (await readSessionFileAsync(p.pid))?.sessionId ?? null,
  })));

  const since = Math.min(...claudes.map((c) => c.startedAt));
  const pick = pickTranscript(pid, claudes, await folderHeads(path.join(home, 'projects', projectSlug(facts.cwd)), since));
  if (pick.kind === 'found') {
    const session: ClaudeSession = { pid, sessionId: pick.head.sessionId, cwd: facts.cwd, transcript: pick.head.file };
    const writer = hint(version ?? pick.head.version); // the log names the claude that wrote it
    return { session, notice: writer ? { oldVersion: writer, choices: [] } : null };
  }
  const choices = pick.kind === 'ambiguous' ? pick.candidates.map(choiceOf) : [];
  return { session: null, notice: oldVersion || choices.length ? { oldVersion, choices } : null };
}

// Test seam: each test starts with no cached facts, versions or scans.
export function resetFallbackCaches(): void {
  factsCache.clear();
  versionCache.clear();
  scans.clear();
  headCache.clear();
}

// The repo a Claude session worked in when its folder is ~ or outside any repo: read from the file paths
// in its own tool calls, mapped to the repo's main checkout. Only the log's tail is read, cached per log.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseEntry, type ContentItem } from './transcript-entry';
import { projectRootOf } from './testing-project';
import { suiteHome } from './repo-suite-store';
import { cdTarget } from '../shared/testing';
import type { RepoEntry } from './repo-scan';

const TAIL_BYTES = 8 << 20; // recent work only; a long log's older days don't count
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const SEARCH_TOOLS = new Set(['Grep', 'Glob']);
const GIT_DIR = /\bgit\s+-C\s+(?:"([^"]+)"|'([^']+)'|(\S+))/g;

// One file path a tool call named: an edit changed it, a touch only read or ran there.
export interface PathTouch { dir: string; kind: 'edit' | 'touch'; at: number }

const textInput = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

// The folders a shell line names: each "cd <dir>" segment and each "git -C <dir>".
function shellDirs(command: string): string[] {
  const dirs = command.split(/&&|\|\||;|\n/).map((part) => cdTarget(part.trim())).filter((d): d is string => d !== null);
  for (const match of command.matchAll(GIT_DIR)) dirs.push(match[1] ?? match[2] ?? match[3]);
  return dirs;
}

// The paths one tool call names, with how it used them.
export function touchesOf(item: ContentItem, at: number): PathTouch[] {
  if (item.type !== 'tool_use' || !item.name || !item.input) return [];
  const input = item.input as ContentItem['input'] & { path?: unknown };
  if (EDIT_TOOLS.has(item.name)) {
    const file = textInput(input.file_path) ?? textInput(input.notebook_path);
    return file ? [{ dir: file, kind: 'edit', at }] : [];
  }
  if (item.name === 'Read') { const file = textInput(input.file_path); return file ? [{ dir: file, kind: 'touch', at }] : []; }
  if (SEARCH_TOOLS.has(item.name)) { const dir = textInput(input.path); return dir ? [{ dir, kind: 'touch', at }] : []; }
  if (item.name === 'Bash' && typeof input.command === 'string') return shellDirs(input.command).map((dir) => ({ dir, kind: 'touch', at }));
  return [];
}

export interface RepoScore { root: string; edits: number; touches: number; lastAt: number }

// Each repo's edits, touches and latest activity, keyed by its main checkout; paths outside any repo are dropped.
export function scoreRepos(touches: readonly PathTouch[], rootOf: (dir: string) => string | null): RepoScore[] {
  const scores = new Map<string, RepoScore>();
  for (const touch of touches) {
    const root = rootOf(touch.dir);
    if (!root) continue;
    const score = scores.get(root) ?? { root, edits: 0, touches: 0, lastAt: 0 };
    if (touch.kind === 'edit') score.edits += 1; else score.touches += 1;
    score.lastAt = Math.max(score.lastAt, touch.at);
    scores.set(root, score);
  }
  return [...scores.values()];
}

// Most edits, then most touches, then the most recent.
export const pickRepo = (scores: readonly RepoScore[]): string | null =>
  [...scores].sort((a, b) => b.edits - a.edits || b.touches - a.touches || b.lastAt - a.lastAt)[0]?.root ?? null;

// A path's repo as its main checkout, so a worktree's work counts for the repo Testing keeps one suite for.
const mainCheckoutOf = (dir: string): string | null => {
  const root = projectRootOf(dir === '~' || dir.startsWith('~/') ? path.join(os.homedir(), dir.slice(1)) : dir);
  return root ? suiteHome(root) : null;
};

async function readTail(file: string): Promise<string> {
  const handle = await fs.promises.open(file, 'r');
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - TAIL_BYTES);
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    const text = buffer.toString('utf8');
    return start > 0 ? text.slice(text.indexOf('\n') + 1) : text; // a cut first line is dropped
  } finally {
    await handle.close();
  }
}

// Only the conversation's own calls: a subagent's sidechain and untimed request copies are skipped.
function logTouches(text: string): PathTouch[] {
  const touches: PathTouch[] = [];
  for (const line of text.split('\n')) {
    if (!line.includes('"tool_use"')) continue;
    let entry;
    try { entry = parseEntry(line); } catch { continue; }
    const at = Date.parse(entry.timestamp ?? '');
    if (!at || entry.isSidechain || entry.type !== 'assistant' || !Array.isArray(entry.message?.content)) continue;
    for (const item of entry.message.content) touches.push(...touchesOf(item, at));
  }
  return touches;
}

const cache = new Map<string, { mtimeMs: number; size: number; root: string | null }>(); // by log file

// The repo a session's log worked in most, as its main checkout; null when it names no repo or can't be read.
export async function transcriptRepo(file: string): Promise<string | null> {
  let stat: fs.Stats;
  try { stat = await fs.promises.stat(file); } catch { return null; }
  const known = cache.get(file);
  if (known && known.mtimeMs === stat.mtimeMs && known.size === stat.size) return known.root;
  let root: string | null = null;
  try { root = pickRepo(scoreRepos(logTouches(await readTail(file)), mainCheckoutOf)); } catch { /* unreadable: no repo */ }
  cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, root });
  return root;
}

export const forgetTranscriptRepos = (): void => cache.clear();

// History's project name for a session, matched to a scanned repo by folder name; only when its log names none.
export function namedRepo(project: string | null | undefined, repos: readonly RepoEntry[]): string | null {
  const name = project?.trim().toLowerCase();
  const repo = name ? repos.find((r) => r.name.toLowerCase() === name) : undefined;
  const root = repo ? projectRootOf(repo.path) : null;
  return root ? suiteHome(root) : null;
}

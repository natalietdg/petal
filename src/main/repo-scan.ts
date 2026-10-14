// Finds git repos under a root folder. Read-only, never follows symlinks, and gives up after a time budget.
import fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import path from 'node:path';

export interface RepoEntry {
  name: string;
  path: string;
  shortPath: string; // "~/Code/petal"
  branch: string | null; // short sha when HEAD is detached
  modifiedMs: number; // newest of HEAD and index
}

export interface ScanResult {
  repos: RepoEntry[];
  durationMs: number;
  truncated: boolean; // the time budget ran out first
}

export interface ScanOptions {
  root: string;
  maxDepth?: number;
  timeBudgetMs?: number;
  concurrency?: number;
}

const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_TIME_BUDGET_MS = 5000;
const DEFAULT_CONCURRENCY = 16;
const SHORT_SHA_LENGTH = 7;

// Directly under the root: macOS-protected or never a code folder; reading them can raise privacy prompts.
// Desktop, Documents and Downloads each raise their own folder prompt; iCloud Drive sits under Library.
const SKIP_AT_ROOT = new Set(['Library', 'Applications', 'Pictures', 'Music', 'Movies', 'Desktop', 'Documents', 'Downloads']);
// At any depth; names starting with "." (.Trash, .cache, .npm, .nvm…) are skipped as well.
const SKIP_ANYWHERE = new Set(['node_modules']);
// Media-app libraries raise the Apple Music / media library prompt (kTCCServiceMediaLibrary) wherever they sit.
const SKIP_SUFFIXES = ['.photoslibrary', '.musiclibrary', '.tvlibrary', '.app'];

function isSkipped(name: string, depth: number): boolean {
  if (name.startsWith('.')) return true;
  if (depth === 1 && SKIP_AT_ROOT.has(name)) return true;
  return SKIP_ANYWHERE.has(name) || SKIP_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

export const shortPathFor = (root: string, dir: string): string => {
  const relative = path.relative(root, dir);
  return relative ? `~/${relative}` : '~';
};

// "ref: refs/heads/main" -> "main"; a bare sha (detached) -> its first 7 characters.
export function branchFromHead(head: string): string | null {
  const text = head.trim();
  const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(text);
  if (ref?.[1]) return ref[1];
  if (/^[0-9a-f]{40,64}$/i.test(text)) return text.slice(0, SHORT_SHA_LENGTH);
  return null;
}

// A worktree or submodule's .git file ("gitdir: <path>") -> the git dir it points at.
export function gitDirFromPointer(repoDir: string, dotGitFile: string): string | null {
  const pointer = /^gitdir:\s*(.+)$/m.exec(dotGitFile);
  return pointer?.[1] ? path.resolve(repoDir, pointer[1].trim()) : null;
}

async function gitDirOf(repoDir: string, dotGit: Dirent): Promise<string | null> {
  const dotGitPath = path.join(repoDir, '.git');
  if (dotGit.isDirectory()) return dotGitPath;
  return gitDirFromPointer(repoDir, await fs.readFile(dotGitPath, 'utf8'));
}

const mtimeOf = (file: string): Promise<number> => fs.stat(file).then((s) => s.mtimeMs, () => 0);

async function describeRepo(root: string, repoDir: string, dotGit: Dirent): Promise<RepoEntry> {
  const gitDir = await gitDirOf(repoDir, dotGit).catch(() => null);
  const head = gitDir ? await fs.readFile(path.join(gitDir, 'HEAD'), 'utf8').catch(() => '') : '';
  const modifiedMs = gitDir ? Math.max(await mtimeOf(path.join(gitDir, 'HEAD')), await mtimeOf(path.join(gitDir, 'index'))) : 0;
  return { name: path.basename(repoDir), path: repoDir, shortPath: shortPathFor(root, repoDir), branch: branchFromHead(head), modifiedMs };
}

// Breadth-first over the root with a few readdirs in flight; a repo's own folders are never entered.
export async function scanRepos({ root, maxDepth = DEFAULT_MAX_DEPTH, timeBudgetMs = DEFAULT_TIME_BUDGET_MS, concurrency = DEFAULT_CONCURRENCY }: ScanOptions): Promise<ScanResult> {
  const started = Date.now();
  const deadline = started + timeBudgetMs;
  const repos: RepoEntry[] = [];
  const queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];
  let inFlight = 0;
  let truncated = false;
  let stopped = false;

  async function visit(dir: string, depth: number): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [] as Dirent[]);
    const dotGit = depth > 0 ? entries.find((e) => e.name === '.git' && (e.isDirectory() || e.isFile())) : undefined;
    if (dotGit) {
      repos.push(await describeRepo(root, dir, dotGit));
      return;
    }
    if (depth >= maxDepth) return;
    // Dirent.isDirectory() is false for a symlink, so links are never followed.
    for (const entry of entries) {
      if (entry.isDirectory() && !isSkipped(entry.name, depth + 1)) queue.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
    }
  }

  const walked = new Promise<void>((resolve) => {
    const pump = (): void => {
      if (stopped) return;
      if (Date.now() >= deadline && queue.length) {
        truncated = true;
        queue.length = 0;
      }
      while (inFlight < concurrency && queue.length) {
        const next = queue.shift();
        if (!next) break;
        inFlight += 1;
        visit(next.dir, next.depth).catch(() => {}).finally(() => { inFlight -= 1; pump(); });
      }
      if (inFlight === 0 && !queue.length) resolve();
    };
    pump();
  });
  // A hung readdir (a sleeping network volume) can't hold the scan past its budget.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const outOfTime = new Promise<'late'>((resolve) => { timer = setTimeout(() => resolve('late'), timeBudgetMs); });
  if ((await Promise.race([walked, outOfTime])) === 'late') {
    truncated = true;
    stopped = true;
    queue.length = 0;
  }
  clearTimeout(timer);

  return { repos: [...repos].sort((a, b) => a.path.localeCompare(b.path)), durationMs: Date.now() - started, truncated };
}

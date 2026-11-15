// Factory jobs on disk and in git. Nothing lives in the repo (#601):
//   job state:  ~/.petal/repos/<repoKey>/factory/jobs/<job>/job.json, beside its hand-off files (spec.md, build.md, review-*.md, decision.md)
//   worktrees:  ~/.petal/worktrees/<repoKey>/<job>, on branch factory/<job>
//   ship mode:  ~/.petal/repos/<repoKey>/factory/ship.json
// Local-merge mode never pushes; PR mode pushes the job branch and never touches the main checkout.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { writeFileDurable } from './atomic-file';
import { petalDir, prepareRepoDir, repoDir } from './petal-home';
import { repoKey } from './petal-repos';
import type { Factory } from '../shared/factory';
import {
  HANDOFF_FILES, REVIEW_FILE, branchOf, defaultShipMode, firstLine, isJobState, mergeCheck, move, newJobId, titleOf,
  type CheckoutState, type Handoffs, type Job, type JobState, type MergeCheck, type ShipMode,
} from '../shared/factory-jobs';

const GIT_TIMEOUT_MS = 30_000;

export const jobsRoot = (repo: string): string => path.join(repoDir(repo), 'factory', 'jobs');
export const jobDir = (repo: string, id: string): string => path.join(jobsRoot(repo), id);
export const jobFile = (repo: string, id: string): string => path.join(jobDir(repo, id), 'job.json');
export const worktreesRoot = (repo: string): string => path.join(petalDir(), 'worktrees', repoKey(repo));
export const worktreeOf = (repo: string, id: string): string => path.join(worktreesRoot(repo), id);
const shipFile = (repo: string): string => path.join(repoDir(repo), 'factory', 'ship.json');

export function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: GIT_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
const tryGit = (cwd: string, args: readonly string[]): string | null => { try { return git(cwd, args); } catch { return null; } };

// ---- ship mode

export interface ShipSetting { mode: ShipMode; detected: ShipMode; saved: boolean; remote: string | null }

export function shipSetting(repo: string): ShipSetting {
  const remote = tryGit(repo, ['remote', 'get-url', 'origin']);
  const detected = defaultShipMode(remote);
  try {
    const raw = JSON.parse(fs.readFileSync(shipFile(repo), 'utf8')) as { mode?: unknown };
    if (raw.mode === 'local-merge' || raw.mode === 'pr') return { mode: raw.mode, detected, saved: true, remote };
  } catch { /* none saved: the detected mode */ }
  return { mode: detected, detected, saved: false, remote };
}

export function saveShipMode(repo: string, mode: ShipMode): ShipSetting {
  if (mode !== 'local-merge' && mode !== 'pr') throw new Error('Ship mode must be local-merge or pr.');
  const within = prepareRepoDir(repo);
  fs.mkdirSync(path.dirname(shipFile(repo)), { recursive: true });
  writeFileDurable(shipFile(repo), `${JSON.stringify({ mode }, null, 2)}\n`, undefined, { within });
  return shipSetting(repo);
}

// ---- job files

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

// A job.json as written; null when it isn't one (a half-written or foreign file is skipped, never repaired).
export function parseJob(text: string): Job | null {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  if (!isRecord(raw) || raw.version !== 1 || typeof raw.id !== 'string' || typeof raw.repo !== 'string' || !isJobState(raw.state)) return null;
  if (!/^[a-z0-9-]{1,80}$/.test(raw.id)) return null;
  return raw as unknown as Job;
}

export function readJob(repo: string, id: string): Job | null {
  try { return parseJob(fs.readFileSync(jobFile(repo, id), 'utf8')); } catch { return null; }
}

export function listJobs(repo: string): Job[] {
  let names: string[];
  try { names = fs.readdirSync(jobsRoot(repo)); } catch { return []; }
  return names.map((id) => readJob(repo, id)).filter((j): j is Job => j !== null).sort((a, b) => b.createdAt - a.createdAt);
}

export function writeJob(job: Job): Job {
  const within = prepareRepoDir(job.repo);
  fs.mkdirSync(jobDir(job.repo, job.id), { recursive: true });
  writeFileDurable(jobFile(job.repo, job.id), `${JSON.stringify(job, null, 2)}\n`, undefined, { within });
  return job;
}

// Each hand-off file's first line; review files by their name.
export function readHandoffs(repo: string, id: string): Handoffs {
  const dir = jobDir(repo, id);
  const out: Record<string, ReturnType<typeof firstLine>> = {};
  let names: string[];
  try { names = fs.readdirSync(dir); } catch { return out; }
  for (const name of names) {
    if (!(HANDOFF_FILES as readonly string[]).includes(name) && !REVIEW_FILE.test(name)) continue;
    try { out[name] = firstLine(fs.readFileSync(path.join(dir, name), 'utf8').slice(0, 2000)); } catch { /* gone mid-read */ }
  }
  return out;
}

// Newest change among the job's files, for stall detection.
export function lastProgress(repo: string, id: string): number {
  const dir = jobDir(repo, id);
  try {
    return Math.max(0, ...fs.readdirSync(dir).map((n) => fs.statSync(path.join(dir, n)).mtimeMs));
  } catch { return 0; }
}

// ---- git

export function mainBranchOf(repo: string): string {
  const head = tryGit(repo, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  if (head) return head.replace(/^origin\//, '');
  for (const name of ['main', 'master']) if (tryGit(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`])) return name;
  return 'main';
}

export function checkoutState(repo: string, branch: string): CheckoutState {
  return {
    branch: tryGit(repo, ['symbolic-ref', '--quiet', '--short', 'HEAD']),
    dirty: (tryGit(repo, ['status', '--porcelain']) ?? 'x') !== '',
    mainBranch: mainBranchOf(repo),
    jobBranchExists: tryGit(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]) !== null,
  };
}

// Files the job's branch changed against main.
export function changedFiles(job: Pick<Job, 'repo' | 'branch'>): string[] {
  const base = mainBranchOf(job.repo);
  const out = tryGit(job.repo, ['diff', '--name-only', `${base}...${job.branch}`]);
  return out ? out.split('\n').filter(Boolean) : [];
}

export function createWorktree(repo: string, id: string): string {
  const dir = worktreeOf(repo, id);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  git(repo, ['worktree', 'add', '-b', branchOf(id), dir, mainBranchOf(repo)]);
  return dir;
}

export function removeWorktree(job: Pick<Job, 'repo' | 'worktree' | 'branch'>, deleteBranch: boolean): void {
  if (fs.existsSync(job.worktree)) tryGit(job.repo, ['worktree', 'remove', '--force', job.worktree]);
  tryGit(job.repo, ['worktree', 'prune']);
  if (deleteBranch) tryGit(job.repo, ['branch', '-D', job.branch]);
}

// ---- lifecycle

export interface NewJob { repo: string; ask: string; factory: Factory; parentSessionId: string | null; now?: number }

// A queued job with the stations it starts with; no worktree yet (Build makes it).
export function createJob({ repo, ask, factory, parentSessionId, now = Date.now() }: NewJob): Job {
  const text = ask.trim();
  if (!text) throw new Error('Say what to build after /factory.');
  const id = newJobId(text, now, listJobs(repo).map((j) => j.id));
  return writeJob({
    version: 1, id, repo, ask: text, title: titleOf(text), state: 'queued', createdAt: now, updatedAt: now, progressAt: now,
    rework: 0, reworkCap: factory.reworkCap, askedQuestions: false,
    stations: factory.stations, reviewers: factory.reviewers, risky: factory.risky, riskyHits: [],
    shipMode: shipSetting(repo).mode, branch: branchOf(id), worktree: worktreeOf(repo, id),
    parentSessionId, childSessionIds: [], blocked: null, guidance: null, merge: null, prUrl: null,
    events: [],
  });
}

export function moveJob(repo: string, id: string, to: JobState, note?: string, now = Date.now()): Job {
  const job = readJob(repo, id);
  if (!job) throw new Error('That job is gone.');
  const moved = move(job, to, now, note);
  if (!moved.ok) throw new Error(moved.problem);
  return writeJob(moved.job);
}

// The merge step: local merge into a clean main checkout, or push the branch in PR mode. A precondition that
// doesn't hold leaves the job in merging with the reason in `blocked`; nothing is changed.
export function shipJob(repo: string, id: string, now = Date.now()): { job: Job; check: MergeCheck } {
  const job = readJob(repo, id);
  if (!job) throw new Error('That job is gone.');
  if (job.state !== 'merging') throw new Error('Only a job at Merge can ship.');
  const check = mergeCheck(job.shipMode, checkoutState(repo, job.branch), path.basename(repo));
  if (!check.ok) return { job: writeJob({ ...job, blocked: check.reason, updatedAt: now }), check };
  if (check.action === 'push') {
    git(job.worktree, ['push', '-u', 'origin', job.branch]);
    const done = move({ ...job, prUrl: prCreateUrl(tryGit(repo, ['remote', 'get-url', 'origin']), job.branch) }, 'done', now);
    if (!done.ok) throw new Error(done.problem);
    return { job: writeJob(done.job), check };
  }
  const base = git(repo, ['rev-parse', 'HEAD']);
  try {
    git(repo, ['merge', '--no-ff', '--no-edit', '-m', `Factory: ${job.title}`, job.branch]);
  } catch {
    tryGit(repo, ['merge', '--abort']);
    const reason = 'Conflicts with main · Take over to merge by hand';
    return { job: writeJob({ ...job, blocked: reason, updatedAt: now }), check: { ok: false, reason } };
  }
  const commit = git(repo, ['rev-parse', 'HEAD']);
  const done = move({ ...job, merge: { base, commit, at: now } }, 'done', now);
  if (!done.ok) throw new Error(done.problem);
  removeWorktree(job, false); // the branch stays so Undo merge and History can still name it
  return { job: writeJob(done.job), check };
}

// Undo merge: a revert commit on main, never a reset, and only into a clean main checkout.
export function undoMerge(repo: string, id: string, now = Date.now()): Job {
  const job = readJob(repo, id);
  if (!job?.merge || job.state !== 'done' || job.shipMode !== 'local-merge') throw new Error('Only a job Petal merged locally can be undone.');
  if (job.merge.undoneBy) throw new Error('This merge was already undone.');
  const check = mergeCheck('local-merge', checkoutState(repo, job.branch), path.basename(repo));
  if (!check.ok && !/branch is gone/.test(check.reason)) throw new Error(check.reason.replace('to merge', 'to undo the merge'));
  git(repo, ['revert', '-m', '1', '--no-edit', job.merge.commit]);
  return writeJob({ ...job, merge: { ...job.merge, undoneBy: git(repo, ['rev-parse', 'HEAD']) }, updatedAt: now, events: [...job.events, { at: now, from: 'done', to: 'done', note: 'merge undone' }] });
}

export function discardJob(repo: string, id: string, now = Date.now()): Job {
  const job = moveJob(repo, id, 'discarded', undefined, now);
  removeWorktree(job, true);
  return job;
}

// The page that opens a pull request for the pushed branch; null for hosts Petal doesn't know.
export function prCreateUrl(remote: string | null, branch: string): string | null {
  if (!remote) return null;
  const ado = /dev\.azure\.com[:/](?:v3\/)?([^/]+)\/([^/]+)\/(?:_git\/)?([^/]+?)(?:\.git)?$/.exec(remote) ?? /([^/.]+)\.visualstudio\.com\/([^/]+)\/_git\/([^/]+?)(?:\.git)?$/.exec(remote);
  if (ado) return `https://dev.azure.com/${ado[1]}/${ado[2]}/_git/${ado[3]}/pullrequestcreate?sourceRef=${encodeURIComponent(branch)}`;
  const gh = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(remote);
  if (gh) return `https://github.com/${gh[1]}/${gh[2]}/compare/${encodeURIComponent(branch)}?expand=1`;
  return null;
}

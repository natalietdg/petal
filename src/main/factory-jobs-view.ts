// Factory › Jobs from main: every repo's jobs with labels and spend, the Waiting lane's job rows, her buttons, and the
// job runner Petal starts when a button sends a job back to work (a headless claude in the job's worktree).
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { claudePath, cleanEnv } from './claude-cli';
import { allowedClaudeHome } from './claude-folder';
import { writeFileDurable } from './atomic-file';
import { prepareRepoDir, repoDir } from './petal-home';
import { isSnapshotRun } from './snapshot-mode';
import * as links from './subsession-links';
import {
  discardJob, git, jobDir, listJobs, readHandoffs, readJob, shipSetting, undoMerge, worktreeOf, writeJob, mainBranchOf,
} from './factory-jobs-store';
import { jobRepos, stepJob } from './factory-jobs-watch';
import { repoKey } from './petal-repos';
import { sumUsage, totalTokens } from '../shared/token-usage';
import { jobSessionId, type SessionSignals } from '../shared/needs-you';
import {
  REVIEW_FILE, isFinished, move, stateLabel, waitReason, type Job, type JobAction, type JobView, type JobsView, type RepoJobs,
} from '../shared/factory-jobs';

const SPEND_FILE_CAP = 64 * 1024 * 1024;
const spendCache = new Map<string, { key: string; tokens: number }>();

// Tokens the job's sessions spent: every transcript under ~/.claude/projects/<worktree key>/, subagents included.
export function jobSpend(worktree: string, claudeDir: string | null = allowedClaudeHome()): number | null {
  if (!claudeDir) return null;
  const dir = path.join(claudeDir, 'projects', repoKey(worktree));
  let files: string[];
  try { files = fs.readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith('.jsonl')); } catch { return 0; }
  let tokens = 0;
  for (const rel of files) {
    const file = path.join(dir, rel);
    try {
      const stat = fs.statSync(file);
      if (stat.size > SPEND_FILE_CAP) continue;
      const key = `${stat.size}:${stat.mtimeMs}`;
      const hit = spendCache.get(file);
      if (hit?.key === key) { tokens += hit.tokens; continue; }
      const entries = fs.readFileSync(file, 'utf8').split('\n').flatMap((line) => { try { return line ? [JSON.parse(line)] : []; } catch { return []; } });
      const n = totalTokens(sumUsage(entries));
      spendCache.set(file, { key, tokens: n });
      tokens += n;
    } catch { /* gone mid-read */ }
  }
  return tokens;
}

const seenFile = (repo: string): string => path.join(repoDir(repo), 'factory', 'seen.json');
export const firstRunSeen = (repo: string): boolean => fs.existsSync(seenFile(repo));
export function markSeen(repo: string): void {
  const within = prepareRepoDir(repo);
  fs.mkdirSync(path.dirname(seenFile(repo)), { recursive: true });
  writeFileDurable(seenFile(repo), `${JSON.stringify({ at: new Date().toISOString() })}\n`, undefined, { within });
}

export function jobView(job: Job): JobView {
  const handoffs = readHandoffs(job.repo, job.id);
  const verdicts = Object.entries(handoffs)
    .filter(([name, line]) => (REVIEW_FILE.test(name) || name === 'decision.md') && line)
    .map(([name, line]) => ({ name: name === 'decision.md' ? 'you' : REVIEW_FILE.exec(name)?.[1] ?? name, line: `${line?.kind === 'VERDICT' ? line.value : line?.value ?? ''}${line?.rest ? ` · ${line.rest}` : ''}` }));
  return {
    id: job.id, repo: job.repo, repoName: path.basename(job.repo), title: job.title, ask: job.ask, state: job.state, label: stateLabel(job),
    waitReason: waitReason(job, handoffs), since: job.events.at(-1)?.at ?? job.createdAt, rework: job.rework, reworkCap: job.reworkCap,
    shipMode: job.shipMode, riskyHits: job.riskyHits, verdicts, tokens: jobSpend(job.worktree), prUrl: job.prUrl,
    merged: Boolean(job.merge), undone: Boolean(job.merge?.undoneBy), parentSessionId: job.parentSessionId,
    stalledFrom: job.stalledFrom ?? null, updatedAt: job.updatedAt,
  };
}

function repoJobs(repo: string): RepoJobs {
  const ship = shipSetting(repo);
  return { repo, name: path.basename(repo), ship: { mode: ship.mode, detected: ship.detected, saved: ship.saved }, seen: firstRunSeen(repo), jobs: listJobs(repo).map(jobView) };
}

// The active tab's repo first (even with no jobs, for the first-run card), then every repo that has jobs.
export function jobsView(activeRepo: string | null): JobsView {
  const repos = [...new Set([...(activeRepo ? [activeRepo] : []), ...jobRepos()])];
  return { repos: repos.map(repoJobs), activeRepo };
}

// The lane's job rows: one per job waiting on her.
export function jobSignals(): SessionSignals[] {
  return jobRepos().flatMap((repo) => listJobs(repo).flatMap((job): SessionSignals[] => {
    if (isFinished(job.state)) return [];
    const reason = waitReason(job, readHandoffs(repo, job.id));
    if (!reason) return [];
    const since = job.events.at(-1)?.at ?? job.updatedAt;
    return [{ sessionId: jobSessionId(job.id), tabId: null, windowId: null, title: `${path.basename(repo)} · ${job.title}`, ask: null, askSince: null, decide: null, children: [], job: { id: job.id, repo, reason, since } }];
  }));
}

// ---- the runner

export const runnerStarts: { jobId: string; cwd: string; args: string[] }[] = []; // snapshot runs record instead of starting claude

function ensureWorktree(job: Job): void {
  if (fs.existsSync(job.worktree)) return;
  fs.mkdirSync(path.dirname(job.worktree), { recursive: true });
  const hasBranch = (() => { try { git(job.repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${job.branch}`]); return true; } catch { return false; } })();
  git(job.repo, hasBranch ? ['worktree', 'add', job.worktree, job.branch] : ['worktree', 'add', '-b', job.branch, job.worktree, mainBranchOf(job.repo)]);
}

// A headless claude in the job's worktree running "/factory run <job>", nested under the session that started the job.
export async function startRunner(job: Job): Promise<Job> {
  ensureWorktree(job);
  const sessionId = randomUUID();
  const args = ['-p', `Use the factory skill: /factory run ${job.id}`, '--permission-mode', 'acceptEdits', '--session-id', sessionId];
  if (isSnapshotRun()) runnerStarts.push({ jobId: job.id, cwd: job.worktree, args });
  else {
    const claude = await claudePath();
    if (!claude) throw new Error('Claude Code isn’t installed, so the job can’t restart. Install it, then press the button again.');
    const child = spawn(claude, args, { cwd: job.worktree, env: cleanEnv(claude), stdio: 'ignore', detached: true });
    child.on('error', (error) => console.warn(`[petal] factory runner for ${job.id}:`, error.message));
    child.unref();
  }
  if (job.parentSessionId) links.add([{ childId: sessionId, parentId: job.parentSessionId, cwd: job.worktree, name: job.title, at: Date.now() }]);
  return writeJob({ ...job, childSessionIds: [...job.childSessionIds, sessionId] });
}

// ---- her buttons

function writeHandoff(job: Job, name: string, text: string): void {
  writeFileDurable(path.join(jobDir(job.repo, job.id), name), text, undefined, { within: prepareRepoDir(job.repo) });
}

// The spec's first line becomes "STATUS: approved"; the rest stays hers.
function approveSpec(job: Job): void {
  const file = path.join(jobDir(job.repo, job.id), 'spec.md');
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const first = lines.findIndex((l) => l.trim());
  lines[first === -1 ? 0 : first] = 'STATUS: approved';
  writeHandoff(job, 'spec.md', lines.join('\n'));
}

const oneLine = (note: string | undefined): string => (note ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);

// Moves the job now, so a runner started next reads the new state, not the old one.
const settle = (job: Job): Job => stepJob(job.repo, job.id, listJobs(job.repo), Date.now()) ?? readJob(job.repo, job.id) ?? job;

export interface ActionResult { job: Job | null; takeOver?: string }

export async function jobAction(repo: string, id: string, action: JobAction, note?: string): Promise<ActionResult> {
  const job = readJob(repo, id);
  if (!job) throw new Error('That job is gone.');
  if (worktreeOf(repo, id) !== job.worktree) throw new Error('That job’s copy isn’t where Petal keeps it.');
  switch (action) {
    case 'approve': {
      if (job.state === 'spec') { approveSpec(job); const next = settle(job); return { job: next.state === 'building' ? await startRunner(next) : next }; }
      if (job.state !== 'approve' && job.state !== 'escalated') throw new Error('Nothing here waits for approval.');
      writeHandoff(job, 'decision.md', 'VERDICT: PASS\n');
      const next = settle(job);
      return { job: next.state === 'reviewing' ? await startRunner(next) : next };
    }
    case 'reject':
    case 'guidance': {
      if (job.state !== 'approve' && job.state !== 'escalated') throw new Error('This job isn’t waiting for you.');
      const text = oneLine(note);
      if (!text) throw new Error('Say what to change.');
      writeHandoff(job, 'decision.md', `VERDICT: FAIL · ${text}\n`);
      const next = settle(job);
      return { job: next.state === 'rework' ? await startRunner(next) : next };
    }
    case 'resume': {
      if (job.state !== 'stalled' || !job.stalledFrom) throw new Error('Only a stalled job can resume.');
      const moved = move(job, job.stalledFrom, Date.now(), 'Resumed');
      if (!moved.ok) throw new Error(moved.problem);
      const next = settle(writeJob(moved.job));
      return { job: ['building', 'rework', 'reviewing'].includes(next.state) ? await startRunner(next) : next };
    }
    case 'discard': return { job: discardJob(repo, id) };
    case 'undo-merge': return { job: undoMerge(repo, id) };
    case 'take-over': {
      ensureWorktree(job);
      return { job, takeOver: job.worktree };
    }
  }
}

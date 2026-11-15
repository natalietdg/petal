// Factory › Jobs from main: every repo's jobs with labels and spend, the Waiting lane's job rows, her buttons, and the
// job runner Petal starts when a button sends a job back to work (a headless claude in the job's worktree).
import { execFileSync, spawn } from 'node:child_process';
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
  changedFiles, discardJob, ensureWorktree, jobDir, listJobs, moveJob, readHandoffs, readJob, shipSetting, undoMerge, writeJob,
} from './factory-jobs-store';
import { jobRepos, stepJob } from './factory-jobs-watch';
import { repoKey } from './petal-repos';
import { sumUsage, totalTokens } from '../shared/token-usage';
import { jobSessionId, type SessionSignals } from '../shared/needs-you';
import {
  REVIEW_FILE, isFinished, move, needsRunner, startable, stateLabel, waitReason, type Job, type JobAction, type JobView, type JobsView, type RepoJobs,
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

const SPEC_SHOWN = 6000;
const readSpec = (job: Job): string | null => { try { return fs.readFileSync(path.join(jobDir(job.repo, job.id), 'spec.md'), 'utf8').slice(0, SPEC_SHOWN); } catch { return null; } };

export function jobView(job: Job, queuePlace = 0): JobView {
  const handoffs = readHandoffs(job.repo, job.id);
  const verdicts = Object.entries(handoffs)
    .filter(([name, line]) => (REVIEW_FILE.test(name) || name === 'decision.md') && line)
    .map(([name, line]) => ({ name: name === 'decision.md' ? 'you' : REVIEW_FILE.exec(name)?.[1] ?? name, line: `${line?.kind === 'VERDICT' ? line.value : line?.value ?? ''}${line?.rest ? ` · ${line.rest}` : ''}` }));
  return {
    id: job.id, repo: job.repo, repoName: path.basename(job.repo), title: job.title, ask: job.ask, state: job.state, label: stateLabel(job, queuePlace),
    waitReason: waitReason(job, handoffs), since: job.events.at(-1)?.at ?? job.createdAt, rework: job.rework, reworkCap: job.reworkCap,
    shipMode: job.shipMode, riskyHits: job.riskyHits, verdicts, tokens: jobSpend(job.worktree), prUrl: job.prUrl,
    merged: Boolean(job.merge), undone: Boolean(job.merge?.undoneBy), parentSessionId: job.parentSessionId,
    stalledFrom: job.stalledFrom ?? null, updatedAt: job.updatedAt, takenOver: Boolean(job.takenOver),
    spec: job.state === 'spec' || job.state === 'approve' ? readSpec(job) : null,
    changes: job.state === 'approve' ? changedFiles(job) : null,
  };
}

// 1 for the next queued job in its repo, 2 for the one after; 0 when not queued.
const queuePlaceOf = (job: Job, all: readonly Job[]): number =>
  job.state === 'queued' ? all.filter((j) => j.state === 'queued').sort((a, b) => a.createdAt - b.createdAt).findIndex((j) => j.id === job.id) + 1 : 0;

function repoJobs(repo: string): RepoJobs {
  const ship = shipSetting(repo);
  return { repo, name: path.basename(repo), ship: { mode: ship.mode, detected: ship.detected, saved: ship.saved }, seen: firstRunSeen(repo), jobs: listJobs(repo).map((job, _i, all) => jobView(job, queuePlaceOf(job, all))) };
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

const starting = new Set<string>(); // jobs whose runner is being started right now: a second call waits its turn
const runnerArg = (id: string): string => `Use the factory skill: /factory run ${id}`;

// A headless claude in the job's worktree running "/factory run <job>", nested under the session that started the job.
// runnerAt is written before anything waits, so the next tick or a button press can't start a second one.
export async function startRunner(job: Job): Promise<Job> {
  if (starting.has(job.id)) return job;
  starting.add(job.id);
  try {
    const sessionId = randomUUID();
    let current = writeJob({ ...job, runnerAt: job.events.length, childSessionIds: [...job.childSessionIds, sessionId] });
    ensureWorktree(current);
    const args = ['-p', runnerArg(job.id), '--permission-mode', 'acceptEdits', '--session-id', sessionId];
    let pid: number | null = null;
    if (!isSnapshotRun()) { // snapshot runs never start claude
      const claude = await claudePath();
      if (!claude) throw new Error('Claude Code isn’t installed, so the job can’t run. Install it, then press Resume.');
      const child = spawn(claude, args, { cwd: current.worktree, env: cleanEnv(claude), stdio: 'ignore', detached: true });
      child.on('error', (error) => console.warn(`[petal] factory runner for ${job.id}:`, error.message));
      child.unref();
      pid = child.pid ?? null;
    }
    if (job.parentSessionId) links.add([{ childId: sessionId, parentId: job.parentSessionId, cwd: current.worktree, name: job.title, at: Date.now() }]);
    current = readJob(job.repo, job.id) ?? current; // a move made while claude was being found is kept
    return writeJob({ ...current, runnerPid: pid });
  } finally {
    starting.delete(job.id);
  }
}

// The one place a runner starts: a job that just entered a stage that needs one, once per move.
export async function ensureRunner(job: Job): Promise<Job> {
  return needsRunner(job) ? startRunner(job) : job;
}

// Discard stops the job's runner, but only a process that is still that job's runner (a pid can be reused).
function stopRunner(job: Job): void {
  if (!job.runnerPid) return;
  try {
    const command = execFileSync('ps', ['-o', 'command=', '-p', String(job.runnerPid)], { encoding: 'utf8' });
    if (command.includes(`/factory run ${job.id}`)) process.kill(-job.runnerPid, 'SIGTERM'); // its whole group: claude and its tools
  } catch { /* already gone */ }
}

// The runner's newest transcript write, so a long build that only talks to Claude never looks stalled.
export function runnerProgress(job: Job, claudeDir: string | null = allowedClaudeHome()): number {
  if (!claudeDir) return 0;
  const dir = path.join(claudeDir, 'projects', repoKey(job.worktree));
  try { return Math.max(0, ...fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => fs.statSync(path.join(dir, f)).mtimeMs)); } catch { return 0; }
}

// Every tick: queued jobs whose spec is ready start as slots free, oldest first; then every job owed a runner gets one.
export async function ensureRunners(): Promise<Job[]> {
  const started: Job[] = [];
  for (const repo of jobRepos()) {
    for (const job of startable(listJobs(repo))) {
      const spec = readHandoffs(repo, job.id)['spec.md'];
      if (spec?.kind !== 'STATUS' || !['ready', 'approved'].includes(spec.value)) continue; // Intake isn't done: /factory next runs it
      moveJob(repo, job.id, 'building', 'A slot freed');
    }
    for (const job of listJobs(repo)) {
      if (!needsRunner(job)) continue;
      try { started.push(await startRunner(job)); } catch (error) { console.warn(`[petal] factory runner for ${job.id}:`, (error as Error).message); }
    }
  }
  return started;
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
const settle = (job: Job): Job => stepJob(job.repo, job.id, Date.now(), runnerProgress) ?? readJob(job.repo, job.id) ?? job;

export interface ActionResult { job: Job | null; takeOver?: string }

export async function jobAction(repo: string, id: string, action: JobAction, note?: string): Promise<ActionResult> {
  const job = readJob(repo, id);
  if (!job) throw new Error('That job is gone.');
  // readJob already refused a job filed anywhere but its own repo, branch and copy.
  switch (action) {
    case 'approve': {
      if (job.state === 'spec') { approveSpec(job); return { job: await ensureRunner(settle(job)) }; }
      if (job.state !== 'approve' && !(job.state === 'escalated' && job.takenOver)) throw new Error('Nothing here waits for approval.');
      writeHandoff(job, 'decision.md', 'VERDICT: PASS\n');
      return { job: await ensureRunner(settle(job)) };
    }
    case 'reject':
    case 'guidance': {
      if (job.state !== 'approve' && job.state !== 'escalated') throw new Error('This job isn’t waiting for you.');
      const text = oneLine(note);
      if (!text) throw new Error('Say what to change.');
      writeHandoff(job, 'decision.md', `VERDICT: FAIL · ${text}\n`);
      return { job: await ensureRunner(settle(job)) };
    }
    case 'resume': {
      if (job.state !== 'stalled' || !job.stalledFrom) throw new Error('Only a stalled job can resume.');
      const moved = move(job, job.stalledFrom, Date.now(), 'Resumed');
      if (!moved.ok) throw new Error(moved.problem);
      // The runner starts first, then the job catches up with its files; the runner picks up whatever stage that is.
      return { job: settle(await ensureRunner(writeJob(moved.job))) };
    }
    case 'discard': stopRunner(job); return { job: discardJob(repo, id) };
    case 'undo-merge': return { job: undoMerge(repo, id) };
    case 'take-over': {
      ensureWorktree(job);
      return { job: writeJob({ ...job, takenOver: true }), takeOver: job.worktree };
    }
  }
}

// Petal's half of a factory job: it reads the hand-off files Claude writes and moves job.json along. No tokens: Claude
// writes request.md, spec.md, build.md, review-*.md and decision.md; only Petal writes job.json, merges and pushes.
import fs from 'node:fs';
import path from 'node:path';
import { reposRoot } from './petal-home';
import { repoKey } from './petal-repos';
import {
  archiveRound, changedFiles, createJob, jobDir, lastProgress, listJobs, readHandoffs, readJob, shipJob, writeJob,
} from './factory-jobs-store';
import { defaultFactory, type Factory } from '../shared/factory';
import { hasFreeSlot, isFinished, isStalled, move, parseRequest, reconcile, type Job } from '../shared/factory-jobs';

const MAX_STEPS = 8; // a job several files ahead catches up in one pass
const SHIP_RETRY_MS = 10_000; // a blocked merge (dirty main) is retried this often

export interface WatchDeps {
  factoryFor: (repo: string) => Factory | null; // the factory a new job starts with
  now?: () => number;
}

// Every repo folder in Petal that has factory jobs, as the checkout path its jobs name.
export function jobRepos(): string[] {
  let keys: string[];
  try { keys = fs.readdirSync(reposRoot()); } catch { return []; }
  const repos = new Set<string>();
  for (const key of keys) {
    const root = path.join(reposRoot(), key, 'factory', 'jobs');
    let ids: string[];
    try { ids = fs.readdirSync(root); } catch { continue; }
    for (const id of ids) {
      const repo = repoOfFolder(path.join(root, id));
      if (repo && repoKey(repo) === key) { repos.add(repo); break; }
    }
  }
  return [...repos];
}

function repoOfFolder(dir: string): string | null {
  try {
    const job = JSON.parse(fs.readFileSync(path.join(dir, 'job.json'), 'utf8')) as { repo?: unknown };
    if (typeof job.repo === 'string') return job.repo;
  } catch { /* not yet a job */ }
  try { return parseRequest(fs.readFileSync(path.join(dir, 'request.md'), 'utf8'))?.repo ?? null; } catch { return null; }
}

// A folder Claude made with request.md becomes a job. Its repo must be the one the folder is filed under, so a
// request can't point Petal at another checkout.
export function adoptRequests(deps: WatchDeps): Job[] {
  const made: Job[] = [];
  let keys: string[];
  try { keys = fs.readdirSync(reposRoot()); } catch { return made; }
  for (const key of keys) {
    const root = path.join(reposRoot(), key, 'factory', 'jobs');
    let ids: string[];
    try { ids = fs.readdirSync(root); } catch { continue; }
    for (const id of ids) {
      const dir = path.join(root, id);
      if (!/^[a-z0-9-]{1,80}$/.test(id) || fs.existsSync(path.join(dir, 'job.json'))) continue;
      let request;
      try { request = parseRequest(fs.readFileSync(path.join(dir, 'request.md'), 'utf8')); } catch { continue; }
      if (!request || repoKey(request.repo) !== key || !fs.existsSync(path.join(request.repo, '.git'))) continue;
      const factory = deps.factoryFor(request.repo) ?? defaultFactory();
      made.push(createJob({ repo: request.repo, ask: request.ask, factory, parentSessionId: request.sessionId, id, now: (deps.now ?? Date.now)() }));
    }
  }
  return made;
}

const lastShipTry = new Map<string, number>();

// One pass over one job: follow its files, merge when it reaches Merge, stall it when silent. Returns it when it changed.
export function stepJob(repo: string, id: string, all: readonly Job[], now: number): Job | null {
  let job = readJob(repo, id);
  if (!job || isFinished(job.state)) return null;
  const start = JSON.stringify(job);
  for (let i = 0; i < MAX_STEPS; i++) {
    const needsDiff = job.state === 'reviewing';
    const step = reconcile(job, readHandoffs(repo, id), { changed: needsDiff ? changedFiles(job) : [], freeSlot: hasFreeSlot(all.filter((j) => j.id !== id), repo) });
    if (!step) break;
    if (step.archive?.length) archiveRound(repo, id, step.archive, job.rework + 1);
    const moved = move({ ...job, ...step.patch }, step.to, now, step.note);
    if (!moved.ok) break;
    job = writeJob(moved.job);
  }
  if (job.state === 'merging' && now - (lastShipTry.get(job.id) ?? 0) >= SHIP_RETRY_MS) {
    lastShipTry.set(job.id, now);
    try {
      job = shipJob(repo, id, now).job;
    } catch (error) {
      job = writeJob({ ...job, blocked: `Couldn’t ship: ${(error as Error).message.split('\n')[0]}`, updatedAt: now });
    }
  }
  const progressed = { ...job, progressAt: Math.max(job.progressAt, lastProgress(repo, id)) };
  if (isStalled(progressed, now)) {
    const stalled = move(progressed, 'stalled', now, 'No progress for 10 min');
    if (stalled.ok) job = writeJob(stalled.job);
  }
  return JSON.stringify(job) === start ? null : job;
}

// Adopt new requests, then step every unfinished job. The jobs that changed come back so the caller can tell the windows.
export function tick(deps: WatchDeps): Job[] {
  const now = (deps.now ?? Date.now)();
  const changed: Job[] = [...adoptRequests(deps)];
  for (const repo of jobRepos()) {
    const all = listJobs(repo);
    for (const job of all) {
      if (isFinished(job.state)) continue;
      try {
        const after = stepJob(repo, job.id, all, now);
        if (after) changed.push(after);
      } catch (error) {
        console.warn(`[petal] factory job ${job.id} in ${jobDir(repo, job.id)}:`, (error as Error).message);
      }
    }
  }
  return changed;
}

// Factory jobs: one ask moving along the spine on its own branch and copy. The state machine, the rework cap, risky-path
// detection, merge preconditions, the two-running-per-repo queue and the hand-off file first lines. Pure: main/factory-jobs-store.ts
// keeps job.json and runs git, the renderer draws Factory › Jobs.
import type { Reviewer, RiskRule, Station } from './factory';

export const JOB_STATES = ['queued', 'intake', 'spec', 'building', 'reviewing', 'rework', 'escalated', 'approve', 'merging', 'done', 'stalled', 'discarded'] as const;
export type JobState = (typeof JOB_STATES)[number];
export const isJobState = (value: unknown): value is JobState => JOB_STATES.some((s) => s === value);

export type ShipMode = 'local-merge' | 'pr';
export const MAX_RUNNING_PER_REPO = 2;
export const STALL_MS = 10 * 60 * 1000;

// Using a subagent's tokens right now; these count against the per-repo limit.
const RUNNING: readonly JobState[] = ['building', 'reviewing', 'rework'];
// Waiting on her: the Waiting lane shows these.
const WAITING: readonly JobState[] = ['escalated', 'approve'];
const FINISHED: readonly JobState[] = ['done', 'discarded'];
// Something should be writing a file; silence here for STALL_MS is a stall.
const PROGRESSING: readonly JobState[] = ['intake', 'building', 'reviewing', 'rework', 'merging'];

export const isRunning = (state: JobState): boolean => RUNNING.includes(state);
export const isWaiting = (state: JobState): boolean => WAITING.includes(state);
export const isFinished = (state: JobState): boolean => FINISHED.includes(state);

// Every move a job may make. Any unfinished state may also stall or be discarded.
const NEXT: Record<JobState, readonly JobState[]> = {
  queued: ['intake', 'building'], // building: /factory next started it, its spec already done
  intake: ['spec', 'building', 'queued'], // queued: intake done but two jobs already run in this repo
  spec: ['building', 'queued'],
  building: ['reviewing', 'escalated'],
  reviewing: ['rework', 'escalated', 'approve', 'merging'],
  rework: ['reviewing', 'escalated'],
  escalated: ['rework', 'reviewing'], // Give guidance, or Resume after she took over
  approve: ['merging', 'rework'], // Approve, or reject with a note
  merging: ['done'],
  done: [],
  stalled: [], // resumes to the state it stalled in, checked in canMove
  discarded: [],
};

export interface JobEvent { at: number; from: JobState; to: JobState; note?: string }
export interface RiskHit { file: string; label: string }
export interface MergeRecord { base: string; commit: string; at: number; undoneBy?: string }

export interface Job {
  version: 1;
  id: string;
  repo: string; // the main checkout
  ask: string;
  title: string;
  state: JobState;
  stalledFrom?: JobState;
  createdAt: number;
  updatedAt: number;
  progressAt: number; // last hand-off file change
  rework: number;
  reworkCap: number;
  askedQuestions: boolean; // intake asked her something, so the spec waits for her
  stations: Station[]; // the stations it started with, kept for its whole run
  reviewers: Reviewer[];
  risky: RiskRule[];
  riskyHits: RiskHit[];
  shipMode: ShipMode;
  branch: string;
  worktree: string;
  parentSessionId: string | null;
  childSessionIds: string[];
  blocked: string | null; // why Merge is waiting, in her words
  guidance: string | null;
  merge: MergeRecord | null;
  prUrl: string | null;
  events: JobEvent[];
}

export type Moved = { ok: true; job: Job } | { ok: false; problem: string };

export function canMove(job: Pick<Job, 'state' | 'stalledFrom'>, to: JobState): boolean {
  if (to === 'discarded') return !isFinished(job.state);
  if (to === 'stalled') return PROGRESSING.includes(job.state);
  if (job.state === 'stalled') return to === job.stalledFrom;
  return NEXT[job.state].includes(to);
}

// A new job, with the moment it moves; the caller writes it.
export function move(job: Job, to: JobState, now: number, note?: string): Moved {
  if (!canMove(job, to)) return { ok: false, problem: `A job can’t go from ${job.state} to ${to}.` };
  if (to === 'rework' && job.rework >= job.reworkCap && job.state !== 'escalated' && job.state !== 'approve') {
    return { ok: false, problem: `This job already had ${job.reworkCap} reworks; it goes to you instead.` };
  }
  const next: Job = {
    ...job,
    state: to,
    updatedAt: now,
    progressAt: to === 'stalled' ? job.progressAt : now,
    rework: to === 'rework' ? job.rework + 1 : job.rework,
    blocked: to === 'merging' ? job.blocked : null,
    events: [...job.events, { at: now, from: job.state, to, ...(note ? { note } : {}) }],
  };
  if (to === 'stalled') next.stalledFrom = job.state;
  else delete next.stalledFrom;
  if (note && (to === 'rework' || to === 'reviewing')) next.guidance = note;
  return { ok: true, job: next };
}

// ---- hand-off files

export type FirstLine = { kind: 'VERDICT'; value: 'PASS' | 'FAIL'; rest: string } | { kind: 'STATUS'; value: string; rest: string };

// "VERDICT: PASS" or "STATUS: done · tests pass": the first non-empty line of a hand-off file, or null.
export function firstLine(text: string): FirstLine | null {
  const line = text.replace(/^\uFEFF/, '').split(/\r?\n/).find((l) => l.trim()) ?? '';
  const match = /^\s*\**\s*(VERDICT|STATUS)\s*\**\s*:\s*\**\s*([A-Za-z-]+)\**\s*[·:\-–]?\s*(.*)$/i.exec(line);
  if (!match) return null;
  const kind = match[1].toUpperCase() as 'VERDICT' | 'STATUS';
  const value = match[2].toUpperCase();
  const rest = match[3].trim();
  if (kind === 'VERDICT') return value === 'PASS' || value === 'FAIL' ? { kind, value, rest } : null;
  return { kind, value: value.toLowerCase(), rest };
}

export const REVIEW_FILE = /^review-([a-z0-9-]+)\.md$/;
export const reviewFile = (name: string): string => `review-${name}.md`;
export const HANDOFF_FILES = ['request.md', 'spec.md', 'build.md', 'decision.md'] as const;

// The files in a job's folder, name → first line (null when the file has none Petal can read).
export type Handoffs = Readonly<Record<string, FirstLine | null>>;

// The reviewers this job runs: the always ones, and the visual ones only when the diff touches how something looks.
export function reviewersFor(reviewers: readonly Reviewer[], files: readonly string[]): Reviewer[] {
  const visual = files.some(isVisualFile);
  return reviewers.filter((r) => r.when === 'always' || visual);
}

export interface ReviewOutcome { to: JobState; failed: string[]; hits: RiskHit[]; reason: string }

// What happens after every reviewer wrote its verdict. null while any is missing.
export function afterReview(job: Pick<Job, 'rework' | 'reworkCap' | 'risky'>, verdicts: Readonly<Record<string, FirstLine | null>>, expected: readonly string[], files: readonly string[]): ReviewOutcome | null {
  if (expected.some((name) => verdicts[name]?.kind !== 'VERDICT')) return null;
  const failed = expected.filter((name) => verdicts[name]?.value === 'FAIL');
  if (failed.length) {
    return job.rework < job.reworkCap
      ? { to: 'rework', failed, hits: [], reason: `Rework ${job.rework + 1}/${job.reworkCap}: ${failed.join(', ')} asked for changes` }
      : { to: 'escalated', failed, hits: [], reason: `Stuck after ${job.reworkCap} tries` };
  }
  const hits = riskyHits(files, job.risky);
  return hits.length ? { to: 'approve', failed, hits, reason: `Touches ${hits[0].label} (${hits[0].file})` } : { to: 'merging', failed, hits, reason: 'Low risk, merging' };
}

// Where Resume restarts: the furthest stage whose file carries a verdict or status.
export function resumeState(handoffs: Handoffs, expectedReviewers: readonly string[]): JobState {
  if (handoffs['decision.md']?.kind === 'VERDICT') return handoffs['decision.md'].value === 'PASS' ? 'merging' : 'rework';
  const reviews = expectedReviewers.map((name) => handoffs[reviewFile(name)]);
  if (reviews.length && reviews.every((r) => r?.kind === 'VERDICT')) return 'reviewing'; // afterReview decides from here
  if (handoffs['build.md']?.kind === 'STATUS' && handoffs['build.md'].value === 'done') return 'reviewing';
  if ('spec.md' in handoffs) return 'building';
  return 'intake';
}

// ---- risky paths and visual files

// A small glob: ** any depth, * within one folder, ? one character; case-insensitive; a pattern without "/" matches the file name.
export function globToRegExp(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      i++;
      if (glob[i + 1] === '/') { i++; out += '(?:.*/)?'; } else out += '.*';
    } else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`, 'i');
}

const matches = (file: string, pattern: string): boolean => {
  const clean = file.replace(/\\/g, '/').replace(/^\.\//, '');
  return globToRegExp(pattern).test(pattern.includes('/') ? clean : clean.split('/').pop() ?? clean);
};

// Each changed file that hits a risky rule, once, with the first rule it hit.
export function riskyHits(files: readonly string[], rules: readonly RiskRule[]): RiskHit[] {
  return files.flatMap((file) => {
    const rule = rules.find((r) => r.patterns.some((p) => matches(file, p)));
    return rule ? [{ file, label: rule.label }] : [];
  });
}

const VISUAL = ['**/*.css', '**/*.scss', '**/*.less', '**/*.svg', '**/*.html', '**/*.tsx', '**/*.jsx', '**/*.vue', '**/*.svelte', '**/renderer/**', '**/components/**', '**/*theme*', '**/icons/**', '**/*layout*'];
export const isVisualFile = (file: string): boolean => VISUAL.some((p) => matches(file, p));

// ---- merge

export interface CheckoutState {
  branch: string | null; // what the main checkout has checked out; null when detached
  dirty: boolean; // uncommitted changes, untracked included
  mainBranch: string;
  jobBranchExists: boolean;
}

export type MergeCheck = { ok: true; action: 'merge' | 'push' } | { ok: false; reason: string };

// Local merge only into a clean checkout sitting on main; PR mode never touches the main checkout.
export function mergeCheck(mode: ShipMode, checkout: CheckoutState, repoName: string): MergeCheck {
  if (!checkout.jobBranchExists) return { ok: false, reason: 'The job’s branch is gone. Discard the job.' };
  if (mode === 'pr') return { ok: true, action: 'push' };
  if (checkout.branch !== checkout.mainBranch) return { ok: false, reason: `Switch ${repoName} to ${checkout.mainBranch} to merge` };
  if (checkout.dirty) return { ok: false, reason: `Commit or stash in ${repoName} to merge` };
  return { ok: true, action: 'merge' };
}

// ---- the queue

// Jobs that may start their next step now: queued ones in age order, while fewer than two run in their repo.
export function startable(jobs: readonly Job[], max = MAX_RUNNING_PER_REPO): Job[] {
  const running = new Map<string, number>();
  for (const job of jobs) if (isRunning(job.state)) running.set(job.repo, (running.get(job.repo) ?? 0) + 1);
  const out: Job[] = [];
  for (const job of [...jobs].filter((j) => j.state === 'queued').sort((a, b) => a.createdAt - b.createdAt)) {
    const n = running.get(job.repo) ?? 0;
    if (n >= max) continue;
    running.set(job.repo, n + 1);
    out.push(job);
  }
  return out;
}

export const hasFreeSlot = (jobs: readonly Job[], repo: string, max = MAX_RUNNING_PER_REPO): boolean =>
  jobs.filter((j) => j.repo === repo && isRunning(j.state)).length < max;

// Silent too long in a state where something should be writing files.
export const isStalled = (job: Pick<Job, 'state' | 'progressAt'>, now: number): boolean => PROGRESSING.includes(job.state) && now - job.progressAt > STALL_MS;

// ---- ship mode and ids

// Work repos (Azure DevOps, or a Paywatch org anywhere) stop at a PR; everything else merges locally.
export function defaultShipMode(remoteUrl: string | null): ShipMode {
  if (!remoteUrl) return 'local-merge';
  const url = remoteUrl.toLowerCase();
  if (/dev\.azure\.com|visualstudio\.com|ssh\.dev\.azure\.com/.test(url)) return 'pr';
  if (/[/:]paywatch[a-z0-9-]*\//.test(url)) return 'pr';
  return 'local-merge';
}

export function newJobId(ask: string, now: number, taken: readonly string[]): string {
  const d = new Date(now);
  const day = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const slug = ask.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 28).replace(/-$/, '') || 'job';
  let id = `${day}-${slug}`;
  for (let n = 2; taken.includes(id); n++) id = `${day}-${slug}-${n}`;
  return id;
}

export const branchOf = (id: string): string => `factory/${id}`;
export const titleOf = (ask: string): string => {
  const line = ask.trim().split(/\r?\n/)[0] ?? '';
  return line.length > 72 ? `${line.slice(0, 71).trimEnd()}…` : line;
};

// The words on a job's row and card for each state.
export function stateLabel(job: Pick<Job, 'state' | 'rework' | 'reworkCap' | 'stalledFrom' | 'shipMode' | 'blocked' | 'merge'>): string {
  switch (job.state) {
    case 'queued': return 'Queued';
    case 'intake': return 'Intake';
    case 'spec': return 'Spec ready for you';
    case 'building': return 'Building';
    case 'reviewing': return 'Reviewing';
    case 'rework': return `Rework ${job.rework}/${job.reworkCap}`;
    case 'escalated': return `Stuck after ${job.reworkCap} tries`;
    case 'approve': return 'Approve merge';
    case 'merging': return job.blocked ?? (job.shipMode === 'pr' ? 'Pushing branch' : 'Merging');
    case 'done': return job.shipMode === 'pr' ? 'Branch pushed · open a pull request' : job.merge?.undoneBy ? 'Merge undone' : 'Merged locally · not pushed';
    case 'stalled': return `No progress for 10 min · Resume from ${job.stalledFrom ?? 'the last step'}`;
    case 'discarded': return 'Discarded';
  }
}

// ---- the files drive the job

// request.md, written by Claude on /factory: "STATUS: intake" (or "queued" for later), then "Repo: <path>", "Session: <id>", a blank line, the ask.
export interface Request { status: string; repo: string; sessionId: string | null; ask: string }

export function parseRequest(text: string): Request | null {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const head = firstLine(text);
  if (head?.kind !== 'STATUS') return null;
  const field = (name: string): string | null => lines.find((l) => l.toLowerCase().startsWith(`${name.toLowerCase()}:`))?.slice(name.length + 1).trim() || null;
  const repo = field('Repo');
  if (!repo || !repo.startsWith('/')) return null;
  const blank = lines.findIndex((l, i) => i > 0 && !l.trim());
  const ask = blank === -1 ? '' : lines.slice(blank + 1).join('\n').trim();
  return ask ? { status: head.value, repo, sessionId: field('Session'), ask } : null;
}

// One move Petal makes after reading the job's files. archive: the files that go into round-<n>/ first, so the next
// round starts clean.
export interface Step { to: JobState; note?: string; archive?: readonly string[]; patch?: Partial<Pick<Job, 'riskyHits' | 'askedQuestions'>> }

export interface ReconcileContext {
  changed: readonly string[]; // files the job's branch changed against main
  freeSlot: boolean; // fewer than two jobs run in its repo
}

const reviewNames = (h: Handoffs): string[] => Object.keys(h).filter((n) => REVIEW_FILE.test(n));

// The next state the files call for, or null when they call for nothing new. Petal applies one step per call and
// calls again, so a job that is several files ahead catches up in one pass.
export function reconcile(job: Job, h: Handoffs, ctx: ReconcileContext): Step | null {
  const spec = h['spec.md'];
  const build = h['build.md'];
  const decision = h['decision.md'];
  const status = (f: FirstLine | null | undefined): string | null => (f?.kind === 'STATUS' ? f.value : null);
  const verdict = (f: FirstLine | null | undefined): 'PASS' | 'FAIL' | null => (f?.kind === 'VERDICT' ? f.value : null);
  const startBuild = (): Step => (ctx.freeSlot ? { to: 'building' } : { to: 'queued', note: 'Two jobs already run in this repo' });
  switch (job.state) {
    case 'queued':
      if (status(build)) return { to: 'building' };
      if (!spec && status(h['request.md']) === 'intake') return { to: 'intake' };
      return null;
    case 'intake':
      if (status(spec) === 'confirm') return { to: 'spec', patch: { askedQuestions: true } };
      if (status(spec) === 'ready' || status(spec) === 'approved') return startBuild();
      return null;
    case 'spec':
      return status(spec) === 'approved' ? startBuild() : null;
    case 'building':
    case 'rework':
      if (status(build) === 'done') return { to: 'reviewing' };
      if (status(build) === 'blocked') return { to: 'escalated', note: (build as FirstLine).rest || 'The build is blocked' };
      return null;
    case 'reviewing': {
      const expected = reviewersFor(job.reviewers, ctx.changed).map((r) => r.name);
      const verdicts = Object.fromEntries(expected.map((name) => [name, h[reviewFile(name)] ?? null]));
      const out = afterReview(job, verdicts, expected, ctx.changed);
      if (!out) return null;
      const archive = out.to === 'rework' ? ['build.md', ...reviewNames(h)] : undefined;
      return { to: out.to, note: out.reason, ...(archive ? { archive } : {}), patch: { riskyHits: out.hits } };
    }
    case 'approve':
      if (verdict(decision) === 'PASS') return { to: 'merging', note: 'Approved' };
      if (verdict(decision) === 'FAIL') return { to: 'rework', note: (decision as FirstLine).rest || 'Sent back', archive: ['build.md', 'decision.md', ...reviewNames(h)] };
      return null;
    case 'escalated':
      if (verdict(decision) === 'FAIL') return { to: 'rework', note: (decision as FirstLine).rest || 'Guidance given', archive: ['build.md', 'decision.md', ...reviewNames(h)] };
      if (verdict(decision) === 'PASS') return { to: 'reviewing', note: 'Taken over, reviewing again', archive: ['decision.md', ...reviewNames(h)] };
      return null;
    default:
      return null;
  }
}

// ---- what the surfaces show

// Why a job waits on her, as the Waiting lane row reads; null when it doesn't wait on her.
export function waitReason(job: Pick<Job, 'state' | 'reworkCap' | 'riskyHits' | 'blocked' | 'events'>, handoffs: Handoffs): string | null {
  switch (job.state) {
    case 'escalated': {
      const failed = Object.entries(handoffs).find(([n, f]) => REVIEW_FILE.test(n) && f?.kind === 'VERDICT' && f.value === 'FAIL');
      const last = job.events.at(-1)?.note;
      const detail = failed ? `${REVIEW_FILE.exec(failed[0])?.[1]}: ${failed[1]?.rest || 'asked for changes'}` : last && !last.startsWith('Stuck') ? last : null;
      return `Stuck after ${job.reworkCap} tries${detail ? ` · ${detail}` : ''}`;
    }
    case 'approve': {
      const hit = job.riskyHits[0];
      return hit ? `Approve merge · touches ${hit.label} (${hit.file})` : 'Approve merge';
    }
    case 'spec': return 'Check the spec before it builds';
    case 'merging': return job.blocked;
    default: return null;
  }
}

// The parent card's roll-up: "2 jobs · 1 waiting". Finished jobs don't count.
export function jobsBadge(jobs: readonly { state: JobState; waitReason: string | null }[]): string {
  const open = jobs.filter((j) => !isFinished(j.state));
  if (!open.length) return '';
  const waiting = open.filter((j) => j.waitReason !== null).length;
  const stalled = open.filter((j) => j.state === 'stalled').length;
  return [`${open.length} job${open.length === 1 ? '' : 's'}`, waiting ? `${waiting} waiting` : '', stalled ? `${stalled} stalled` : ''].filter(Boolean).join(' · ');
}

// One job as Factory › Jobs, the Board and the lane see it.
export interface JobView {
  id: string;
  repo: string;
  repoName: string;
  title: string;
  ask: string;
  state: JobState;
  label: string;
  waitReason: string | null;
  since: number; // when it entered its state
  rework: number;
  reworkCap: number;
  shipMode: ShipMode;
  riskyHits: RiskHit[];
  verdicts: { name: string; line: string }[]; // review-*.md and decision.md first lines, this round
  tokens: number | null; // spend from the job's transcripts; null when the Claude folder is off
  prUrl: string | null;
  merged: boolean;
  undone: boolean;
  parentSessionId: string | null;
  stalledFrom: JobState | null;
  updatedAt: number;
}

export interface RepoJobs {
  repo: string;
  name: string;
  ship: { mode: ShipMode; detected: ShipMode; saved: boolean };
  seen: boolean; // the first-run card was dismissed
  jobs: JobView[];
}

export interface JobsView { repos: RepoJobs[]; activeRepo: string | null }

export type JobAction = 'approve' | 'reject' | 'guidance' | 'resume' | 'discard' | 'undo-merge' | 'take-over';
export const JOB_ACTIONS: readonly JobAction[] = ['approve', 'reject', 'guidance', 'resume', 'discard', 'undo-merge', 'take-over'];

// The buttons a job's row offers in its state.
export function actionsFor(job: Pick<JobView, 'state' | 'shipMode' | 'merged' | 'undone'>): JobAction[] {
  switch (job.state) {
    case 'spec': return ['approve', 'discard'];
    case 'approve': return ['approve', 'reject', 'discard'];
    case 'escalated': return ['guidance', 'take-over', 'approve', 'discard']; // approve: she fixed it by hand, review again
    case 'stalled': return ['resume', 'take-over', 'discard'];
    case 'merging': return ['take-over', 'discard'];
    case 'done': return job.shipMode === 'local-merge' && job.merged && !job.undone ? ['undo-merge'] : [];
    case 'discarded': return [];
    default: return ['discard'];
  }
}

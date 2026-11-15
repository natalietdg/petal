// Phase 3: where jobs show. Lane rows via needsYou(), the Board roll-up, row buttons, Since you last looked, spend, and
// her buttons against a temp repo (claude is never started: spawn is a stand-in).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawned: { cmd: string; args: string[]; cwd: string }[] = [];
vi.mock('node:child_process', async (actual) => {
  const real = await actual<typeof import('node:child_process')>();
  return { ...real, spawn: (cmd: string, args: string[], options: { cwd: string }) => { spawned.push({ cmd, args, cwd: options.cwd }); return { on: () => {}, unref: () => {} }; } };
});
vi.mock('../src/main/claude-cli', () => ({ claudePath: async () => '/stand-in/claude', cleanEnv: () => ({}) }));
vi.mock('../src/main/claude-folder', () => ({ allowedClaudeHome: () => stub.claudeDir }));
const stub = { claudeDir: null as string | null };

const { createJob, createWorktree, jobDir, moveJob, readJob, worktreeOf } = await import('../src/main/factory-jobs-store');
const { jobAction, jobSignals, jobSpend, jobsView, markSeen } = await import('../src/main/factory-jobs-view');
const { laneFrom } = await import('../src/main/needs-you-hub');
const links = await import('../src/main/subsession-links');
const { repoKey } = await import('../src/main/petal-repos');
const { defaultFactory } = await import('../src/shared/factory');
const { actionsFor, jobsBadge, waitReason } = await import('../src/shared/factory-jobs');
const { NotifyGate, needsYou, jobSessionId } = await import('../src/shared/needs-you');
const { sinceLine } = await import('../src/shared/since-last-looked');
const { removeTempDirs, tempDir, useTempUserData } = await import('./helpers');

const sh = (cwd: string, ...args: string[]): string => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
let repo: string;

beforeEach(() => {
  useTempUserData();
  spawned.length = 0;
  stub.claudeDir = null;
  repo = fs.realpathSync(tempDir('petal-surf-repo-'));
  sh(repo, 'init', '-q', '-b', 'main');
  sh(repo, '-c', 'user.email=t@example.invalid', '-c', 'user.name=T', 'commit', '-q', '--allow-empty', '-m', 'start');
});
afterEach(() => removeTempDirs());

function jobAt(state: 'escalated' | 'approve' | 'reviewing', over: { riskyHits?: { file: string; label: string }[] } = {}) {
  const job = createJob({ repo, ask: 'Add login rate limit', factory: defaultFactory(), parentSessionId: 'parent-1' });
  const path_: string[] = state === 'escalated' ? ['intake', 'building', 'reviewing', 'escalated'] : state === 'approve' ? ['intake', 'building', 'reviewing', 'approve'] : ['intake', 'building', 'reviewing'];
  for (const to of path_) moveJob(repo, job.id, to as never);
  if (over.riskyHits) fs.writeFileSync(path.join(jobDir(repo, job.id), 'job.json'), JSON.stringify({ ...readJob(repo, job.id), riskyHits: over.riskyHits }));
  return readJob(repo, job.id)!;
}

describe('what a waiting job says', () => {
  it('names the risky file at Approve and the failing reviewer when stuck', () => {
    const base = { rework: 2, reworkCap: 2, blocked: null, events: [] };
    expect(waitReason({ ...base, state: 'approve', riskyHits: [{ file: 'src/auth.ts', label: 'auth' }] }, {})).toBe('Approve merge · touches auth (src/auth.ts)');
    expect(waitReason({ ...base, state: 'escalated', riskyHits: [] }, { 'review-code.md': { kind: 'VERDICT', value: 'FAIL', rest: 'no test for the limit' } })).toBe('Stuck after 2 tries · code: no test for the limit');
    expect(waitReason({ ...base, state: 'merging', riskyHits: [], blocked: 'Commit or stash in shop to merge' }, {})).toBe('Commit or stash in shop to merge · Petal tries again on its own');
    expect(waitReason({ ...base, state: 'merging', riskyHits: [], blocked: 'Couldn’t merge. Take over to see why.' }, {})).toBe('Couldn’t merge. Take over to see why.');
    expect(waitReason({ ...base, rework: 0, state: 'escalated', riskyHits: [], events: [{ at: 1, from: 'building', to: 'escalated', note: 'needs an API key' }] }, {})).toBe('Builder is stuck · needs an API key');
    expect(waitReason({ ...base, state: 'building', riskyHits: [] }, {})).toBeNull();
  });

  it('rolls up into the parent card and offers the buttons for its state', () => {
    expect(jobsBadge([{ state: 'building', waitReason: null }, { state: 'approve', waitReason: 'x' }, { state: 'done', waitReason: null }])).toBe('2 jobs · 1 waiting');
    expect(jobsBadge([{ state: 'stalled', waitReason: null }])).toBe('1 job · 1 stalled');
    expect(jobsBadge([{ state: 'done', waitReason: null }])).toBe('');
    const v = { shipMode: 'local-merge' as const, merged: false, undone: false, takenOver: false };
    expect(actionsFor({ ...v, state: 'escalated' })).toEqual(['guidance', 'take-over', 'discard']);
    expect(actionsFor({ ...v, state: 'escalated', takenOver: true })).toEqual(['approve', 'guidance', 'take-over', 'discard']); // "I fixed it" only after Take over
    expect(actionsFor({ ...v, state: 'approve' })).toEqual(['take-over', 'approve', 'reject', 'discard']);
    expect(actionsFor({ ...v, state: 'stalled' })).toEqual(['resume', 'take-over', 'discard']);
    expect(actionsFor({ ...v, state: 'done', merged: true })).toEqual(['undo-merge']);
    expect(actionsFor({ ...v, state: 'done', shipMode: 'pr' })).toEqual([]);
  });
});

describe('the Waiting lane', () => {
  it('gets one job row per waiting job, through needsYou, and notifies once while unfocused', () => {
    const job = jobAt('approve', { riskyHits: [{ file: 'src/auth.ts', label: 'auth' }] });
    jobAt('reviewing'); // working: no row
    const signals = jobSignals();
    expect(signals).toHaveLength(1);
    const need = needsYou(signals[0]);
    expect(need).toMatchObject({ kind: 'job', rank: 3, reason: 'Approve merge · touches auth (src/auth.ts)', jobId: job.id, jobRepo: repo, sessionId: jobSessionId(job.id) });
    const lane = laneFrom({ reports: new Map(), children: new Map(), orphans: [], jobs: signals });
    expect(lane.map((n) => n.kind)).toEqual(['job']);
    const gate = new NotifyGate();
    expect(gate.next(lane, false)).toHaveLength(1);
    expect(gate.next(lane, false)).toHaveLength(0); // one notification per wait
  });
});

describe('Since you last looked', () => {
  it('counts factory job changes', () => {
    const at = Date.now();
    const events = [{ id: 'j', kind: 'job' as const, at, sessionId: null, sessionName: null, branch: null, repo: 'shop', text: 'x' }];
    expect(sinceLine(events, at - 1000, '1 min ago')).toBe('Since you last looked, 1 min ago: 1 factory job changed.');
  });
});

describe('the Jobs view', () => {
  it('lists the active repo for the first-run card, then repos with jobs; Got it is remembered', () => {
    const view = jobsView(repo);
    expect(view.repos).toHaveLength(1);
    expect(view.repos[0]).toMatchObject({ repo, seen: false, jobs: [], ship: { mode: 'local-merge', saved: false } });
    markSeen(repo);
    expect(jobsView(repo).repos[0].seen).toBe(true);
    const job = jobAt('approve');
    const listed = jobsView(null).repos[0].jobs[0];
    expect(listed).toMatchObject({ id: job.id, state: 'approve', label: 'Approve merge', waitReason: 'Approve merge', tokens: null, parentSessionId: 'parent-1' });
  });

  it('counts a job’s spend from its worktree’s transcripts, subagents included', () => {
    stub.claudeDir = tempDir('petal-surf-claude-');
    const wt = '/Users/x/.petal/worktrees/k/job-1';
    const dir = path.join(stub.claudeDir, 'projects', repoKey(wt));
    fs.mkdirSync(path.join(dir, 's1', 'subagents'), { recursive: true });
    const line = (id: string, input: number) => JSON.stringify({ message: { id, usage: { input_tokens: input, output_tokens: 10 } } });
    fs.writeFileSync(path.join(dir, 's1.jsonl'), `${line('m1', 100)}\n${line('m1', 100)}\n`);
    fs.writeFileSync(path.join(dir, 's1', 'subagents', 'agent-a.jsonl'), `${line('m2', 50)}\n`);
    expect(jobSpend(wt, stub.claudeDir)).toBe(110 + 60);
    expect(jobSpend(wt, null)).toBeNull();
  });
});

describe('her buttons', () => {
  it('Give guidance writes the decision, sends the job to rework and starts its runner under the parent', async () => {
    const job = jobAt('escalated');
    createWorktree(repo, job.id);
    await expect(jobAction(repo, job.id, 'guidance', '  ')).rejects.toThrow('Say what to change');
    const { job: after } = await jobAction(repo, job.id, 'guidance', 'Use the existing limiter');
    expect(after).toMatchObject({ state: 'rework', guidance: 'Use the existing limiter' });
    expect(fs.existsSync(path.join(jobDir(repo, job.id), 'round-1', 'decision.md'))).toBe(true);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]).toMatchObject({ cmd: '/stand-in/claude', cwd: worktreeOf(repo, job.id) });
    expect(spawned[0].args.slice(0, 4)).toEqual(['-p', `Use the factory skill: /factory run ${job.id}`, '--permission-mode', 'acceptEdits']);
    const sessionId = spawned[0].args[5];
    expect(after?.childSessionIds).toEqual([sessionId]);
    expect(links.parentOf(links.add([]), sessionId)).toBe('parent-1'); // History nests it under the session that started the job
  });

  it('Approve at a risky job moves it to Merge without starting anything', async () => {
    const job = jobAt('approve');
    createWorktree(repo, job.id);
    const { job: after } = await jobAction(repo, job.id, 'approve');
    expect(['merging', 'done']).toContain(after?.state);
    expect(spawned).toHaveLength(0);
  });

  it('Take over hands back the worktree; Discard removes it', async () => {
    const job = jobAt('escalated');
    const { takeOver } = await jobAction(repo, job.id, 'take-over');
    expect(takeOver).toBe(worktreeOf(repo, job.id));
    expect(readJob(repo, job.id)?.takenOver).toBe(true);
    expect(fs.existsSync(takeOver!)).toBe(true);
    expect((await jobAction(repo, job.id, 'discard')).job?.state).toBe('discarded');
    expect(fs.existsSync(takeOver!)).toBe(false);
  });

  it('refuses a button the job’s state doesn’t offer', async () => {
    const job = jobAt('reviewing');
    await expect(jobAction(repo, job.id, 'approve')).rejects.toThrow('Nothing here waits for approval');
    await expect(jobAction(repo, job.id, 'resume')).rejects.toThrow('Only a stalled job can resume');
    await expect(jobAction(repo, 'nope', 'discard')).rejects.toThrow('That job is gone');
  });
});

describe('runners start in one place', () => {
  it('a queued job with a ready spec starts when a slot frees, once; one without a spec waits for Intake', async () => {
    const { ensureRunners } = await import('../src/main/factory-jobs-view');
    const ready = createJob({ repo, ask: 'Ready one', factory: defaultFactory(), parentSessionId: null });
    fs.writeFileSync(path.join(jobDir(repo, ready.id), 'spec.md'), 'STATUS: ready\n');
    const bare = createJob({ repo, ask: 'No spec yet', factory: defaultFactory(), parentSessionId: null, now: Date.now() + 1 });
    const started = await ensureRunners();
    expect(started.map((j) => j.id)).toEqual([ready.id]);
    expect(readJob(repo, ready.id)).toMatchObject({ state: 'building', runnerAt: 1 });
    expect(readJob(repo, bare.id)?.state).toBe('queued');
    expect(await ensureRunners()).toEqual([]); // the same move never starts a second runner
    expect(spawned).toHaveLength(1);
  });
});

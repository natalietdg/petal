// The factory job model, pure: moves between states, the rework cap, risky paths, merge preconditions, the queue.
import { describe, expect, it } from 'vitest';
import { DEFAULT_RISKY, defaultFactory } from '../src/shared/factory';
import {
  JOB_STATES, STALL_MS, afterReview, canMove, defaultShipMode, firstLine, globToRegExp, isStalled, isVisualFile, mergeCheck,
  move, newJobId, resumeState, reviewersFor, riskyHits, startable, stateLabel, titleOf, type Job, type JobState,
} from '../src/shared/factory-jobs';

const T0 = Date.UTC(2026, 10, 15, 9, 0, 0);
const job = (over: Partial<Job> = {}): Job => {
  const f = defaultFactory();
  return {
    version: 1, id: 'j1', repo: '/r/a', ask: 'Add a thing', title: 'Add a thing', state: 'queued', createdAt: T0, updatedAt: T0, progressAt: T0,
    rework: 0, reworkCap: 2, askedQuestions: false, stations: f.stations, reviewers: f.reviewers, risky: f.risky, riskyHits: [],
    shipMode: 'local-merge', branch: 'factory/j1', worktree: '/w/j1', parentSessionId: null, childSessionIds: [], blocked: null,
    guidance: null, merge: null, prUrl: null, events: [], ...over,
  };
};
const go = (j: Job, to: JobState, note?: string): Job => {
  const moved = move(j, to, j.updatedAt + 1000, note);
  if (!moved.ok) throw new Error(moved.problem);
  return moved.job;
};
const pass = { kind: 'VERDICT', value: 'PASS', rest: '' } as const;
const fail = { kind: 'VERDICT', value: 'FAIL', rest: 'missing test' } as const;

describe('moves', () => {
  it('walks the happy path and records each move', () => {
    let j = job();
    for (const to of ['intake', 'building', 'reviewing', 'merging', 'done'] as const) j = go(j, to);
    expect(j.state).toBe('done');
    expect(j.events.map((e) => `${e.from}>${e.to}`)).toEqual(['queued>intake', 'intake>building', 'building>reviewing', 'reviewing>merging', 'merging>done']);
  });

  it('gates the spec only when intake asked questions, and queues when no slot is free', () => {
    expect(canMove(job({ state: 'intake' }), 'spec')).toBe(true);
    expect(canMove(job({ state: 'spec' }), 'building')).toBe(true);
    expect(canMove(job({ state: 'intake' }), 'queued')).toBe(true);
  });

  it('refuses moves the spine does not have', () => {
    expect(move(job(), 'building', T0).ok).toBe(false);
    expect(move(job({ state: 'building' }), 'merging', T0)).toEqual({ ok: false, problem: 'A job can’t go from building to merging.' });
    expect(canMove(job({ state: 'done' }), 'discarded')).toBe(false);
    expect(canMove(job({ state: 'discarded' }), 'intake')).toBe(false);
    expect(canMove(job({ state: 'approve' }), 'done')).toBe(false); // approval always goes through Merge
  });

  it('any unfinished job can be discarded; only working states stall, and a stall resumes where it was', () => {
    for (const state of JOB_STATES) expect(canMove(job({ state }), 'discarded')).toBe(state !== 'done' && state !== 'discarded');
    expect(canMove(job({ state: 'approve' }), 'stalled')).toBe(false); // waiting on her is never a stall
    const stalled = go(job({ state: 'reviewing' }), 'stalled');
    expect(stalled).toMatchObject({ state: 'stalled', stalledFrom: 'reviewing', progressAt: T0 });
    expect(canMove(stalled, 'building')).toBe(false);
    const resumed = go(stalled, 'reviewing');
    expect(resumed.stalledFrom).toBeUndefined();
  });

  it('keeps guidance given on rework', () => {
    expect(go(job({ state: 'escalated', rework: 2 }), 'rework', 'Use the existing helper').guidance).toBe('Use the existing helper');
  });
});

describe('the rework cap', () => {
  const expected = ['ux', 'code', 'security'];
  it('reworks while under the cap, then escalates', () => {
    const verdicts = { ux: pass, code: fail, security: pass };
    expect(afterReview(job({ rework: 0 }), verdicts, expected, [])).toMatchObject({ to: 'rework', failed: ['code'], reason: 'Rework 1/2: code asked for changes' });
    expect(afterReview(job({ rework: 1 }), verdicts, expected, [])?.to).toBe('rework');
    expect(afterReview(job({ rework: 2 }), verdicts, expected, [])).toMatchObject({ to: 'escalated', reason: 'Stuck after 2 tries' });
  });

  it('a third automatic rework is refused by move itself', () => {
    let j = job({ state: 'reviewing' });
    j = go(j, 'rework'); j = go(j, 'reviewing'); j = go(j, 'rework'); j = go(j, 'reviewing');
    expect(j.rework).toBe(2);
    expect(move(j, 'rework', T0)).toEqual({ ok: false, problem: 'This job already had 2 reworks; it goes to you instead.' });
    expect(go(go(j, 'escalated'), 'rework', 'try X').rework).toBe(3); // her guidance may send it back once more
  });

  it('waits until every expected reviewer wrote a verdict', () => {
    expect(afterReview(job(), { ux: pass, code: pass }, expected, [])).toBeNull();
    expect(afterReview(job(), { ux: pass, code: pass, security: { kind: 'STATUS', value: 'working', rest: '' } }, expected, [])).toBeNull();
  });

  it('passes to Approve on a risky path, otherwise straight to Merge', () => {
    const all = { ux: pass, code: pass, security: pass };
    expect(afterReview(job(), all, expected, ['src/readme.md'])).toMatchObject({ to: 'merging', reason: 'Low risk, merging' });
    expect(afterReview(job(), all, expected, ['src/auth/session.ts', 'package.json'])).toMatchObject({ to: 'approve', reason: 'Touches auth (src/auth/session.ts)', hits: [{ file: 'src/auth/session.ts', label: 'auth' }, { file: 'package.json', label: 'new dependency' }] });
  });
});

describe('risky paths and visual files', () => {
  it.each([
    ['src/main/login-form.ts', 'auth'],
    ['api/PaymentService.cs', 'payments'],
    ['.github/workflows/ci.yml', 'deploy or CI'],
    ['infra/k8s/app.yaml', 'deploy or CI'],
    ['db/migrations/0003_add.sql', 'schema migration'],
    ['src/notify/email-sender.ts', 'email'],
    ['package-lock.json', 'new dependency'],
    ['svc/go.mod', 'new dependency'],
  ])('%s is %s', (file, label) => {
    expect(riskyHits([file], DEFAULT_RISKY)).toEqual([{ file, label }]);
  });

  it('leaves ordinary files alone and uses the rules she edited', () => {
    expect(riskyHits(['src/renderer/cat.ts', 'README.md', 'test/x.test.ts'], DEFAULT_RISKY)).toEqual([]);
    expect(riskyHits(['src/renderer/cat.ts'], [{ label: 'the cat', patterns: ['src/renderer/cat*'] }])).toEqual([{ file: 'src/renderer/cat.ts', label: 'the cat' }]);
    expect(riskyHits(['package.json'], [])).toEqual([]);
  });

  it('reads globs: ** any depth, * one folder, case-insensitive', () => {
    expect(globToRegExp('**/*.css').test('a/b/c.CSS')).toBe(true);
    expect(globToRegExp('**/*.css').test('c.css')).toBe(true);
    expect(globToRegExp('src/*.ts').test('src/a/b.ts')).toBe(false);
    expect(globToRegExp('a.b').test('axb')).toBe(false);
  });

  it('runs the ui reviewer only when the job changes how something looks', () => {
    const { reviewers } = defaultFactory();
    expect(reviewersFor(reviewers, ['src/main/factory-store.ts']).map((r) => r.name)).toEqual(['ux', 'code', 'security']);
    expect(reviewersFor(reviewers, ['src/renderer/customize.css']).map((r) => r.name)).toEqual(['ux', 'code', 'security', 'ui']);
    expect(isVisualFile('web/components/Button.tsx')).toBe(true);
    expect(isVisualFile('src/shared/needs-you.ts')).toBe(false);
  });
});

describe('merge preconditions', () => {
  const clean = { branch: 'main', dirty: false, mainBranch: 'main', jobBranchExists: true };
  it('merges locally only into a clean checkout on main', () => {
    expect(mergeCheck('local-merge', clean, 'shop')).toEqual({ ok: true, action: 'merge' });
    expect(mergeCheck('local-merge', { ...clean, dirty: true }, 'shop')).toEqual({ ok: false, reason: 'Commit or stash in shop to merge' });
    expect(mergeCheck('local-merge', { ...clean, branch: 'feature' }, 'shop')).toEqual({ ok: false, reason: 'Switch shop to main to merge' });
    expect(mergeCheck('local-merge', { ...clean, branch: null }, 'shop').ok).toBe(false);
  });

  it('PR mode pushes whatever state the main checkout is in, and nothing ships without the branch', () => {
    expect(mergeCheck('pr', { ...clean, dirty: true, branch: 'other' }, 'shop')).toEqual({ ok: true, action: 'push' });
    expect(mergeCheck('pr', { ...clean, jobBranchExists: false }, 'shop').ok).toBe(false);
  });
});

describe('the queue', () => {
  it('starts queued jobs oldest first while fewer than two run in their repo', () => {
    const jobs = [
      job({ id: 'run1', state: 'building' }),
      job({ id: 'q-new', state: 'queued', createdAt: T0 + 5 }),
      job({ id: 'q-old', state: 'queued', createdAt: T0 + 1 }),
      job({ id: 'q-mid', state: 'queued', createdAt: T0 + 3 }),
      job({ id: 'other', repo: '/r/b', state: 'queued' }),
      job({ id: 'wait', state: 'approve' }), // waiting on her doesn't take a slot
    ];
    expect(startable(jobs).map((j) => j.id)).toEqual(['other', 'q-old']); // 'other' is the oldest
    expect(startable([...jobs, job({ id: 'run2', state: 'rework' })]).map((j) => j.id)).toEqual(['other']);
  });
});

describe('hand-off files', () => {
  it('reads the first line forms Claude writes', () => {
    expect(firstLine('VERDICT: PASS')).toEqual({ kind: 'VERDICT', value: 'PASS', rest: '' });
    expect(firstLine('\n\n**VERDICT:** FAIL · two tests missing\nmore')).toEqual({ kind: 'VERDICT', value: 'FAIL', rest: 'two tests missing' });
    expect(firstLine('STATUS: done · tests pass')).toEqual({ kind: 'STATUS', value: 'done', rest: 'tests pass' });
    expect(firstLine('VERDICT: MAYBE')).toBeNull();
    expect(firstLine('# Review\nVERDICT: PASS')).toBeNull(); // only the first line counts
  });

  it('resumes from the furthest file that carries a verdict or status', () => {
    const reviewers = ['ux', 'code'];
    expect(resumeState({}, reviewers)).toBe('intake');
    expect(resumeState({ 'spec.md': null }, reviewers)).toBe('building');
    expect(resumeState({ 'spec.md': null, 'build.md': { kind: 'STATUS', value: 'working', rest: '' } }, reviewers)).toBe('building');
    expect(resumeState({ 'spec.md': null, 'build.md': { kind: 'STATUS', value: 'done', rest: '' } }, reviewers)).toBe('reviewing');
    expect(resumeState({ 'review-ux.md': pass, 'review-code.md': fail }, reviewers)).toBe('reviewing');
    expect(resumeState({ 'decision.md': pass }, reviewers)).toBe('merging');
  });
});

describe('stalls, ship mode, ids and labels', () => {
  it('stalls after ten silent minutes in a working state only', () => {
    expect(isStalled(job({ state: 'building' }), T0 + STALL_MS)).toBe(false);
    expect(isStalled(job({ state: 'building' }), T0 + STALL_MS + 1)).toBe(true);
    expect(isStalled(job({ state: 'escalated' }), T0 + STALL_MS * 9)).toBe(false);
    expect(isStalled(job({ state: 'queued' }), T0 + STALL_MS * 9)).toBe(false);
  });

  it.each([
    [null, 'local-merge'],
    ['git@github.com:someone/side-project.git', 'local-merge'],
    ['https://dev.azure.com/PaywatchMY/Paywatch/_git/admin-v3', 'pr'],
    ['git@ssh.dev.azure.com:v3/PaywatchMY/Paywatch/admin-v3', 'pr'],
    ['https://paywatchmy.visualstudio.com/Paywatch/_git/x', 'pr'],
    ['git@github.com:paywatchglobal/service.git', 'pr'],
  ])('ship mode for %s is %s', (remote, mode) => {
    expect(defaultShipMode(remote)).toBe(mode);
  });

  it('makes dated unique ids and a one-line title', () => {
    expect(newJobId('Add dark mode to the Board!', T0, [])).toBe('20261115-add-dark-mode-to-the-board');
    expect(newJobId('Add dark mode to the Board!', T0, ['20261115-add-dark-mode-to-the-board'])).toBe('20261115-add-dark-mode-to-the-board-2');
    expect(titleOf(`${'x'.repeat(100)}\nsecond line`)).toHaveLength(72);
  });

  it('labels each state in plain words', () => {
    expect(stateLabel(job({ state: 'rework', rework: 1 }))).toBe('Rework 1/2');
    expect(stateLabel(job({ state: 'merging', blocked: 'Commit or stash in shop to merge' }))).toBe('Commit or stash in shop to merge');
    expect(stateLabel(job({ state: 'done' }))).toBe('Merged locally · not pushed');
    expect(stateLabel(job({ state: 'stalled', stalledFrom: 'reviewing' }))).toBe('No progress for 10 min · Resume from reviewing');
  });
});

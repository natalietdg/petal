// Phase 2: the files drive the job. reconcile() pure, the watcher end to end on a temp repo, and the skill Claude reads.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorktree, jobDir, readJob, worktreeOf } from '../src/main/factory-jobs-store';
import { tick } from '../src/main/factory-jobs-watch';
import { repoKey } from '../src/main/petal-repos';
import { reposRoot } from '../src/main/petal-home';
import { defaultFactory, renderSkill } from '../src/shared/factory';
import { parseRequest, reconcile, type Handoffs, type Job } from '../src/shared/factory-jobs';
import { removeTempDirs, tempDir, useTempUserData } from './helpers';

const T0 = Date.UTC(2026, 10, 15, 9);
const st = (value: string, rest = '') => ({ kind: 'STATUS', value, rest }) as const;
const v = (value: 'PASS' | 'FAIL', rest = '') => ({ kind: 'VERDICT', value, rest }) as const;
const baseJob = (over: Partial<Job> = {}): Job => {
  const f = defaultFactory();
  return {
    version: 1, id: 'j', repo: '/r', ask: 'a', title: 'a', state: 'intake', createdAt: T0, updatedAt: T0, progressAt: T0, rework: 0, reworkCap: 2,
    askedQuestions: false, stations: f.stations, reviewers: f.reviewers, risky: f.risky, riskyHits: [], shipMode: 'local-merge', branch: 'factory/j',
    worktree: '/w', parentSessionId: null, childSessionIds: [], blocked: null, guidance: null, merge: null, prUrl: null, events: [], ...over,
  };
};
const ctx = { changed: ['src/x.ts'], freeSlot: true };
const reviews = (verdict: 'PASS' | 'FAIL', names = ['ux', 'code', 'security']): Handoffs => Object.fromEntries(names.map((n) => [`review-${n}.md`, v(verdict, 'x')]));

describe('reconcile', () => {
  it('intake: a ready spec builds, a confirmed one waits for her, a full repo queues', () => {
    expect(reconcile(baseJob(), { 'spec.md': st('ready') }, ctx)).toEqual({ to: 'building' });
    expect(reconcile(baseJob(), { 'spec.md': st('confirm') }, ctx)).toEqual({ to: 'spec', patch: { askedQuestions: true } });
    expect(reconcile(baseJob(), { 'spec.md': st('ready') }, { ...ctx, freeSlot: false })?.to).toBe('queued');
    expect(reconcile(baseJob({ state: 'spec' }), { 'spec.md': st('confirm') }, ctx)).toBeNull();
    expect(reconcile(baseJob({ state: 'spec' }), { 'spec.md': st('approved') }, ctx)?.to).toBe('building');
  });

  it('build done goes to review; blocked goes to her', () => {
    expect(reconcile(baseJob({ state: 'building' }), { 'build.md': st('working') }, ctx)).toBeNull();
    expect(reconcile(baseJob({ state: 'building' }), { 'build.md': st('done') }, ctx)).toEqual({ to: 'reviewing' });
    expect(reconcile(baseJob({ state: 'rework' }), { 'build.md': st('blocked', 'needs a key') }, ctx)).toEqual({ to: 'escalated', note: 'needs a key' });
  });

  it('review waits for every expected reviewer; ui only on visual diffs', () => {
    const job = baseJob({ state: 'reviewing' });
    expect(reconcile(job, { ...reviews('PASS', ['ux', 'code']) }, ctx)).toBeNull();
    expect(reconcile(job, reviews('PASS'), ctx)?.to).toBe('merging');
    expect(reconcile(job, reviews('PASS'), { ...ctx, changed: ['src/a.css'] })).toBeNull(); // waits for ui
    expect(reconcile(job, { ...reviews('PASS'), 'review-ui.md': v('PASS') }, { ...ctx, changed: ['src/a.css'] })?.to).toBe('merging');
  });

  it('a failed review archives the round and reworks, until the cap', () => {
    const step = reconcile(baseJob({ state: 'reviewing' }), { 'build.md': st('done'), ...reviews('FAIL') }, ctx);
    expect(step).toMatchObject({ to: 'rework', archive: ['build.md', 'review-ux.md', 'review-code.md', 'review-security.md'] });
    expect(reconcile(baseJob({ state: 'reviewing', rework: 2 }), reviews('FAIL'), ctx)?.to).toBe('escalated');
  });

  it('a risky diff waits at Approve; her decision merges or sends it back', () => {
    expect(reconcile(baseJob({ state: 'reviewing' }), reviews('PASS'), { ...ctx, changed: ['src/auth/x.ts'] })).toMatchObject({ to: 'approve', patch: { riskyHits: [{ file: 'src/auth/x.ts', label: 'auth' }] } });
    expect(reconcile(baseJob({ state: 'approve' }), { 'decision.md': v('PASS') }, ctx)?.to).toBe('merging');
    expect(reconcile(baseJob({ state: 'approve' }), { 'decision.md': v('FAIL', 'smaller') }, ctx)).toMatchObject({ to: 'rework', note: 'smaller' });
    expect(reconcile(baseJob({ state: 'escalated' }), { 'decision.md': v('FAIL', 'use X') }, ctx)).toMatchObject({ to: 'rework', note: 'use X' });
    expect(reconcile(baseJob({ state: 'escalated' }), { 'decision.md': v('PASS') }, ctx)?.to).toBe('reviewing');
  });

  it('parses request.md and refuses one without an absolute repo or an ask', () => {
    expect(parseRequest('STATUS: intake\nRepo: /a/b\nSession: s1\n\nAdd X\nand Y')).toEqual({ status: 'intake', repo: '/a/b', sessionId: 's1', ask: 'Add X\nand Y' });
    expect(parseRequest('STATUS: intake\nRepo: a/b\n\nAdd X')).toBeNull();
    expect(parseRequest('STATUS: intake\nRepo: /a\n\n')).toBeNull();
    expect(parseRequest('Repo: /a\n\nAdd')).toBeNull();
  });
});

describe('the watcher, on a temp repo', () => {
  const sh = (cwd: string, ...args: string[]): string => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
  let repo: string;
  let now: number;
  const deps = () => ({ factoryFor: () => defaultFactory(), now: () => now });
  const write = (id: string, name: string, text: string) => fs.writeFileSync(path.join(jobDir(repo, id), name), text);

  beforeEach(() => {
    useTempUserData();
    repo = fs.realpathSync(tempDir('petal-orch-repo-'));
    sh(repo, 'init', '-q', '-b', 'main');
    sh(repo, '-c', 'user.email=t@example.invalid', '-c', 'user.name=T', 'commit', '-q', '--allow-empty', '-m', 'start');
    now = T0;
  });
  afterEach(() => removeTempDirs());

  it('takes a job from request.md to a local merge with no tokens, files only', () => {
    const id = '20261115-add-b';
    fs.mkdirSync(jobDir(repo, id), { recursive: true });
    write(id, 'request.md', `STATUS: intake\nRepo: ${repo}\nSession: parent-1\n\nAdd b`);
    tick(deps());
    expect(readJob(repo, id)).toMatchObject({ state: 'intake', parentSessionId: 'parent-1', ask: 'Add b' });
    write(id, 'spec.md', 'STATUS: ready\n# Add b');
    tick(deps());
    expect(readJob(repo, id)?.state).toBe('building');
    createWorktree(repo, id);
    const wt = worktreeOf(repo, id);
    fs.writeFileSync(path.join(wt, 'b.txt'), 'b\n');
    sh(wt, 'add', 'b.txt');
    sh(wt, '-c', 'user.email=t@example.invalid', '-c', 'user.name=T', 'commit', '-q', '-m', 'b');
    write(id, 'build.md', 'STATUS: done · b added');
    for (const n of ['ux', 'code', 'security']) write(id, `review-${n}.md`, 'VERDICT: PASS');
    now += 1000;
    tick(deps());
    const job = readJob(repo, id);
    expect(job?.state).toBe('done');
    expect(job?.events.map((e) => e.to)).toEqual(['intake', 'building', 'reviewing', 'merging', 'done']);
    expect(fs.existsSync(path.join(repo, 'b.txt'))).toBe(true);
  });

  it('ignores a request filed under another repo’s folder', () => {
    const other = fs.realpathSync(tempDir('petal-orch-other-'));
    fs.mkdirSync(path.join(other, '.git'));
    const dir = path.join(reposRoot(), repoKey(repo), 'factory', 'jobs', 'sneaky');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'request.md'), `STATUS: intake\nRepo: ${other}\n\nX`);
    expect(tick(deps())).toEqual([]);
    expect(fs.existsSync(path.join(dir, 'job.json'))).toBe(false);
  });

  it('a silent job stalls after ten minutes; waiting on her never does', () => {
    const id = 'quiet';
    fs.mkdirSync(jobDir(repo, id), { recursive: true });
    write(id, 'request.md', `STATUS: intake\nRepo: ${repo}\n\nX`);
    tick(deps());
    now = Math.max(Date.now(), T0) + 11 * 60 * 1000; // file mtimes are real time; T0 may be ahead of the clock
    tick(deps());
    expect(readJob(repo, id)).toMatchObject({ state: 'stalled', stalledFrom: 'intake' });
  });
});

describe('the skill Claude reads', () => {
  const skill = renderSkill(defaultFactory(), 'global');
  it('names every command and the hand-off first lines', () => {
    for (const text of ['**/factory <ask>.**', '**/factory next.**', '**/factory approve <job>.**', '**/factory rework <job> <note>.**', '**/factory run <job>.**', '`VERDICT: PASS`', '`STATUS: confirm`', '`STATUS: done · <one line>`']) expect(skill).toContain(text);
  });
  it('starts reviewers in one message, the ui one only for visual diffs', () => {
    expect(skill).toContain('Start every reviewer that applies in one message, all at once');
    expect(skill).toMatch(/`ui`: a `ui` subagent, only when the diff touches how something looks/);
    expect(skill).not.toMatch(/`code`: [^\n]*only when/);
  });
  it('keeps job state out of the repo and Claude away from job.json, main and pushing', () => {
    expect(skill).toContain('`~/.petal/repos/<repoKey>/factory/jobs/<job>/`');
    expect(skill).toContain('`~/.petal/worktrees/<repoKey>/<job>`');
    expect(skill).toContain('never write it');
    expect(skill).toContain('Never merge, push or touch the main checkout.');
    expect(skill).toContain('After 2 reworks');
  });
});

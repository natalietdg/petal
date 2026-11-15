// Factory jobs on disk and in git, against temp repos only: no real repo is ever read or changed, nothing is pushed.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  changedFiles, createJob, createWorktree, discardJob, jobFile, listJobs, moveJob, prCreateUrl, readHandoffs, readJob, saveShipMode,
  shipJob, shipSetting, undoMerge, worktreeOf, writeJob,
} from '../src/main/factory-jobs-store';
import { globalJson, migrateSaved, skillFile } from '../src/main/factory-store';
import { repoKey } from '../src/main/petal-repos';
import { defaultFactory } from '../src/shared/factory';
import { removeTempDirs, tempDir, useTempUserData } from './helpers';

const sh = (cwd: string, ...args: string[]): string => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();

let home: string;
let repo: string;

function makeRepo(): string {
  const dir = fs.realpathSync(tempDir('petal-job-repo-'));
  sh(dir, 'init', '-q', '-b', 'main');
  sh(dir, 'config', 'user.email', 'test@example.invalid');
  sh(dir, 'config', 'user.name', 'Test');
  sh(dir, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  sh(dir, 'add', 'a.txt');
  sh(dir, 'commit', '-q', '-m', 'start');
  return dir;
}

// The job's work: one commit on its branch, in its worktree.
function build(id: string, file = 'b.txt'): void {
  const wt = worktreeOf(repo, id);
  fs.mkdirSync(path.dirname(path.join(wt, file)), { recursive: true });
  fs.writeFileSync(path.join(wt, file), 'built\n');
  sh(wt, 'add', file);
  sh(wt, '-c', 'user.email=t@example.invalid', '-c', 'user.name=T', 'commit', '-q', '-m', 'build');
}

function toMerging(id: string): void {
  for (const to of ['intake', 'building', 'reviewing', 'merging'] as const) moveJob(repo, id, to);
}

beforeEach(() => {
  home = useTempUserData();
  repo = makeRepo();
});
afterEach(() => removeTempDirs());

describe('where things live', () => {
  it('keeps job state and worktrees in ~/.petal, nothing in the repo', () => {
    const job = createJob({ repo, ask: 'Add b', factory: defaultFactory(), parentSessionId: 's1' });
    expect(jobFile(repo, job.id)).toBe(path.join(home, '.petal', 'repos', repoKey(repo), 'factory', 'jobs', job.id, 'job.json'));
    expect(job.worktree).toBe(path.join(home, '.petal', 'worktrees', repoKey(repo), job.id));
    expect(job).toMatchObject({ state: 'queued', branch: `factory/${job.id}`, shipMode: 'local-merge', reworkCap: 2, parentSessionId: 's1' });
    expect(job.stations.map((s) => s.id)).toEqual(defaultFactory().stations.map((s) => s.id)); // the stations it started with
    expect(sh(repo, 'status', '--porcelain')).toBe('');
    expect(listJobs(repo).map((j) => j.id)).toEqual([job.id]);
  });

  it('skips a job.json that is not one, and refuses an empty ask', () => {
    const job = createJob({ repo, ask: 'x', factory: defaultFactory(), parentSessionId: null });
    fs.writeFileSync(jobFile(repo, job.id), '{ half');
    expect(listJobs(repo)).toEqual([]);
    expect(() => createJob({ repo, ask: '   ', factory: defaultFactory(), parentSessionId: null })).toThrow('Say what to build');
  });

  it('reads hand-off first lines and ignores other files', () => {
    const job = createJob({ repo, ask: 'x', factory: defaultFactory(), parentSessionId: null });
    const dir = path.dirname(jobFile(repo, job.id));
    fs.writeFileSync(path.join(dir, 'build.md'), 'STATUS: done · 3 files\n');
    fs.writeFileSync(path.join(dir, 'review-code.md'), 'VERDICT: FAIL · no test\n');
    fs.writeFileSync(path.join(dir, 'notes.md'), 'VERDICT: PASS');
    expect(readHandoffs(repo, job.id)).toEqual({ 'build.md': { kind: 'STATUS', value: 'done', rest: '3 files' }, 'review-code.md': { kind: 'VERDICT', value: 'FAIL', rest: 'no test' } });
  });
});

describe('ship mode', () => {
  it('detects from the remote and saves her choice', () => {
    expect(shipSetting(repo)).toMatchObject({ mode: 'local-merge', saved: false, remote: null });
    sh(repo, 'remote', 'add', 'origin', 'https://dev.azure.com/PaywatchMY/Paywatch/_git/x');
    expect(shipSetting(repo)).toMatchObject({ mode: 'pr', detected: 'pr', saved: false });
    expect(saveShipMode(repo, 'local-merge')).toMatchObject({ mode: 'local-merge', detected: 'pr', saved: true });
    expect(() => saveShipMode(repo, 'yolo' as never)).toThrow();
  });

  it('builds the pull request page for Azure DevOps and GitHub', () => {
    expect(prCreateUrl('git@ssh.dev.azure.com:v3/PaywatchMY/Paywatch/admin-v3', 'factory/j')).toBe('https://dev.azure.com/PaywatchMY/Paywatch/_git/admin-v3/pullrequestcreate?sourceRef=factory%2Fj');
    expect(prCreateUrl('https://github.com/me/shop.git', 'factory/j')).toBe('https://github.com/me/shop/compare/factory%2Fj?expand=1');
    expect(prCreateUrl('/some/path', 'b')).toBeNull();
  });
});

describe('local merge', () => {
  it('merges into a clean main, removes the worktree, keeps the branch, and never pushes', () => {
    const job = createJob({ repo, ask: 'Add b', factory: defaultFactory(), parentSessionId: null });
    createWorktree(repo, job.id);
    build(job.id);
    expect(changedFiles(readJob(repo, job.id)!)).toEqual(['b.txt']);
    toMerging(job.id);
    const { job: done, check } = shipJob(repo, job.id);
    expect(check).toEqual({ ok: true, action: 'merge' });
    expect(done.state).toBe('done');
    expect(fs.readFileSync(path.join(repo, 'b.txt'), 'utf8')).toBe('built\n');
    expect(done.merge?.commit).toBe(sh(repo, 'rev-parse', 'HEAD'));
    expect(fs.existsSync(job.worktree)).toBe(false);
    expect(sh(repo, 'branch', '--list', job.branch)).toContain(job.branch);
    expect(sh(repo, 'remote')).toBe('');
  });

  it('waits with "Commit or stash" while main has uncommitted changes, and changes nothing', () => {
    const job = createJob({ repo, ask: 'Add b', factory: defaultFactory(), parentSessionId: null });
    createWorktree(repo, job.id);
    build(job.id);
    toMerging(job.id);
    fs.writeFileSync(path.join(repo, 'a.txt'), 'her edit\n');
    const head = sh(repo, 'rev-parse', 'HEAD');
    const { job: waiting, check } = shipJob(repo, job.id);
    expect(check.ok).toBe(false);
    expect(waiting).toMatchObject({ state: 'merging', blocked: `Commit or stash in ${path.basename(repo)} to merge` });
    expect(sh(repo, 'rev-parse', 'HEAD')).toBe(head);
    expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('her edit\n');
    sh(repo, 'stash', '-q');
    expect(shipJob(repo, job.id).job.state).toBe('done');
  });

  it('a conflict aborts cleanly and says so', () => {
    const job = createJob({ repo, ask: 'Edit a', factory: defaultFactory(), parentSessionId: null });
    createWorktree(repo, job.id);
    build(job.id, 'a.txt');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'main moved\n');
    sh(repo, 'commit', '-qam', 'main moved');
    toMerging(job.id);
    const { job: after } = shipJob(repo, job.id);
    expect(after.blocked).toMatch(/Conflicts with main/);
    expect(sh(repo, 'status', '--porcelain')).toBe('');
  });

  it('Undo merge adds a revert commit, never rewrites main', () => {
    const job = createJob({ repo, ask: 'Add b', factory: defaultFactory(), parentSessionId: null });
    createWorktree(repo, job.id);
    build(job.id);
    toMerging(job.id);
    const merged = shipJob(repo, job.id).job;
    const undone = undoMerge(repo, job.id);
    expect(fs.existsSync(path.join(repo, 'b.txt'))).toBe(false);
    expect(sh(repo, 'rev-list', '--count', 'HEAD')).toBe('4'); // start, build, merge, revert
    expect(sh(repo, 'merge-base', '--is-ancestor', merged.merge!.commit, 'HEAD')).toBe('');
    expect(undone.merge?.undoneBy).toBe(sh(repo, 'rev-parse', 'HEAD'));
    expect(() => undoMerge(repo, job.id)).toThrow('already undone');
  });
});

describe('PR mode', () => {
  it('pushes only the job branch to the remote and leaves main alone', () => {
    const remote = fs.realpathSync(tempDir('petal-job-remote-'));
    sh(remote, 'init', '-q', '--bare');
    sh(repo, 'remote', 'add', 'origin', remote); // a temp bare repo, never a real host
    const job = createJob({ repo, ask: 'Add b', factory: defaultFactory(), parentSessionId: null });
    saveShipMode(repo, 'pr');
    writeJob({ ...readJob(repo, job.id)!, shipMode: 'pr' });
    createWorktree(repo, job.id);
    build(job.id);
    toMerging(job.id);
    fs.writeFileSync(path.join(repo, 'a.txt'), 'dirty main is fine here\n');
    const head = sh(repo, 'rev-parse', 'HEAD');
    const { job: done } = shipJob(repo, job.id);
    expect(done.state).toBe('done');
    expect(sh(remote, 'branch', '--list')).toBe(job.branch);
    expect(sh(repo, 'rev-parse', 'HEAD')).toBe(head);
    expect(fs.existsSync(path.join(repo, 'b.txt'))).toBe(false);
  });
});

describe('discard', () => {
  it('removes the worktree and the branch', () => {
    const job = createJob({ repo, ask: 'x', factory: defaultFactory(), parentSessionId: null });
    createWorktree(repo, job.id);
    moveJob(repo, job.id, 'intake');
    expect(discardJob(repo, job.id).state).toBe('discarded');
    expect(fs.existsSync(job.worktree)).toBe(false);
    expect(sh(repo, 'branch', '--list', job.branch)).toBe('');
  });
});

describe('moving a saved checklist onto the spine', () => {
  it('keeps the old file beside it, writes version 2 and the skill, once', () => {
    const claudeDir = tempDir('petal-mig-claude-');
    const v1 = { version: 1, stations: [{ id: 'intake', name: 'Intake', instructions: 'Hers.', passCheck: '', runner: 'claude' }, { id: 'ship', name: 'Ship', instructions: '', passCheck: '', runner: 'you' }, { id: 'learn', name: 'Learn', instructions: '', passCheck: '', runner: 'claude' }] };
    fs.writeFileSync(globalJson(claudeDir), JSON.stringify(v1));
    expect(migrateSaved({ claudeDir, repo: null })).toBe(true);
    const saved = JSON.parse(fs.readFileSync(globalJson(claudeDir), 'utf8'));
    expect(saved.version).toBe(2);
    expect(saved.stations.map((s: { id: string }) => s.id)).toEqual(['intake', 'build', 'review', 'approve', 'merge', 'learn']);
    expect(JSON.parse(fs.readFileSync(path.join(claudeDir, 'petal-factory.v1.json'), 'utf8'))).toEqual(v1);
    expect(fs.readFileSync(skillFile(claudeDir), 'utf8')).toContain('## 6. Learn');
    expect(migrateSaved({ claudeDir, repo: null })).toBe(false);
  });
});

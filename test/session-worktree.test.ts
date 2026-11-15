// New worktree from the Start palette, against temp repos only: nothing real is read or changed.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSessionWorktree } from '../src/main/session-worktree';
import { repoKey } from '../src/main/petal-repos';
import { worktreeBranch, worktreeName } from '../src/shared/session-worktree';
import { repoLabel } from '../src/main/repo-label';
import { removeTempDirs, tempDir, useTempUserData } from './helpers';

const sh = (cwd: string, ...args: string[]): string => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
let home: string;
let repo: string;

beforeEach(() => {
  home = useTempUserData();
  repo = fs.realpathSync(tempDir('petal-wt-repo-'));
  sh(repo, 'init', '-q', '-b', 'main');
  sh(repo, 'config', 'user.email', 'test@example.invalid');
  sh(repo, 'config', 'user.name', 'Test');
  sh(repo, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
  sh(repo, 'add', 'a.txt');
  sh(repo, 'commit', '-q', '-m', 'start');
});
afterEach(removeTempDirs);

describe('worktree names', () => {
  it('cleans what she typed into a folder and branch name', () => {
    expect(worktreeName('Fix the Login bug!')).toBe('fix-the-login-bug');
    expect(worktreeName('../../etc')).toBe('etc');
    expect(worktreeBranch('fix')).toBe('petal/fix');
  });

  it('names it from the time when she typed nothing', () => {
    expect(worktreeName('  ', new Date(2026, 10, 15, 9, 5))).toBe('session-261115-0905');
  });
});

describe('a new worktree for a session', () => {
  it('lands under ~/.petal/worktrees/<repoKey>/<name> on petal/<name>, branched from main, and Board groups it under the repo', () => {
    const made = createSessionWorktree(repo, 'try-it');
    expect(made).toEqual({ cwd: path.join(home, '.petal', 'worktrees', repoKey(repo), 'try-it') });
    const cwd = (made as { cwd: string }).cwd;
    expect(sh(cwd, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('petal/try-it');
    expect(fs.readFileSync(path.join(cwd, 'a.txt'), 'utf8')).toBe('one\n');
    expect(repoLabel(cwd)).toBe(`${path.basename(repo)} · petal/try-it`);
  });

  it('from inside a worktree, branches off the main checkout, not into a nested folder', () => {
    const first = (createSessionWorktree(repo, 'one') as { cwd: string }).cwd;
    expect(createSessionWorktree(first, 'two')).toEqual({ cwd: path.join(home, '.petal', 'worktrees', repoKey(repo), 'two') });
  });

  it('says why when the name is taken or the folder is not a repo', () => {
    createSessionWorktree(repo, 'dup');
    expect(createSessionWorktree(repo, 'dup')).toEqual({ note: 'A worktree named dup already exists. Pick another name.' });
    sh(repo, 'branch', 'petal/taken');
    expect(createSessionWorktree(repo, 'taken')).toEqual({ note: 'The branch petal/taken already exists. Pick another name.' });
    expect(createSessionWorktree(tempDir(), 'x')).toMatchObject({ note: expect.stringMatching(/needs a git repo/) });
  });
});

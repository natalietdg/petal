import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { repoLabel } from '../src/main/repo-label';
import { removeTempDirs, tempDir } from './helpers';

const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

function makeRepo(root: string, relative: string, head: string): string {
  const dir = path.join(root, relative);
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.git', 'HEAD'), head);
  return dir;
}

afterEach(removeTempDirs);

describe('repoLabel', () => {
  it('names the repo and branch at the toplevel', () => {
    const repo = makeRepo(tempDir(), 'pastel-term', 'ref: refs/heads/reader-polish\n');
    expect(repoLabel(repo)).toBe('pastel-term · reader-polish');
  });

  it('walks up from a subfolder to the toplevel', () => {
    const repo = makeRepo(tempDir(), 'admin-console', 'ref: refs/heads/feature/login-refresh\n');
    const deep = path.join(repo, 'src', 'pages');
    fs.mkdirSync(deep, { recursive: true });
    expect(repoLabel(deep)).toBe('admin-console · feature/login-refresh');
  });

  it('shows a short sha when HEAD is detached', () => {
    const repo = makeRepo(tempDir(), 'sweep', `${SHA}\n`);
    expect(repoLabel(repo)).toBe('sweep · a1b2c3d');
  });

  it('follows a worktree .git pointer file to its own HEAD', () => {
    const root = tempDir();
    const gitDir = path.join(root, 'main', '.git', 'worktrees', 'wt');
    fs.mkdirSync(gitDir, { recursive: true });
    fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/wt-branch\n');
    const worktree = path.join(root, 'wt');
    fs.mkdirSync(worktree);
    fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${gitDir}\n`);
    expect(repoLabel(worktree)).toBe('wt · wt-branch');
  });

  it('is just the folder name outside git, and null without a cwd', () => {
    const plain = path.join(tempDir(), 'notes');
    fs.mkdirSync(plain);
    expect(repoLabel(plain)).toBe('notes');
    expect(repoLabel(null)).toBeNull();
  });

  it('drops the branch when HEAD is unreadable', () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, 'broken', '.git'), { recursive: true });
    expect(repoLabel(path.join(root, 'broken'))).toBe('broken');
  });
});

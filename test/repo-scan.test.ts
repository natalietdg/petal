import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { branchFromHead, scanRepos } from '../src/main/repo-scan';
import { removeTempDirs, tempDir } from './helpers';

const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

// A fake repo: a .git folder with HEAD (and an index) is all the scanner reads.
function makeRepo(root: string, relative: string, head = 'ref: refs/heads/main\n'): string {
  const dir = path.join(root, relative);
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.git', 'HEAD'), head);
  fs.writeFileSync(path.join(dir, '.git', 'index'), '');
  return dir;
}

const names = async (root: string, options = {}) => (await scanRepos({ root, ...options })).repos.map((r) => r.shortPath);

afterEach(() => {
  vi.restoreAllMocks();
  removeTempDirs();
});

describe('branchFromHead', () => {
  it('reads a branch ref, a detached sha, and gives up on anything else', () => {
    expect(branchFromHead('ref: refs/heads/feature/repo-switcher\n')).toBe('feature/repo-switcher');
    expect(branchFromHead(`${SHA}\n`)).toBe('a1b2c3d');
    expect(branchFromHead('')).toBeNull();
    expect(branchFromHead('garbage')).toBeNull();
  });
});

describe('scanRepos', () => {
  it('finds repos at depths 1 to 4 with name, ~/ path, branch and mtime', async () => {
    const home = tempDir('petal-home-');
    makeRepo(home, 'top');
    makeRepo(home, 'Code/two', 'ref: refs/heads/dev\n');
    makeRepo(home, 'a/b/c/four');
    makeRepo(home, 'a/b/c/d/five'); // depth 5: past the limit
    const { repos, truncated } = await scanRepos({ root: home });
    expect(truncated).toBe(false);
    expect(repos.map((r) => r.shortPath)).toEqual(['~/a/b/c/four', '~/Code/two', '~/top']);
    const two = repos.find((r) => r.name === 'two');
    expect(two).toMatchObject({ path: path.join(home, 'Code/two'), branch: 'dev' });
    expect(two?.modifiedMs).toBeGreaterThan(0);
  });

  it('reports a detached HEAD as its short sha', async () => {
    const home = tempDir('petal-home-');
    makeRepo(home, 'detached', `${SHA}\n`);
    expect((await scanRepos({ root: home })).repos[0]?.branch).toBe('a1b2c3d');
  });

  it('skips protected and noisy folders', async () => {
    const home = tempDir('petal-home-');
    for (const skipped of ['Library/x', 'Pictures/x', 'Music/x', 'Movies/x', 'Applications/x', '.Trash/x', '.cache/x', '.nvm/x', 'Code/node_modules/x', 'Photos Library.photoslibrary/x']) makeRepo(home, skipped);
    makeRepo(home, 'Code/kept');
    expect(await names(home)).toEqual(['~/Code/kept']);
  });

  it('never reads or stats media-library locations, at the top or deeper down', async () => {
    const home = tempDir('petal-home-');
    const media = ['Music', 'Movies', 'Pictures', 'Desktop/old/TV Library.tvlibrary', 'Desktop/old/Music Library.musiclibrary', 'Code/Photos Library.photoslibrary'];
    for (const dir of media) makeRepo(home, `${dir}/inside`);
    makeRepo(home, 'Code/kept');
    const touched: string[] = [];
    for (const call of ['readdir', 'stat', 'lstat', 'readFile', 'open'] as const) {
      const original = fsp[call] as (...args: unknown[]) => unknown;
      vi.spyOn(fsp, call).mockImplementation(((target: unknown, ...rest: unknown[]) => {
        touched.push(String(target));
        return original.call(fsp, target, ...rest);
      }) as never);
    }
    expect(await names(home)).toEqual(['~/Code/kept']);
    expect(touched.length).toBeGreaterThan(0);
    for (const dir of media) expect(touched.filter((t) => t.startsWith(path.join(home, dir)))).toEqual([]);
  });

  it('skips the folders macOS guards with a prompt: Desktop, Documents, Downloads', async () => {
    const home = tempDir('petal-home-');
    for (const guarded of ['Desktop/a', 'Documents/b', 'Downloads/c', 'Library/Mobile Documents/com~apple~CloudDocs/d']) makeRepo(home, guarded);
    makeRepo(home, 'Code/kept');
    expect(await names(home)).toEqual(['~/Code/kept']);
  });

  it('skips Library-style names only at the top of home', async () => {
    const home = tempDir('petal-home-');
    makeRepo(home, 'Code/Library');
    expect(await names(home)).toEqual(['~/Code/Library']);
  });

  it('does not descend into a repo (nested and vendored repos stay out)', async () => {
    const home = tempDir('petal-home-');
    const outer = makeRepo(home, 'outer');
    makeRepo(outer, 'vendor/inner');
    makeRepo(outer, 'packages/sub');
    expect(await names(home)).toEqual(['~/outer']);
  });

  it('treats a .git file (worktree) as a repo and follows its gitdir for the branch', async () => {
    const home = tempDir('petal-home-');
    const main = makeRepo(home, 'main');
    const gitDir = path.join(main, '.git', 'worktrees', 'wt');
    fs.mkdirSync(gitDir, { recursive: true });
    fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/wt-branch\n');
    fs.mkdirSync(path.join(home, 'wt'));
    fs.writeFileSync(path.join(home, 'wt', '.git'), `gitdir: ${gitDir}\n`);
    const repos = (await scanRepos({ root: home })).repos;
    expect(repos.find((r) => r.name === 'wt')?.branch).toBe('wt-branch');
  });

  it('never follows a symlink, in or out of home', async () => {
    const home = tempDir('petal-home-');
    const outside = tempDir('petal-outside-');
    makeRepo(outside, 'elsewhere');
    fs.symlinkSync(outside, path.join(home, 'link-out'));
    makeRepo(home, 'real');
    fs.symlinkSync(path.join(home, 'real'), path.join(home, 'link-in'));
    expect(await names(home)).toEqual(['~/real']);
  });

  it('does not treat home itself as a repo', async () => {
    const home = tempDir('petal-home-');
    fs.mkdirSync(path.join(home, '.git'));
    makeRepo(home, 'project');
    expect(await names(home)).toEqual(['~/project']);
  });

  it('stops at its time budget and says the list is partial', async () => {
    const home = tempDir('petal-home-');
    for (let i = 0; i < 40; i++) for (let j = 0; j < 20; j++) fs.mkdirSync(path.join(home, `d${i}`, `e${j}`, 'f'), { recursive: true });
    const started = Date.now();
    const result = await scanRepos({ root: home, timeBudgetMs: 1, concurrency: 1 });
    expect(result.truncated).toBe(true);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('writes nothing inside the scanned tree', async () => {
    const home = tempDir('petal-home-');
    const repo = makeRepo(home, 'Code/r');
    const before = fs.readdirSync(path.join(repo, '.git')).sort();
    const mtime = fs.statSync(path.join(repo, '.git', 'HEAD')).mtimeMs;
    await scanRepos({ root: home });
    expect(fs.readdirSync(path.join(repo, '.git')).sort()).toEqual(before);
    expect(fs.statSync(path.join(repo, '.git', 'HEAD')).mtimeMs).toBe(mtime);
  });
});

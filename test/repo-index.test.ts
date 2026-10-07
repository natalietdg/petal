import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as repoIndex from '../src/main/repo-index';
import { buildCdCommand, findIndexed, planRepoOpen, type RepoIndex } from '../src/main/repo-index';
import { removeTempDirs, tempDir, tmpLeftovers, useTempUserData } from './helpers';

const index = (paths: string[]): RepoIndex => ({
  root: '/Users/n',
  scannedAt: 1,
  durationMs: 1,
  truncated: false,
  repos: paths.map((p) => ({ name: path.basename(p), path: p, shortPath: p.replace('/Users/n', '~'), branch: 'main', modifiedMs: 1 })),
});

describe('Open Repo path validation', () => {
  const indexed = index(['/Users/n/Code/petal', "/Users/n/Code/it's here"]);

  it('opens only a path the scan found, using the indexed path', () => {
    expect(findIndexed(indexed, '/Users/n/Code/petal')?.name).toBe('petal');
    expect(planRepoOpen(indexed, '/Users/n/Code/petal', false)).toEqual({ command: "cd '/Users/n/Code/petal'\r", newTab: false });
  });

  it('rejects anything else: unknown, near-miss, traversal, non-string, no index', () => {
    for (const requested of ['/etc', '/Users/n/Code/petal/', '/Users/n/Code/petal/../../..', '/Users/n/Code', 42, null, { path: '/Users/n/Code/petal' }]) {
      expect(planRepoOpen(indexed, requested, false)).toHaveProperty('note');
    }
    expect(planRepoOpen(null, '/Users/n/Code/petal', false)).toHaveProperty('note');
  });

  it('goes to a new tab when Claude is running in this one', () => {
    expect(planRepoOpen(indexed, '/Users/n/Code/petal', true)).toMatchObject({ newTab: true });
  });
});

describe('buildCdCommand', () => {
  let dir = '';
  beforeEach(() => { dir = tempDir('petal-quote-'); });
  afterEach(removeTempDirs);

  it('single-quotes the path and submits with \\r', () => {
    expect(buildCdCommand("/a/it's $HOME `x`")).toBe("cd '/a/it'\\''s $HOME `x`'\r");
  });

  // The real shell: a hostile folder name lands in that folder and runs nothing.
  it('survives a real shell with quotes, spaces, $ and backticks in the name', () => {
    const hostile = path.join(dir, "it's a $(touch pwned) `touch pwned2`; repo");
    fs.mkdirSync(hostile);
    const line = buildCdCommand(hostile).replace(/\r$/, '');
    const out = execFileSync('/bin/sh', ['-c', `${line} && pwd -P`], { cwd: dir }).toString().trim();
    expect(out).toBe(fs.realpathSync(hostile));
    expect(fs.existsSync(path.join(dir, 'pwned'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'pwned2'))).toBe(false);
  });
});

// Snapshot mode points the index at <PASTEL_SNAPSHOT_DIR>/fake-home, so this never scans the real home.
describe('repo index cache', () => {
  let saved: NodeJS.ProcessEnv;
  beforeEach(() => { saved = { ...process.env }; });
  afterEach(() => {
    process.env = saved;
    removeTempDirs();
  });

  it('scans the fake home, writes <userData>/repos.json, and serves it from cache', async () => {
    const userData = useTempUserData();
    const outDir = tempDir('petal-snap-');
    process.env.PASTEL_SNAPSHOT = '1';
    process.env.PASTEL_SNAPSHOT_DIR = outDir;
    const gitDir = path.join(outDir, 'fake-home', 'Code', 'demo', '.git');
    fs.mkdirSync(gitDir, { recursive: true });
    fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');

    expect(repoIndex.scanRoot()).toBe(path.join(outDir, 'fake-home'));
    const scanned = await repoIndex.refresh();
    expect(scanned.repos.map((r) => r.shortPath)).toEqual(['~/Code/demo']);
    const onDisk = JSON.parse(fs.readFileSync(path.join(userData, 'repos.json'), 'utf8')) as RepoIndex;
    expect(onDisk.repos[0]?.branch).toBe('main');
    expect(tmpLeftovers(userData)).toEqual([]);
    expect(repoIndex.current()?.scannedAt).toBe(scanned.scannedAt);

    repoIndex.refreshIfStale(scanned.scannedAt + 60_000); // a minute later: fresh, no rescan
    expect(repoIndex.isScanning()).toBe(false);
    repoIndex.refreshIfStale(scanned.scannedAt + 11 * 60_000); // past 10 minutes: rescans in the background
    expect(repoIndex.isScanning()).toBe(true);
    await repoIndex.refresh(); // joins the running scan
    expect(repoIndex.isScanning()).toBe(false);
  });
});

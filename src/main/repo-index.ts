// The repo index behind Open Repo: the last scan of her home folder, kept in <userData>/repos.json.
// Reads answer from the cache at once and start a background rescan when it is older than 10 minutes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import { writeJsonAtomic } from './atomic-file';
import { isSnapshotRun, snapshotOutDir } from './snapshot-mode';
import { scanRepos, type RepoEntry } from './repo-scan';
import { shellQuote } from './resume-command';

export interface RepoIndex {
  root: string;
  scannedAt: number;
  durationMs: number;
  truncated: boolean;
  repos: RepoEntry[];
}

const STALE_AFTER_MS = 10 * 60 * 1000;

const indexFile = () => path.join(app.getPath('userData'), 'repos.json');
// Snapshot runs index a scratch fake home the harness builds, never hers.
export const scanRoot = (): string => (isSnapshotRun() ? path.join(snapshotOutDir(), 'fake-home') : os.homedir());

let cached: RepoIndex | null = null;
let running: Promise<RepoIndex> | null = null;

function readIndexFile(root: string): RepoIndex | null {
  try {
    const data = JSON.parse(fs.readFileSync(indexFile(), 'utf8')) as RepoIndex;
    return data.root === root && Array.isArray(data.repos) && typeof data.scannedAt === 'number' ? data : null;
  } catch {
    return null;
  }
}

export function current(): RepoIndex | null {
  const root = scanRoot();
  if (cached?.root !== root) cached = readIndexFile(root);
  return cached;
}

// One scan at a time: a second caller joins the scan already running.
export function refresh(): Promise<RepoIndex> {
  running ??= (async () => {
    const root = scanRoot();
    const scan = await scanRepos({ root });
    const next: RepoIndex = { root, scannedAt: Date.now(), ...scan };
    writeJsonAtomic(indexFile(), next);
    cached = next;
    return next;
  })().finally(() => { running = null; });
  return running;
}

export const isScanning = (): boolean => running !== null;

export function refreshIfStale(now = Date.now()): void {
  const index = current();
  if (index && now - index.scannedAt < STALE_AFTER_MS) return;
  refresh().catch((error: Error) => console.error('[petal] repo scan failed:', error));
}

// Only a folder the scan itself found can be opened; the renderer's string is never trusted.
export const findIndexed = (index: RepoIndex | null, requested: unknown): RepoEntry | null =>
  typeof requested === 'string' ? index?.repos.find((repo) => repo.path === requested) ?? null : null;

export const buildCdCommand = (dir: string): string => `cd ${shellQuote(dir)}\r`;

export type RepoOpenPlan = { note: string } | { command: string; newTab: boolean };

// Typed into this tab's shell, or into a new tab's when Claude is running here (it would read the line as a prompt).
export function planRepoOpen(index: RepoIndex | null, requested: unknown, claudeLive: boolean): RepoOpenPlan {
  const repo = findIndexed(index, requested);
  if (!repo) return { note: 'That folder isn’t in the repo index. Reopen the list to rescan.' };
  return { command: buildCdCommand(repo.path), newTab: claudeLive };
}

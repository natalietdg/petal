// The repo index behind Open Repo: the last scan of the home folder, kept in <userData>/repos.json.
// Reads answer from the cache at once and start a background rescan when it is older than 10 minutes.
// The launch scan waits for the Claude folder answer, so a fresh Mac sees no folder prompts unasked; opening the palette scans either way.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import { writeJsonAtomic } from './atomic-file';
import { fakeHomeDir, isSnapshotRun } from './snapshot-mode';
import { claudeFolderAllowed } from './claude-folder';
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
export const scanRoot = (): string => (isSnapshotRun() ? fakeHomeDir() : os.homedir());

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

// The palette calls this when she opens it; the repo scan never reads ~/.claude, so it needs no folder answer.
export function refreshIfStale(now = Date.now()): void {
  const index = current();
  if (index && now - index.scannedAt < STALE_AFTER_MS) return;
  refresh().catch((error: Error) => console.error('[petal] repo scan failed:', error));
}

// On launch, before she has asked for anything: only with the folder allowed.
export function refreshOnLaunch(): void {
  if (claudeFolderAllowed()) refreshIfStale();
}

// Only a folder the scan itself found can be opened; the renderer's string is never trusted.
export const findIndexed = (index: RepoIndex | null, requested: unknown): RepoEntry | null =>
  typeof requested === 'string' ? index?.repos.find((repo) => repo.path === requested) ?? null : null;

export const buildCdCommand = (dir: string): string => `cd ${shellQuote(dir)}\r`;

export type RepoOpenPlan = { note: string } | { command: string; newTab: boolean };

// Where Add Session's new claude starts. 'pick' leaves the folder dialog to the caller; a repo must be one the scan found.
export type RepoStartPlan = { note: string } | { cwd: string } | 'pick';
export function planRepoStart(index: RepoIndex | null, target: unknown, home: string): RepoStartPlan {
  const kind = typeof target === 'object' && target !== null ? (target as { kind?: unknown }).kind : undefined;
  if (kind === 'home') return { cwd: home };
  if (kind === 'pick') return 'pick';
  if (kind !== 'repo') return { note: 'Nothing chosen.' };
  const repo = findIndexed(index, (target as { path?: unknown }).path);
  return repo ? { cwd: repo.path } : { note: 'That folder isn’t in the repo index. Reopen the list to rescan.' };
}

// Typed into this tab's shell, or into a new tab's when Claude is running here (it would read the line as a prompt).
export function planRepoOpen(index: RepoIndex | null, requested: unknown, claudeLive: boolean): RepoOpenPlan {
  const repo = findIndexed(index, requested);
  if (!repo) return { note: 'That folder isn’t in the repo index. Reopen the list to rescan.' };
  return { command: buildCdCommand(repo.path), newTab: claudeLive };
}

// Which project a folder or a Claude run belongs to. A project is a git repo root other than the home folder,
// so a tab sitting in ~ shows a project picker, and Claude's runs are filed under the repo they ran in.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cdTarget, type PipelineRun } from '../shared/testing';

// The repo root at or above a folder, else the folder itself; the walk stops at the home folder.
export function repoRoot(cwd: string): string {
  const stop = os.homedir();
  for (let dir = cwd; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    if (dir === stop || path.dirname(dir) === dir) return cwd;
  }
}

// A folder's project, or null for the home folder and anything outside a repo.
export function projectRootOf(dir: string | null | undefined): string | null {
  if (!dir || !path.isAbsolute(dir)) return null;
  const root = repoRoot(path.resolve(dir));
  if (root === os.homedir() || !fs.existsSync(path.join(root, '.git'))) return null;
  return root;
}

const expandHome = (dir: string): string => (dir === '~' ? os.homedir() : dir.startsWith('~/') ? path.join(os.homedir(), dir.slice(2)) : dir.replace(/^\$HOME(?=\/|$)/, os.homedir()));

// Where a command ran: its leading "cd", resolved against Claude's folder at the time, else that folder.
export function ranIn(command: string, cwd: string | null | undefined): string | null {
  const target = cdTarget(command);
  if (!target) return cwd ?? null;
  const dir = expandHome(target);
  if (path.isAbsolute(dir)) return path.resolve(dir);
  return cwd ? path.resolve(cwd, dir) : null;
}

// The project a Claude run belongs to; null when it ran outside any repo or its folder is unknown.
export const runProject = (run: Pick<PipelineRun, 'stages' | 'cwd'>): string | null =>
  projectRootOf(ranIn(run.stages[0]?.command ?? '', run.cwd));

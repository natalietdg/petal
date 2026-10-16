// "<repo> · <branch>" for a Claude session's cwd, shown at the top of the reader. Read-only.
import fs from 'node:fs';
import path from 'node:path';
import { branchFromHead, gitDirFromPointer } from './repo-scan';

// The git dir for a folder that has a .git folder or a .git pointer file, else null.
function gitDirAt(dir: string): string | null {
  const dotGit = path.join(dir, '.git');
  try {
    return fs.statSync(dotGit).isDirectory() ? dotGit : gitDirFromPointer(dir, fs.readFileSync(dotGit, 'utf8'));
  } catch {
    return null;
  }
}

const readHead = (gitDir: string): string => {
  try {
    return fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8');
  } catch {
    return '';
  }
};

// Walks up from cwd to the git toplevel; outside git it is just the folder's name.
export function repoLabel(cwd: string | null | undefined): string | null {
  if (!cwd) return null;
  const start = path.resolve(cwd);
  for (let dir = start; ; dir = path.dirname(dir)) {
    const gitDir = gitDirAt(dir);
    if (gitDir) {
      const branch = branchFromHead(readHead(gitDir));
      return branch ? `${path.basename(dir)} · ${branch}` : path.basename(dir);
    }
    if (path.dirname(dir) === dir) return path.basename(start) || start;
  }
}

// The git toplevel at or above cwd (a worktree's own folder), or null outside git.
export function repoRoot(cwd: string | null | undefined): string | null {
  if (!cwd) return null;
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    if (gitDirAt(dir)) return dir;
    if (path.dirname(dir) === dir) return null;
  }
}

// The branch checked out at cwd's repo, or null outside git (or on an unreadable HEAD).
export function repoBranch(cwd: string | null | undefined): string | null {
  const root = repoRoot(cwd);
  const gitDir = root ? gitDirAt(root) : null;
  return gitDir ? branchFromHead(readHead(gitDir)) : null;
}

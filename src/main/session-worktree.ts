// A new worktree for an interactive session: ~/.petal/worktrees/<repoKey>/<name> on a new branch from main (#601, #838).
import fs from 'node:fs';
import path from 'node:path';
import { git, mainBranchOf, worktreesRoot } from './factory-jobs-store';
import { worktreeBranch } from '../shared/session-worktree';

const tryGit = (cwd: string, args: readonly string[]): string | null => { try { return git(cwd, args); } catch { return null; } };

// The folder to start Claude in, or a note saying why there is none.
export function createSessionWorktree(cwd: string, name: string): { cwd: string } | { note: string } {
  const top = tryGit(cwd, ['rev-parse', '--show-toplevel']);
  if (!top) return { note: 'A new worktree needs a git repo. Pick a repo, or untick New worktree.' };
  const common = tryGit(top, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const repo = common ? path.dirname(common) : top; // from inside a worktree, branch off the main checkout
  const folder = path.join(worktreesRoot(repo), name);
  const branch = worktreeBranch(name);
  if (fs.existsSync(folder)) return { note: `A worktree named ${name} already exists. Pick another name.` };
  if (tryGit(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])) return { note: `The branch ${branch} already exists. Pick another name.` };
  fs.mkdirSync(path.dirname(folder), { recursive: true });
  try {
    git(repo, ['worktree', 'add', '-b', branch, '--', folder, mainBranchOf(repo)]);
  } catch (error) {
    return { note: `Couldn’t make the worktree: ${(error as Error).message.split('\n')[0]}` };
  }
  return { cwd: folder };
}

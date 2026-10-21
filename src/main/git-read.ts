// Read-only git lookups in a local repo: which commit a ref names. Never fetches, so it is only as fresh as the clone.
import { execFile } from 'node:child_process';
import fs from 'node:fs';

const TIMEOUT_MS = 5000;
const FRESH_MS = 15_000; // the PRs tab asks per reply update; one git call per ref per 15 s is plenty
const MAIN_REFS = ['origin/main', 'main', 'origin/master', 'master'];
const recent = new Map<string, { at: number; sha: Promise<string | null> }>();

function gitRevParse(dir: string, ref: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: dir, timeout: TIMEOUT_MS, encoding: 'utf8' }, (error, stdout) => {
      resolve(error ? null : stdout.trim() || null);
    });
  });
}

export function revParse(dir: string, ref: string, now = Date.now()): Promise<string | null> {
  const key = `${dir}\n${ref}`;
  const hit = recent.get(key);
  if (hit && now - hit.at < FRESH_MS) return hit.sha;
  const sha = gitRevParse(dir, ref);
  recent.set(key, { at: now, sha });
  return sha;
}

export const isFolder = (dir: string | null): dir is string => {
  try { return Boolean(dir) && fs.statSync(dir as string).isDirectory(); } catch { return false; }
};

// The main branch's commit as this clone knows it; null when the folder is gone or has no main.
export async function mainSha(dir: string | null): Promise<string | null> {
  if (!isFolder(dir)) return null;
  for (const ref of MAIN_REFS) {
    const sha = await revParse(dir, ref);
    if (sha) return sha;
  }
  return null;
}

// A PR branch's head: the remote copy first (what was pushed), then the local branch.
export async function branchHead(dir: string | null, branch: string | null): Promise<string | null> {
  if (!isFolder(dir) || !branch || branch.startsWith('-')) return null;
  return (await revParse(dir, `origin/${branch}`)) ?? revParse(dir, branch);
}

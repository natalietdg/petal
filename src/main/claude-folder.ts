// The one gate on the Claude folder (~/.claude, or $CLAUDE_CONFIG_DIR): nothing in Petal reads there until she allows it (config claudeFolder.choice).
// Readers take their path from allowedClaudeHome(), or ask claudeFolderAllowed() first; test/claude-folder-gate.test.ts holds them to it.
import os from 'node:os';
import path from 'node:path';
import * as configStore from './config-store';
import { folderFixture, isSnapshotRun } from './snapshot-mode';

// Claude Code's own rule: $CLAUDE_CONFIG_DIR when set, else ~/.claude. A relative value has no fixed meaning
// (it would follow each claude's cwd), so it is ignored. A folder that doesn't exist yet is still the one: claude creates it.
export function resolveClaudeHome(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string {
  const fallback = path.join(home, '.claude');
  const configured = env.CLAUDE_CONFIG_DIR;
  if (!configured) return fallback;
  if (!path.isAbsolute(configured)) {
    console.warn(`[petal] CLAUDE_CONFIG_DIR=${configured} is not an absolute path; using ${fallback}`);
    return fallback;
  }
  return path.normalize(configured);
}

let resolved: string | null = null; // the environment Petal launched with doesn't change

// The folder itself; snapshot runs may point it at a stand-in.
export const claudeHome = (): string => (isSnapshotRun() && folderFixture.home) || (resolved ??= resolveClaudeHome());

let allowed: boolean | null = null; // cached; every save refreshes it
configStore.onChange((config) => { allowed = config.claudeFolder.choice === 'allowed'; });

// An unreadable config counts as not allowed.
export function claudeFolderAllowed(): boolean {
  if (allowed !== null) return allowed;
  try {
    allowed = configStore.load().claudeFolder.choice === 'allowed';
  } catch {
    return false;
  }
  return allowed;
}

// The Claude folder when she allowed reading it, otherwise null.
export const allowedClaudeHome = (): string | null => (claudeFolderAllowed() ? claudeHome() : null);

// A project's own Claude folder (<cwd>/.claude): a path only; slash-ipc.ts reads it behind the same gate.
export const projectClaudeDir = (cwd: string): string => path.join(cwd, '.claude');

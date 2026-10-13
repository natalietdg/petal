// The one gate on ~/.claude: nothing in Petal reads there until she allows it (config claudeFolder.choice).
// Readers take their path from allowedClaudeHome(), or ask claudeFolderAllowed() first; test/claude-folder-gate.test.ts holds them to it.
import os from 'node:os';
import path from 'node:path';
import * as configStore from './config-store';
import { folderFixture, isSnapshotRun } from './snapshot-mode';

// The folder itself; snapshot runs may point it at a stand-in.
export const claudeHome = (): string => (isSnapshotRun() && folderFixture.home) || path.join(os.homedir(), '.claude');

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

// ~/.claude when she allowed reading it, otherwise null.
export const allowedClaudeHome = (): string | null => (claudeFolderAllowed() ? claudeHome() : null);

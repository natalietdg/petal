// What Petal types to start claude in a tab: `claude` when the tab's shell finds it, else its full path, plus a PATH tip.
// An rc file that sets PATH outright drops the install folder the pty added, so a typed `claude` would not be found.
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { claudePath } from './claude-cli';
import { shellEnv } from './shell-env';
import { isSnapshotRun } from './snapshot-mode';
import { shellQuote } from './resume-command';
import { pathTipFor, type PathTip } from '../shared/claude-setup-hints';

export interface ClaudeLaunch {
  command: string; // the command word, already quoted for the shell
  tip: PathTip | null; // set when the shell can't find claude on its own
}

const PROBE_TIMEOUT_MS = 5000;
const MARK = '__petal_claude__'; // rc files may print anything; only the marked line is read
const PLAIN: ClaudeLaunch = { command: 'claude', tip: null };
let cached: Promise<ClaudeLaunch> | null = null;

// The tab's shell as an interactive login shell (so .zshrc runs too) with the tab's env: true when it resolves `claude`.
// null when it can't tell (timeout, no marker), which keeps the plain `claude`.
export function parseProbe(stdout: string): boolean | null {
  const line = stdout.split('\n').find((l) => l.startsWith(MARK));
  return line === undefined ? null : line.slice(MARK.length).trim() !== '';
}

export function shellFindsClaude(): Promise<boolean | null> {
  const shell = process.env.SHELL || '/bin/zsh';
  const script = `printf '\\n${MARK}%s\\n' "$(command -v claude)"`;
  return new Promise((resolve) => {
    execFile(shell, ['-ilc', script], { env: shellEnv(), cwd: os.homedir(), encoding: 'utf8', timeout: PROBE_TIMEOUT_MS }, (_error, stdout) => resolve(parseProbe(stdout ?? '')));
  });
}

export function launchFor(claude: string | null, shellFinds: boolean | null, shell: string | undefined): ClaudeLaunch {
  if (!claude || shellFinds !== false) return PLAIN;
  return { command: shellQuote(claude), tip: pathTipFor(path.dirname(claude), shell) };
}

// Cached for the app's life; recheck looks again (after an install).
export function claudeLaunch({ recheck = false }: { recheck?: boolean } = {}): Promise<ClaudeLaunch> {
  if (isSnapshotRun()) return Promise.resolve(PLAIN); // snapshot runs type stand-ins, never a real claude
  if (recheck) cached = null;
  cached ??= (async () => {
    const claude = await claudePath({ recheck });
    return launchFor(claude, claude ? await shellFindsClaude() : null, process.env.SHELL);
  })();
  return cached;
}

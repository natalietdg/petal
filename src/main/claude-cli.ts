// One-shot calls to the local Claude CLI (Haiku unless told otherwise, no tools, no saved session), shared by flows and the organizer.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TIMEOUT_MS = 90_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
// Where Claude Code usually lands: the native installer, Homebrew, npm globals.
const CANDIDATES = [
  path.join(os.homedir(), '.local', 'bin', 'claude'),
  path.join(os.homedir(), '.claude', 'local', 'claude'),
  '/opt/homebrew/bin/claude',
  '/usr/local/bin/claude',
  path.join(os.homedir(), '.npm-global', 'bin', 'claude'),
];
const LOGIN_SHELL_TIMEOUT_MS = 5000;
let resolved: Promise<string | null> | null = null;

// Asks her login shell; async so a slow rc file never blocks the main process.
function fromLoginShell(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(process.env.SHELL || '/bin/zsh', ['-lc', 'command -v claude'], { encoding: 'utf8', timeout: LOGIN_SHELL_TIMEOUT_MS }, (error, stdout) => {
      const found = error ? '' : stdout.trim();
      resolve(found && fs.existsSync(found) ? found : null);
    });
  });
}

// Finds `claude` for whoever runs Petal: known install spots first, then their login shell's PATH. Cached; recheck looks again.
export function claudePath({ recheck = false }: { recheck?: boolean } = {}): Promise<string | null> {
  if (recheck) resolved = null;
  resolved ??= (async () => CANDIDATES.find((file) => fs.existsSync(file)) ?? fromLoginShell())();
  return resolved;
}

// Same env hygiene as the pty: a nested claude must not inherit this app's CLAUDE*/ELECTRON_* vars.
export function cleanEnv(claude: string | null): NodeJS.ProcessEnv {
  const dir = claude ? `${path.dirname(claude)}:` : '';
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${dir}${process.env.PATH ?? '/usr/bin:/bin'}` };
  for (const key of Object.keys(env)) if (/^(ELECTRON_|CLAUDE)/.test(key)) delete env[key];
  return env;
}

export async function runClaude(input: string, { model = 'haiku' }: { model?: string } = {}): Promise<string> {
  const claude = await claudePath();
  if (!claude) throw new Error('Claude Code is not installed (no `claude` command found).');
  return new Promise((resolve, reject) => {
    const args = ['-p', '--model', model, '--no-session-persistence', '--output-format', 'json', '--tools', ''];
    const child = execFile(claude, args, { env: cleanEnv(claude), timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, cwd: os.tmpdir() },
      (error, stdout) => (error ? reject(error) : resolve(stdout)));
    child.stdin?.end(input);
  });
}

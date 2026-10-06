// One-shot calls to the local Claude CLI (Haiku unless told otherwise, no tools, no saved session), shared by flows and the organizer.
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TIMEOUT_MS = 90_000;
// Where Claude Code usually lands: the native installer, Homebrew, npm globals.
const CANDIDATES = [
  path.join(os.homedir(), '.local', 'bin', 'claude'),
  path.join(os.homedir(), '.claude', 'local', 'claude'),
  '/opt/homebrew/bin/claude',
  '/usr/local/bin/claude',
  path.join(os.homedir(), '.npm-global', 'bin', 'claude'),
];
let resolved: string | null | undefined;

// Finds `claude` for whoever runs Petal: known install spots first, then their login shell's PATH. Cached.
export function claudePath(): string | null {
  if (resolved !== undefined) return resolved;
  resolved = CANDIDATES.find((file) => fs.existsSync(file)) ?? null;
  if (!resolved) {
    try {
      const found = execFileSync(process.env.SHELL || '/bin/zsh', ['-lc', 'command -v claude'], { encoding: 'utf8', timeout: 5000 }).trim();
      resolved = found && fs.existsSync(found) ? found : null;
    } catch {
      resolved = null;
    }
  }
  return resolved;
}

// Same env hygiene as the pty: a nested claude must not inherit this app's CLAUDE*/ELECTRON_* vars.
export function cleanEnv(claude: string | null = claudePath()): NodeJS.ProcessEnv {
  const dir = claude ? `${path.dirname(claude)}:` : '';
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${dir}${process.env.PATH ?? '/usr/bin:/bin'}` };
  for (const key of Object.keys(env)) if (/^(ELECTRON_|CLAUDE)/.test(key)) delete env[key];
  return env;
}

export function runClaude(input: string, { model = 'haiku' }: { model?: string } = {}): Promise<string> {
  const claude = claudePath();
  if (!claude) return Promise.reject(new Error('Claude Code is not installed (no `claude` command found).'));
  return new Promise((resolve, reject) => {
    const args = ['-p', '--model', model, '--no-session-persistence', '--output-format', 'json', '--tools', ''];
    const child = execFile(claude, args, { env: cleanEnv(claude), timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, cwd: os.tmpdir() },
      (error, stdout) => (error ? reject(error) : resolve(stdout)));
    child.stdin?.end(input);
  });
}

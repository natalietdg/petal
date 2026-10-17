// One-shot calls to the local Claude CLI (Haiku unless told otherwise, no tools, no saved session), shared by flows and the organizer.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { claudeHome } from './claude-folder';
import { recordCall } from './background-calls';

const TIMEOUT_MS = 90_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
// Where Claude Code usually lands: the native installer, Homebrew, npm globals.
const CANDIDATES = [
  path.join(os.homedir(), '.local', 'bin', 'claude'),
  path.join(claudeHome(), 'local', 'claude'), // an install spot: only its existence is checked, never read
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

// The folder of a claude at a known install spot, read synchronously for the pty's env; null when none is there.
export function installedClaudeDir(): string | null {
  const found = CANDIDATES.find((file) => fs.existsSync(file));
  return found ? path.dirname(found) : null;
}

// PATH with the install folder added last, so a fresh native install (~/.local/bin, not yet on her PATH) still runs `claude`.
export function pathWithClaudeDir(current: string | undefined, dir: string | null): string {
  const base = current || '/usr/bin:/bin';
  if (!dir || base.split(':').includes(dir)) return base;
  return `${base}:${dir}`;
}

// Finds `claude` for whoever runs Petal: known install spots first, then their login shell's PATH. Cached; recheck looks again.
export function claudePath({ recheck = false }: { recheck?: boolean } = {}): Promise<string | null> {
  if (recheck) resolved = null;
  resolved ??= (async () => CANDIDATES.find((file) => fs.existsSync(file)) ?? fromLoginShell())();
  return resolved;
}

// A nested claude must not inherit this app's ELECTRON_* or a parent claude's CLAUDE* session vars.
// CLAUDE_CONFIG_DIR stays: it names the folder Petal reads, so the claude it starts must use the same one.
export const dropFromChildEnv = (key: string): boolean => /^(ELECTRON_|CLAUDE)/.test(key) && key !== 'CLAUDE_CONFIG_DIR';

// Same env hygiene as the pty.
export function cleanEnv(claude: string | null): NodeJS.ProcessEnv {
  const dir = claude ? `${path.dirname(claude)}:` : '';
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${dir}${process.env.PATH ?? '/usr/bin:/bin'}` };
  for (const key of Object.keys(env)) if (dropFromChildEnv(key)) delete env[key];
  return env;
}

// model is a CLI alias (haiku, sonnet, opus) or a full model name, passed to --model as is.
export const claudeArgs = (model: string): string[] => ['-p', '--model', model, '--no-session-persistence', '--output-format', 'json', '--tools', ''];

export async function runClaude(input: string, { model = 'haiku' }: { model?: string } = {}): Promise<string> {
  const claude = await claudePath();
  if (!claude) throw new Error('Claude Code is not installed (no `claude` command found).');
  recordCall(); // every call Petal makes on her plan, for Customize's daily count
  return new Promise((resolve, reject) => {
    const args = claudeArgs(model);
    const child = execFile(claude, args, { env: cleanEnv(claude), timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, cwd: os.tmpdir() },
      (error, stdout) => (error ? reject(error) : resolve(stdout)));
    child.stdin?.end(input);
  });
}

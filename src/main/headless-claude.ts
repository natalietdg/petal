// One headless `claude -p` call in a given folder, with the caller's tool limits; returns Claude's answer text.
// No saved session, no MCP servers. Snapshot runs never reach here: callers swap in the harness's stub first.
import { execFile, type ExecFileException } from 'node:child_process';
import { claudePath, cleanEnv } from './claude-cli';
import { recordCall } from './background-calls';

const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
export const NO_SECRETS = ['Read(**/.env*)', 'Read(**/*credentials*)', 'Read(**/*secret*)', 'Read(**/*.pem)', 'Read(**/*.key)', 'Read(**/id_rsa*)'];
// Her own settings can allow every git command; a deny always wins, so writes stay refused whatever they allow.
export const NO_WRITES = [
  'Bash(git push*)', 'Bash(git pull*)', 'Bash(git commit*)', 'Bash(git merge *)', 'Bash(git rebase*)', 'Bash(git reset*)', 'Bash(git revert*)',
  'Bash(git cherry-pick*)', 'Bash(git checkout*)', 'Bash(git switch*)', 'Bash(git restore*)', 'Bash(git stash*)', 'Bash(git add*)', 'Bash(git rm*)',
  'Bash(git clean*)', 'Bash(git am*)', 'Bash(git apply*)', 'Bash(git config*)', 'Bash(git update-ref*)', 'Bash(git branch -d*)', 'Bash(git branch -D*)',
  'Bash(git branch -m*)', 'Bash(git branch -M*)', 'Bash(git tag -a*)', 'Bash(git tag -d*)', 'Bash(git tag -f*)', 'Bash(git tag -s*)',
  'Bash(git tag release*)', 'Bash(git tag v*)', 'Bash(git remote add*)', 'Bash(git remote remove*)', 'Bash(git remote set-url*)',
  'Bash(gh pr create*)', 'Bash(gh pr merge*)', 'Bash(gh pr close*)', 'Bash(gh pr edit*)', 'Bash(gh pr comment*)', 'Bash(gh pr review*)',
  'Bash(gh release create*)', 'Bash(gh release delete*)', 'Bash(gh release edit*)', 'Bash(gh api*)', 'Bash(gh workflow run*)',
  'Bash(gh run rerun*)', 'Bash(gh run cancel*)',
];

export interface HeadlessCall {
  prompt: string; // sent on stdin: --disallowedTools takes every word after it, so a prompt there would be swallowed
  cwd: string;
  model: string;
  tools: string[]; // the built-in tools it may use at all
  allowed: string[]; // tool patterns it may use without asking; anything else is refused, never prompted
  addDirs?: string[];
  system?: string; // appended to Claude Code's own system prompt
  timeoutMs: number;
  label: string; // "The reviewer": starts the error message when it runs too long
}

export const headlessArgs = (call: Omit<HeadlessCall, 'prompt' | 'cwd' | 'timeoutMs' | 'label'>): string[] => [
  '-p', '--model', call.model, '--output-format', 'json', '--no-session-persistence',
  '--tools', call.tools.join(','), '--permission-mode', 'plan', '--strict-mcp-config',
  ...(call.addDirs?.length ? ['--add-dir', ...call.addDirs] : []),
  ...(call.system ? ['--append-system-prompt', call.system] : []),
  '--allowedTools', ...call.allowed,
  '--disallowedTools', ...NO_SECRETS, ...NO_WRITES,
];

// The answer from the CLI's JSON envelope; an error result becomes a plain message.
export function resultText(stdout: string): string {
  let envelope: unknown;
  try { envelope = JSON.parse(stdout); } catch { throw new Error('Claude Code’s reply wasn’t readable.'); }
  const e = envelope as { is_error?: boolean; result?: unknown };
  if (e.is_error || typeof e.result !== 'string') {
    const said = typeof e.result === 'string' && e.result.trim() ? `: ${e.result.trim().slice(0, 200)}` : '.';
    throw new Error(`Claude Code reported an error${said}`);
  }
  return e.result;
}

function plainError(error: ExecFileException, call: HeadlessCall): Error {
  console.warn(`[petal] ${call.label} run failed:`, error);
  if (error.killed && error.signal === 'SIGTERM') return new Error(`${call.label} took longer than ${Math.round(call.timeoutMs / 60_000)} minutes and was stopped.`);
  if (error.code === 'ENOENT') return new Error('Claude Code couldn’t be started from Petal.');
  if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return new Error('The answer was too long to read.');
  return new Error('Claude Code stopped before answering.');
}

export async function runHeadless(call: HeadlessCall): Promise<string> {
  const claude = await claudePath();
  if (!claude) throw new Error('Claude Code isn’t installed, so nothing was checked.');
  recordCall(); // counted with Petal's other background calls
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = execFile(claude, headlessArgs(call), { env: cleanEnv(claude), cwd: call.cwd, timeout: call.timeoutMs, maxBuffer: MAX_OUTPUT_BYTES },
      (error, out) => (error ? reject(plainError(error, call)) : resolve(out)));
    child.stdin?.end(call.prompt);
  });
  return resultText(stdout);
}

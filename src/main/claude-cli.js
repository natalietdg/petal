// One-shot calls to the local Claude CLI (Haiku unless told otherwise, no tools, no saved session), shared by flows and the organizer.
const { execFile, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TIMEOUT_MS = 90_000;
// Where Claude Code usually lands: the native installer, Homebrew, npm globals.
const CANDIDATES = [
  path.join(os.homedir(), '.local', 'bin', 'claude'),
  path.join(os.homedir(), '.claude', 'local', 'claude'),
  '/opt/homebrew/bin/claude',
  '/usr/local/bin/claude',
  path.join(os.homedir(), '.npm-global', 'bin', 'claude'),
];
let resolved;

// Finds `claude` for whoever runs Petal: known install spots first, then their login shell's PATH. Cached.
function claudePath() {
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
function cleanEnv(claude = claudePath()) {
  const dir = claude ? `${path.dirname(claude)}:` : '';
  const env = { ...process.env, PATH: `${dir}${process.env.PATH ?? '/usr/bin:/bin'}` };
  for (const key of Object.keys(env)) if (/^(ELECTRON_|CLAUDE)/.test(key)) delete env[key];
  return env;
}

function runClaude(input, { model = 'haiku' } = {}) {
  const claude = claudePath();
  if (!claude) return Promise.reject(new Error('Claude Code is not installed (no `claude` command found).'));
  return new Promise((resolve, reject) => {
    const args = ['-p', '--model', model, '--no-session-persistence', '--output-format', 'json', '--tools', ''];
    const child = execFile(claude, args, { env: cleanEnv(claude), timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, cwd: os.tmpdir() },
      (error, stdout) => (error ? reject(error) : resolve(stdout)));
    child.stdin.end(input);
  });
}

module.exports = { runClaude, cleanEnv, claudePath };

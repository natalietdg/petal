const os = require('node:os');
const pty = require('node-pty');

function shellEnv() {
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
  // Finder-launched apps get no locale; without it zsh and claude mangle unicode.
  if (!env.LANG) env.LANG = 'en_US.UTF-8';
  // Drop Electron internals, Apple Terminal's session restore, and a parent claude's session
  // vars (launched from inside Claude Code, the pty's claude would otherwise act as its child).
  for (const key of Object.keys(env)) {
    if (/^(ELECTRON_|CLAUDE)/.test(key) || key === 'TERM_SESSION_ID') delete env[key];
  }
  env.TERM_PROGRAM = 'Petal';
  return env;
}

function spawnShell({ cols, rows }) {
  const shell = process.env.SHELL || '/bin/zsh';
  return pty.spawn(shell, ['-l'], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: os.homedir(),
    env: shellEnv(),
  });
}

module.exports = { spawnShell };

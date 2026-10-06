import os from 'node:os';
import * as pty from 'node-pty';
import type { IPty } from 'node-pty';
import type { TermSize } from '../shared/types';

function shellEnv(): Record<string, string> {
  const env: Record<string, string | undefined> = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
  // Finder-launched apps get no locale; without it zsh and claude mangle unicode.
  if (!env.LANG) env.LANG = 'en_US.UTF-8';
  // Drop Electron internals, Apple Terminal's session restore, and a parent claude's session
  // vars (launched from inside Claude Code, the pty's claude would otherwise act as its child).
  for (const key of Object.keys(env)) {
    if (/^(ELECTRON_|CLAUDE)/.test(key) || key === 'TERM_SESSION_ID') delete env[key];
  }
  env.TERM_PROGRAM = 'Petal';
  return Object.fromEntries(Object.entries(env).filter((pair): pair is [string, string] => pair[1] !== undefined));
}

export function spawnShell({ cols, rows }: TermSize): IPty {
  const shell = process.env.SHELL || '/bin/zsh';
  return pty.spawn(shell, ['-l'], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: os.homedir(),
    env: shellEnv(),
  });
}

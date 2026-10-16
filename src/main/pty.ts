import os from 'node:os';
import * as pty from 'node-pty';
import type { IPty } from 'node-pty';
import { dropFromChildEnv, installedClaudeDir, pathWithClaudeDir } from './claude-cli';
import { guardedShell, guardsShell } from './snapshot-shell';
import type { TermSize } from '../shared/types';

function shellEnv(): Record<string, string> {
  const env: Record<string, string | undefined> = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
  // Finder-launched apps get no locale; without it zsh and claude mangle unicode.
  if (!env.LANG) env.LANG = 'en_US.UTF-8';
  // Drop Electron internals, Apple Terminal's session restore, and a parent claude's session
  // vars (launched from inside Claude Code, the pty's claude would otherwise act as its child); CLAUDE_CONFIG_DIR stays.
  for (const key of Object.keys(env)) {
    if (dropFromChildEnv(key) || key === 'TERM_SESSION_ID') delete env[key];
  }
  env.PATH = pathWithClaudeDir(env.PATH, installedClaudeDir()); // Petal ticks Install when it sees claude there, so the tab must run it
  env.TERM_PROGRAM = 'Petal';
  return Object.fromEntries(Object.entries(env).filter((pair): pair is [string, string] => pair[1] !== undefined));
}

// Snapshot runs (bar the live-Claude ones) get the stand-in shell, never her login shell.
export function spawnShell({ cols, rows }: TermSize): IPty {
  const standIn = guardsShell() ? guardedShell() : null;
  return pty.spawn(standIn?.file ?? (process.env.SHELL || '/bin/zsh'), standIn?.args ?? ['-l'], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: standIn?.cwd ?? os.homedir(),
    env: { ...shellEnv(), ...standIn?.env },
  });
}

import os from 'node:os';
import * as pty from 'node-pty';
import type { IPty } from 'node-pty';
import { shellEnv } from './shell-env';
import { guardedShell, guardsShell } from './snapshot-shell';
import type { TermSize } from '../shared/types';

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

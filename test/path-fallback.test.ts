// An rc file that sets PATH outright drops claude's folder: Petal types claude's quoted full path and shows the PATH line.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { launchFor, parseProbe } from '../src/main/claude-launch';
import { buildResumeCommand, buildStartCommand } from '../src/main/resume-command';
import { pathTipFor } from '../src/shared/claude-setup-hints';
import { removeTempDirs, tempDir } from './helpers';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  removeTempDirs();
});

describe('the command Petal types', () => {
  it('plain `claude` when the shell finds it, or when Petal could not tell', () => {
    expect(launchFor('/Users/a/.local/bin/claude', true, '/bin/zsh')).toEqual({ command: 'claude', tip: null });
    expect(launchFor('/Users/a/.local/bin/claude', null, '/bin/zsh')).toEqual({ command: 'claude', tip: null });
    expect(launchFor(null, false, '/bin/zsh')).toEqual({ command: 'claude', tip: null });
  });

  it('the quoted full path when the shell cannot find it, spaces and quotes included', () => {
    const odd = "/Users/Jo O'Neil/my tools/bin/claude";
    const { command, tip } = launchFor(odd, false, '/bin/zsh');
    expect(command).toBe(`'/Users/Jo O'\\''Neil/my tools/bin/claude'`);
    expect(buildStartCommand('hi there', command)).toBe(`'/Users/Jo O'\\''Neil/my tools/bin/claude' -- 'hi there'\r`);
    expect(buildResumeCommand('/w d', 'abc', command)).toBe(`cd '/w d' && '/Users/Jo O'\\''Neil/my tools/bin/claude' --resume 'abc'\r`);
    expect(tip).toEqual({ dir: "/Users/Jo O'Neil/my tools/bin", rcFile: '~/.zshrc', line: `export PATH="/Users/Jo O'Neil/my tools/bin:$PATH"` });
  });

  it('defaults keep the plain commands the snapshot harness matches', () => {
    expect(buildStartCommand('x')).toBe("claude -- 'x'\r");
    expect(buildResumeCommand('/w', 's')).toBe("cd '/w' && claude --resume 's'\r");
  });

  it('the PATH line escapes what double quotes would expand, and names the rc file for her shell', () => {
    expect(pathTipFor('/a/$HOME/`x`/"q"\\', '/bin/zsh').line).toBe('export PATH="/a/\\$HOME/\\`x\\`/\\"q\\"\\\\:$PATH"');
    expect(pathTipFor('/a', '/bin/bash').rcFile).toBe('~/.bash_profile');
    expect(pathTipFor('/a', '/opt/homebrew/bin/fish')).toEqual({ dir: '/a', rcFile: '~/.config/fish/config.fish', line: 'fish_add_path "/a"' });
  });
});

describe('the shell probe', () => {
  it('reads only the marked line, whatever the rc files print', () => {
    expect(parseProbe('Welcome!\n\n__petal_claude__/x/claude\n')).toBe(true);
    expect(parseProbe('motd\n__petal_claude__\n')).toBe(false);
    expect(parseProbe('')).toBeNull();
  });

  // A fake HOME with a native install and a .zshrc that resets PATH, as the matrix's zsh-reset cell builds it.
  function fakeHome(rc: string): string {
    const home = tempDir('petal-path-home-');
    fs.mkdirSync(path.join(home, '.local/bin'), { recursive: true });
    fs.writeFileSync(path.join(home, '.local/bin/claude'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    fs.writeFileSync(path.join(home, '.zshrc'), rc);
    fs.writeFileSync(path.join(home, '.zprofile'), '');
    vi.stubEnv('HOME', home);
    vi.stubEnv('SHELL', '/bin/zsh');
    vi.stubEnv('ZDOTDIR', home);
    vi.stubEnv('PATH', '/usr/bin:/bin:/usr/sbin:/sbin');
    return home;
  }

  it.runIf(fs.existsSync('/bin/zsh'))('a .zshrc that sets PATH outright: the tab shell cannot find claude, Petal types its path', async () => {
    const home = fakeHome('export PATH="/usr/bin:/bin:/usr/sbin:/sbin"\n');
    const { claudeLaunch, shellFindsClaude } = await import('../src/main/claude-launch');
    expect(await shellFindsClaude()).toBe(false);
    const launch = await claudeLaunch({ recheck: true });
    expect(launch.command).toBe(`'${home}/.local/bin/claude'`);
    expect(launch.tip?.line).toBe(`export PATH="${home}/.local/bin:$PATH"`);
  });

  it.runIf(fs.existsSync('/bin/zsh'))('a .zshrc that only appends: the folder Petal added survives, plain `claude`', async () => {
    fakeHome('export PATH="$PATH:/opt/extra"\n');
    const { claudeLaunch } = await import('../src/main/claude-launch');
    expect(await claudeLaunch({ recheck: true })).toEqual({ command: 'claude', tip: null });
  });
});

// $CLAUDE_CONFIG_DIR: Petal reads the folder Claude Code uses, and the claude it starts keeps the variable.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { removeTempDirs, tempDir, useTempUserData } from './helpers';

const HOME = '/Users/someone';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  removeTempDirs();
});

describe('resolveClaudeHome', () => {
  it('unset or empty is ~/.claude', async () => {
    const { resolveClaudeHome } = await import('../src/main/claude-folder');
    expect(resolveClaudeHome({}, HOME)).toBe(`${HOME}/.claude`);
    expect(resolveClaudeHome({ CLAUDE_CONFIG_DIR: '' }, HOME)).toBe(`${HOME}/.claude`);
  });

  it('an absolute value is used, normalised', async () => {
    const { resolveClaudeHome } = await import('../src/main/claude-folder');
    expect(resolveClaudeHome({ CLAUDE_CONFIG_DIR: '/Volumes/work/claude-config' }, HOME)).toBe('/Volumes/work/claude-config');
    expect(resolveClaudeHome({ CLAUDE_CONFIG_DIR: '/a//b/../claude/' }, HOME)).toBe('/a/claude/');
  });

  it('a relative value (or an unexpanded ~) falls back to ~/.claude with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { resolveClaudeHome } = await import('../src/main/claude-folder');
    expect(resolveClaudeHome({ CLAUDE_CONFIG_DIR: 'my-claude' }, HOME)).toBe(`${HOME}/.claude`);
    expect(resolveClaudeHome({ CLAUDE_CONFIG_DIR: '~/claude-work' }, HOME)).toBe(`${HOME}/.claude`);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('a folder that does not exist yet is still the one', async () => {
    const { resolveClaudeHome } = await import('../src/main/claude-folder');
    const missing = path.join(tempDir(), 'not-yet');
    expect(resolveClaudeHome({ CLAUDE_CONFIG_DIR: missing }, HOME)).toBe(missing);
  });
});

describe('the gate follows the resolved folder', () => {
  it('reads sessions from $CLAUDE_CONFIG_DIR, only once allowed', async () => {
    vi.resetModules();
    useTempUserData();
    const folder = tempDir('petal-config-dir-');
    fs.mkdirSync(path.join(folder, 'sessions'));
    fs.writeFileSync(path.join(folder, 'sessions', '4242.json'), JSON.stringify({ sessionId: 'aaaaaaaa-0000-4000-8000-000000000001', cwd: '/tmp/x', kind: 'interactive', status: 'idle' }));
    vi.stubEnv('CLAUDE_CONFIG_DIR', folder);
    vi.stubEnv('PASTEL_SNAPSHOT', '');
    const gate = await import('../src/main/claude-folder');
    const session = await import('../src/main/claude-session');
    expect(gate.claudeHome()).toBe(folder);
    expect(gate.allowedClaudeHome()).toBeNull(); // unasked
    expect(session.readSessionFile(4242)).toBeNull();
    const config = await import('../src/main/config-store');
    config.save({ claudeFolder: { choice: 'allowed' } });
    expect(gate.allowedClaudeHome()).toBe(folder);
    expect(session.readSessionFile(4242)?.cwd).toBe('/tmp/x');
  });
});

describe('child env', () => {
  it('keeps CLAUDE_CONFIG_DIR and drops the other CLAUDE* and ELECTRON_* vars', async () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', '/Volumes/work/claude-config');
    vi.stubEnv('CLAUDECODE', '1');
    vi.stubEnv('CLAUDE_CODE_ENTRYPOINT', 'cli');
    vi.stubEnv('ELECTRON_RUN_AS_NODE', '1');
    const { cleanEnv, dropFromChildEnv } = await import('../src/main/claude-cli');
    const env = cleanEnv('/opt/homebrew/bin/claude');
    expect(env.CLAUDE_CONFIG_DIR).toBe('/Volumes/work/claude-config');
    expect(env.CLAUDECODE).toBeUndefined();
    expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(dropFromChildEnv('CLAUDE_CONFIG_DIR')).toBe(false);
    expect(dropFromChildEnv('CLAUDECODE')).toBe(true);
  });

  it('the pty env uses the same rule', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'pty.ts'), 'utf8');
    expect(source).toMatch(/dropFromChildEnv\(key\)/);
    expect(source).not.toMatch(/\^\(ELECTRON_\|CLAUDE\)/);
  });
});

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Reply } from '../src/shared/types';
import { removeTempDirs, tempDir, useTempUserData } from './helpers';

// No real claude lookup: claudePath() would probe the disk and her login shell.
vi.mock('../src/main/claude-cli', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/main/claude-cli')>()),
  claudePath: async () => null,
}));

type Hook = typeof import('../src/main/response-hook');
type ConfigStore = typeof import('../src/main/config-store');

let userData: string;
let work: string;
let hook: Hook;
let config: ConfigStore;
const savedShell = process.env.SHELL;

const reply = (id: string, markdown = 'x'): Reply => ({ id, markdown, timestamp: undefined, prompt: '' });
const finished = (id: string, markdown = 'x', extra: { title?: string; cwd?: string | null; sessionId?: string } = {}) =>
  hook.onReplyFinished({ reply: reply(id, markdown), sessionId: extra.sessionId ?? 's', title: extra.title ?? 't', cwd: extra.cwd === undefined ? work : extra.cwd });

beforeAll(() => {
  process.env.SHELL = '/bin/sh'; // fast, and no dependence on her zsh rc files
});
afterAll(() => {
  if (savedShell === undefined) delete process.env.SHELL;
  else process.env.SHELL = savedShell;
});

beforeEach(async () => {
  userData = useTempUserData();
  work = fs.realpathSync(tempDir('petal-hook-cwd-'));
  delete process.env.PASTEL_SNAPSHOT;
  vi.resetModules();
  hook = await import('../src/main/response-hook');
  config = await import('../src/main/config-store');
});
afterEach(() => {
  delete process.env.PASTEL_SNAPSHOT;
  delete process.env.CLAUDE_LEAK_TEST;
  delete process.env.ELECTRON_LEAK_TEST;
  removeTempDirs();
});

describe('response-hook command contract', () => {
  it('pipes the reply markdown on stdin and sets PETAL_* env, running in the session cwd', async () => {
    const out = path.join(work, 'out.md');
    const env = path.join(work, 'env.txt');
    config.save({ responseHook: { command: `cat > '${out}'; printf '%s\\n%s\\n%s\\n%s\\n%s' "$PETAL_SESSION_ID" "$PETAL_SESSION_TITLE" "$PETAL_CWD" "$PETAL_REPLY_FILE" "$(pwd)" > '${env}'` } });
    const markdown = '**Headline here**\n\nBody with `code` and ünïcode.';
    const run = await finished('reply-uuid-1', markdown, { sessionId: 'sess-1', title: 'My session' });
    expect(run?.exitCode).toBe(0);
    expect(fs.readFileSync(out, 'utf8')).toBe(markdown);
    const [sid, title, cwd, file, pwd] = fs.readFileSync(env, 'utf8').split('\n');
    expect([sid, title, cwd]).toEqual(['sess-1', 'My session', work]);
    expect(fs.realpathSync(pwd)).toBe(work);
    expect(file).toBe(path.join(userData, 'hook', 'reply-uuid-1.md'));
    expect(fs.readFileSync(file, 'utf8')).toBe(markdown);
  });

  it('strips CLAUDE* and ELECTRON_* vars from the command env', async () => {
    process.env.CLAUDE_LEAK_TEST = 'leak';
    process.env.ELECTRON_LEAK_TEST = 'leak';
    const env = path.join(work, 'env.txt');
    config.save({ responseHook: { command: `printf '[%s][%s]' "$CLAUDE_LEAK_TEST" "$ELECTRON_LEAK_TEST" > '${env}'` } });
    expect((await finished('r-env'))?.exitCode).toBe(0);
    expect(fs.readFileSync(env, 'utf8')).toBe('[][]');
  });

  it('falls back to the home dir when the cwd is missing', async () => {
    const pwdFile = path.join(work, 'pwd.txt');
    config.save({ responseHook: { command: `pwd > '${pwdFile}'` } });
    const run = await finished('r2', 'x', { cwd: '/no/such/dir' });
    expect(run?.exitCode).toBe(0);
    expect(fs.realpathSync(fs.readFileSync(pwdFile, 'utf8').trim())).toBe(fs.realpathSync(os.homedir()));
  });

  it('records a non-zero exit and the stderr', async () => {
    config.save({ responseHook: { command: 'echo boom-on-stderr >&2; exit 3' } });
    const run = await finished('r3', 'x', { title: 'fail' });
    expect(run).toMatchObject({ exitCode: 3, stderr: 'boom-on-stderr', timedOut: false, title: 'fail', test: false });
  });

  it('caps stderr at 200 characters', async () => {
    config.save({ responseHook: { command: `head -c 5000 /dev/zero | tr '\\0' e >&2` } });
    const run = await finished('r-stderr');
    expect(run?.stderr).toBe('e'.repeat(200));
  });

  it('a command that ignores a 2 MB stdin does not crash', async () => {
    config.save({ responseHook: { command: 'exit 0' } });
    expect((await finished('r5', 'y'.repeat(2_000_000)))?.exitCode).toBe(0);
  });

  it('sanitises the reply id into a file name inside <userData>/hook', async () => {
    const run = await hook.runCommand('true', { replyId: '../../evil id!', markdown: 'm' });
    expect(run.exitCode).toBe(0);
    expect(fs.readdirSync(path.join(userData, 'hook'))).toEqual(['evilid.md']);
  });

  it('keeps only the newest 20 reply files', async () => {
    for (let i = 0; i < 22; i += 1) await hook.runCommand('true', { replyId: `r-${String(i).padStart(2, '0')}`, markdown: String(i) });
    const files = fs.readdirSync(path.join(userData, 'hook'));
    expect(files).toHaveLength(20);
    expect(files).toContain('r-21.md');
  });

  it('resolves (never rejects) when the reply file cannot be written', async () => {
    fs.writeFileSync(path.join(userData, 'hook'), 'a file where the dir should be');
    const run = await hook.runCommand('true', { replyId: 'r', markdown: 'm' });
    expect(run.exitCode).toBeNull();
    expect(run.stderr).toMatch(/^Could not write the reply file/);
  });
});

describe('response-hook dedupe, notify and gating', () => {
  it('the same reply id never runs twice, and dedupe covers the notification too', async () => {
    config.save({ responseHook: { command: 'true', notify: true } });
    expect((await finished('dup', '**Headline here**\n\nbody', { title: 'My session' }))?.exitCode).toBe(0);
    expect(finished('dup')).toBeNull();
    expect(globalThis.__electronStub.notices).toEqual([{ title: 'My session', body: 'Headline here' }]);
  });

  it('notifies without a command, with a fallback title', () => {
    config.save({ responseHook: { command: '', notify: true } });
    expect(finished('n1', '\n\n# Big *news*', { title: '' })).toBeNull();
    expect(globalThis.__electronStub.notices).toEqual([{ title: 'Claude replied', body: 'Big news' }]);
  });

  it('no notification when notify is off or unsupported', async () => {
    config.save({ responseHook: { command: '', notify: false } });
    finished('n2');
    config.save({ responseHook: { notify: true } });
    globalThis.__electronStub.notificationsSupported = false;
    finished('n3');
    expect(globalThis.__electronStub.notices).toEqual([]);
  });

  it('empty command -> nothing runs', () => {
    expect(finished('r6')).toBeNull();
    expect(hook.recentRuns()).toEqual([]);
  });

  it('a reply without an id is ignored', () => {
    config.save({ responseHook: { command: 'true', notify: true } });
    expect(hook.onReplyFinished({ reply: { id: undefined, markdown: 'x', timestamp: undefined, prompt: '' }, sessionId: 's', title: 't', cwd: null })).toBeNull();
    expect(globalThis.__electronStub.notices).toEqual([]);
  });

  it('keeps a ring buffer of the last 5 runs, newest first, as copies', async () => {
    config.save({ responseHook: { command: 'true' } });
    for (let i = 1; i <= 7; i += 1) await finished(`ring-${i}`, 'x', { title: `run ${i}` });
    const runs = hook.recentRuns();
    expect(runs.map((r) => r.title)).toEqual(['run 7', 'run 6', 'run 5', 'run 4', 'run 3']);
    runs[0].title = 'mutated';
    expect(hook.recentRuns()[0].title).toBe('run 7');
    expect(hook.stats()).toEqual({ skippedInSnapshot: 0, runs: 5 });
  });

  it('Test hook runs the saved command with a sample reply', async () => {
    expect(await hook.test()).toEqual({ skipped: 'no command set' });
    const out = path.join(work, 'out.md');
    config.save({ responseHook: { command: `cat > '${out}'` } });
    const tested = await hook.test();
    expect(tested).toMatchObject({ exitCode: 0, test: true, title: 'Petal test' });
    expect(fs.readFileSync(out, 'utf8')).toContain('response hook works');
  });

  it('snapshot runs never run the hook or the test', async () => {
    config.save({ responseHook: { command: 'true', notify: true } });
    process.env.PASTEL_SNAPSHOT = '1';
    expect(finished('r7')).toBeNull();
    expect(await hook.test()).toEqual({ skipped: 'snapshot run' });
    expect(hook.stats().skippedInSnapshot).toBe(1);
    expect(globalThis.__electronStub.notices).toEqual([]);
  });
});

describe('response-hook timeout', () => {
  it('production timeout is 30s', () => {
    expect(hook.TIMEOUT_MS).toBe(30_000);
  });

  it('kills the whole process group, background child included', async () => {
    const marker = `${(Math.random() * 1000 + 100).toFixed(3)}`; // unique per run, so pgrep only sees ours
    const t0 = Date.now();
    const slow = await hook.runCommand(`sleep ${marker} & wait`, { replyId: 'r4', markdown: 'x', title: 'slow', cwd: work, timeoutMs: 400 });
    expect(slow.timedOut).toBe(true);
    expect(slow.exitCode).toBeNull();
    expect(slow.stderr.startsWith('Timed out after 0.4s')).toBe(true);
    expect(Date.now() - t0).toBeLessThan(5000);
    await new Promise((resolve) => setTimeout(resolve, 300));
    let leftover = '';
    try { leftover = execSync(`pgrep -f "sleep ${marker}"`).toString(); } catch { /* exit 1: nothing found */ }
    expect(leftover).toBe('');
  });

  it('a fast command is not marked timed out', async () => {
    const run = await hook.runCommand('true', { replyId: 'fast', markdown: 'x', timeoutMs: 5000 });
    expect(run).toMatchObject({ exitCode: 0, timedOut: false });
    expect(run.ms).toBeLessThan(5000);
  });
});

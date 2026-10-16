// Claude Code before 2.1.75 writes no sessions/<pid>.json: the reader finds its log by folder and start time.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { allowClaudeFolder, removeTempDirs, tempDir } from './helpers';
import {
  compareVersions, needsUpdate, parseLaunch, parseVersion, pickTranscript, SESSION_FILE_VERSION,
  type FolderClaude, type TranscriptHead,
} from '../src/main/claude-fallback';
import { oldClaudeHint, SHARED_FOLDER_LINE } from '../src/shared/reader-notice';

const ID = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T0 = Date.parse('2026-10-16T09:00:00.000Z');
const min = (n: number) => T0 + n * 60_000;
const NO_LAUNCH = { sessionId: null, resume: null, continued: false };

const claude = (pid: number, startedAt: number, extra: Partial<FolderClaude> = {}): FolderClaude =>
  ({ pid, startedAt, version: null, launch: NO_LAUNCH, claimed: null, ...extra });
const head = (n: number, firstAt: number | null, modifiedAt = firstAt ?? T0, extra: Partial<TranscriptHead> = {}): TranscriptHead =>
  ({ sessionId: ID(n), file: `/p/${ID(n)}.jsonl`, firstAt, modifiedAt, version: null, prompt: null, ...extra });
const picked = (result: ReturnType<typeof pickTranscript>) => (result.kind === 'found' ? result.head.sessionId : result.kind);

describe('version and threshold', () => {
  it('reads the version out of `claude --version`', () => {
    expect(parseVersion('2.1.200 (Claude Code)\n')).toBe('2.1.200');
    expect(parseVersion('not a version')).toBeNull();
  });

  it('compares numerically, not as text', () => {
    expect(compareVersions('2.1.99', '2.1.248')).toBeLessThan(0);
    expect(compareVersions('2.10.0', '2.9.9')).toBeGreaterThan(0);
    expect(compareVersions('2.1.248', '2.1.248')).toBe(0);
  });

  it('hints below 2.1.75 only (2.1.74 is the last without a session file), and never for an unknown version', () => {
    expect(SESSION_FILE_VERSION).toBe('2.1.75');
    expect(needsUpdate('2.1.74')).toBe(true);
    expect(needsUpdate('2.1.0')).toBe(true);
    expect(needsUpdate('1.0.128')).toBe(true);
    expect(needsUpdate('2.1.75')).toBe(false);
    expect(needsUpdate('2.1.200')).toBe(false);
    expect(needsUpdate('2.1.295')).toBe(false);
    expect(needsUpdate(null)).toBe(false);
  });

  it('the hint names the version and the command', () => {
    expect(oldClaudeHint('2.1.200')).toBe('Your Claude Code (2.1.200) is older than Petal needs for the fastest tracking. Run `claude update` in the terminal, then restart Claude.');
    expect(SHARED_FOLDER_LINE).toBe('Two Claude sessions share this folder; pick this tab’s.');
  });
});

describe('claudeVersion', () => {
  afterEach(() => removeTempDirs());

  it('runs `<binary> --version` once and parses it', async () => {
    const { claudeVersion, resetFallbackCaches } = await import('../src/main/claude-fallback');
    resetFallbackCaches();
    const bin = path.join(tempDir(), 'claude');
    const count = `${bin}.count`;
    fs.writeFileSync(bin, `#!/bin/sh\necho x >> "${count}"\necho "2.1.74 (Claude Code)"\n`, { mode: 0o755 });
    expect(await claudeVersion(bin, 'claude')).toBe('2.1.74');
    expect(await claudeVersion(bin, 'claude --continue')).toBe('2.1.74');
    expect(fs.readFileSync(count, 'utf8').trim().split('\n')).toHaveLength(1); // cached per binary
  });

  it('an npm claude that renamed itself hides its script: unknown, never node’s own version', async () => {
    const { claudeVersion } = await import('../src/main/claude-fallback');
    expect(await claudeVersion('/usr/local/bin/node', 'claude')).toBeNull();
    expect(await claudeVersion(null, 'claude')).toBeNull();
  });
});

describe('launch flags', () => {
  it('--resume, -r and --resume= with an id', () => {
    expect(parseLaunch(`claude --resume ${ID(1)}`).resume).toBe(ID(1));
    expect(parseLaunch(`/usr/local/bin/claude -r ${ID(2)} --model opus`).resume).toBe(ID(2));
    expect(parseLaunch(`claude --resume=${ID(3)}`).resume).toBe(ID(3));
  });

  it('a bare --resume is the picker and names nothing', () => {
    expect(parseLaunch('claude --resume').resume).toBeNull();
    expect(parseLaunch('claude --resume --model opus').resume).toBeNull();
  });

  it('--continue, -c and --session-id', () => {
    expect(parseLaunch('claude --continue').continued).toBe(true);
    expect(parseLaunch('claude -c').continued).toBe(true);
    expect(parseLaunch('claude').continued).toBe(false);
    expect(parseLaunch(`claude --session-id ${ID(4)}`).sessionId).toBe(ID(4));
  });
});

describe('pickTranscript', () => {
  it('a log born after the only claude started is its own', () => {
    expect(picked(pickTranscript(1, [claude(1, min(0))], [head(1, min(1))]))).toBe(ID(1));
  });

  it('a log born before it started is not, and nothing yet means none', () => {
    expect(picked(pickTranscript(1, [claude(1, min(5))], [head(1, min(1), min(6))]))).toBe('none');
    expect(picked(pickTranscript(1, [claude(1, min(0))], []))).toBe('none');
  });

  it('after /clear the newest of its own logs wins', () => {
    const heads = [head(1, min(1), min(2)), head(2, min(3), min(4))];
    expect(picked(pickTranscript(1, [claude(1, min(0))], heads))).toBe(ID(2));
  });

  it('two claudes in one folder: the one started first keeps its log, the newer claims the next', () => {
    const claudes = [claude(1, min(0)), claude(2, min(5))];
    const heads = [head(1, min(1), min(9)), head(2, min(6), min(8))];
    expect(picked(pickTranscript(1, claudes, heads))).toBe(ID(1));
    expect(picked(pickTranscript(2, claudes, heads))).toBe(ID(2));
  });

  it('two claudes both without a log: a new log is ambiguous for both, so neither follows it', () => {
    const claudes = [claude(1, min(0)), claude(2, min(1))];
    const heads = [head(1, min(2))];
    const one = pickTranscript(1, claudes, heads);
    expect(one.kind).toBe('ambiguous');
    expect(one.kind === 'ambiguous' && one.candidates.map((c) => c.sessionId)).toEqual([ID(1)]);
    expect(pickTranscript(2, claudes, heads).kind).toBe('ambiguous');
  });

  it('the version that wrote a log settles who owns it', () => {
    const claudes = [claude(1, min(0), { version: '2.1.200' }), claude(2, min(1), { version: '2.1.225' })];
    const heads = [head(1, min(2), min(2), { version: '2.1.200' })];
    expect(picked(pickTranscript(1, claudes, heads))).toBe(ID(1));
    expect(picked(pickTranscript(2, claudes, heads))).toBe('none');
  });

  it('her pick (or a sibling’s session file) claims a log for that claude only', () => {
    const claudes = [claude(1, min(0), { claimed: ID(1) }), claude(2, min(1))];
    const heads = [head(1, min(2)), head(2, min(3))];
    expect(picked(pickTranscript(1, claudes, heads))).toBe(ID(1));
    expect(picked(pickTranscript(2, claudes, heads))).toBe(ID(2));
  });

  it('--resume <id> carries on that older log until a new one is born', () => {
    const claudes = [claude(1, min(10), { launch: { ...NO_LAUNCH, resume: ID(1) } })];
    expect(picked(pickTranscript(1, claudes, [head(1, min(1), min(11)), head(2, min(2))]))).toBe(ID(1));
    expect(picked(pickTranscript(1, claudes, [head(1, min(1), min(11)), head(3, min(12))]))).toBe(ID(3));
  });

  it('--continue carries on the newest log from before it started', () => {
    const claudes = [claude(1, min(10), { launch: { ...NO_LAUNCH, continued: true } })];
    const heads = [head(1, min(1), min(3)), head(2, min(2), min(11)), head(3, null, min(1))];
    expect(picked(pickTranscript(1, claudes, heads))).toBe(ID(2));
  });

  it('an unknown pid has no log', () => {
    expect(picked(pickTranscript(9, [claude(1, min(0))], [head(1, min(1))]))).toBe('none');
  });
});

// Real processes and a real folder: a long-running `sleep` stands in for claude (only its cwd and start time are read).
describe('findFallbackSession', () => {
  let child: ChildProcess | null = null;
  afterEach(() => {
    child?.kill();
    child = null;
    vi.unstubAllEnvs();
    vi.resetModules();
    removeTempDirs();
  });

  async function setup() {
    allowClaudeFolder();
    const home = tempDir('petal-fallback-home-');
    const project = fs.realpathSync(tempDir('petal-fallback-project-'));
    vi.stubEnv('CLAUDE_CONFIG_DIR', home);
    vi.stubEnv('PASTEL_SNAPSHOT', '');
    vi.resetModules();
    child = spawn('/bin/sleep', ['30'], { cwd: project, stdio: 'ignore' });
    await new Promise((resolve) => setTimeout(resolve, 1100)); // ps start times are whole seconds
    const fallback = await import('../src/main/claude-fallback');
    const pid = child.pid ?? 0;
    const processes = [{ pid, ppid: process.pid, comm: 'claude' }];
    return { fallback, home, project, pid, processes, dir: path.join(home, 'projects', project.replace(/[^a-zA-Z0-9]/g, '-')) };
  }

  it('no project folder yet: no session and no notice', async () => {
    const { fallback, pid, processes } = await setup();
    expect(await fallback.findFallbackSession(pid, '/bin/sleep 30', processes, new Map())).toEqual({ session: null, notice: null });
  });

  it('a log written after the process started is followed, with its cwd', async () => {
    const { fallback, pid, processes, dir, project } = await setup();
    fs.mkdirSync(dir, { recursive: true });
    const entry = { parentUuid: null, isSidechain: false, userType: 'external', cwd: project, sessionId: ID(7), version: '2.1.200', type: 'user', message: { role: 'user', content: 'hi' }, uuid: 'u1', timestamp: new Date().toISOString() };
    fs.writeFileSync(path.join(dir, `${ID(7)}.jsonl`), `${JSON.stringify(entry)}\n`);
    const { session } = await fallback.findFallbackSession(pid, '/bin/sleep 30', processes, new Map());
    expect(session).toEqual({ pid, sessionId: ID(7), cwd: project, transcript: path.join(dir, `${ID(7)}.jsonl`) });
  });

  it('reads nothing until she allows the Claude folder', async () => {
    const { fallback, pid, processes, dir } = await setup();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${ID(8)}.jsonl`), `${JSON.stringify({ sessionId: ID(8), type: 'user', message: { content: 'hi' }, timestamp: new Date().toISOString() })}\n`);
    const config = await import('../src/main/config-store');
    config.save({ claudeFolder: { choice: 'declined' } });
    expect((await fallback.findFallbackSession(pid, '/bin/sleep 30', processes, new Map())).session).toBeNull();
  });
});

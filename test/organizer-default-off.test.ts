// With a new user's config, Petal never runs `claude` in the background; spawning is mocked at node:child_process.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListedSession } from '../src/main/history';
import { assistantEntry, removeTempDirs, tempDir, useTempUserData, userEntry, writeJsonl } from './helpers';

const spawned = vi.hoisted(() => ({ calls: [] as { file: string; args: readonly string[] }[], sessions: [] as ListedSession[] }));

vi.mock('node:child_process', () => {
  const reply = JSON.stringify({ result: '{"title":"Labelled","project":"Petal","status":"done","tags":[]}' });
  const execFile = (file: string, args: readonly string[], _options: unknown, callback: (error: Error | null, stdout: string) => void) => {
    spawned.calls.push({ file, args });
    queueMicrotask(() => callback(null, args.includes('-lc') ? process.execPath : reply));
    return { stdin: { end: () => {} } };
  };
  const spawn = (file: string, args: readonly string[]) => { spawned.calls.push({ file, args }); throw new Error('spawn is not expected'); };
  return { execFile, spawn, default: { execFile, spawn } };
});
vi.mock('../src/main/history', () => ({ listSessions: () => spawned.sessions }));

const MINUTE_MS = 60_000;
const claudeRuns = () => spawned.calls.filter((call) => call.args.includes('-p'));

let userData: string;
let organizer: typeof import('../src/main/session-organizer');

beforeEach(async () => {
  vi.useFakeTimers();
  userData = useTempUserData();
  spawned.calls = [];
  const file = writeJsonl(path.join(tempDir(), 'session.jsonl'), [userEntry('tidy me'), assistantEntry('done')]);
  spawned.sessions = [{
    sessionId: 's1', file, cwd: '/work', title: '', firstPrompt: '', lastAt: fs.statSync(file).mtimeMs,
    messages: 2, messagesExact: true, shortCwd: '/work', live: false,
  }];
  vi.resetModules();
  organizer = await import('../src/main/session-organizer');
});

afterEach(() => {
  organizer.stop();
  vi.useRealTimers();
  removeTempDirs();
});

describe('organizer is opt-in', () => {
  it('a new user: starting Petal and waiting an hour runs claude zero times', async () => {
    organizer.start({ openSessionIds: () => [] });
    await vi.advanceTimersByTimeAsync(60 * MINUTE_MS);
    expect(organizer.status().schedule).toEqual({ enabled: false, intervalMinutes: 10 });
    expect(claudeRuns()).toEqual([]);
    expect(fs.existsSync(path.join(userData, 'organizer.json'))).toBe(false);
  });

  it('an existing user with organizer.json keeps the background pass (the mock does catch real calls)', async () => {
    fs.writeFileSync(path.join(userData, 'organizer.json'), '{}');
    organizer.start({ openSessionIds: () => [] });
    await vi.advanceTimersByTimeAsync(21_000);
    await vi.waitFor(() => expect(claudeRuns().length).toBe(1));
    expect(organizer.status().schedule?.enabled).toBe(true);
  });
});

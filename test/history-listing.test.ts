// History's list against realistic Claude folder layouts: odd first lines, huge lines, missing folders, newer shapes.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { allowClaudeFolder, assistantEntry, removeTempDirs, tempDir, toolResultEntry, userEntry, writeJsonl } from './helpers';
import type { TranscriptEntry } from '../src/main/transcript-entry';

const id = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;
const big = (kb: number) => 'x'.repeat(kb * 1024);

afterEach(() => {
  removeTempDirs();
  vi.resetModules();
});

function folder() {
  allowClaudeFolder();
  const home = tempDir('petal-history-');
  const log = (project: string, n: number, entries: (TranscriptEntry | string)[], daysAgo = 0) => {
    const dir = path.join(home, 'projects', project);
    fs.mkdirSync(dir, { recursive: true });
    const file = writeJsonl(path.join(dir, `${id(n)}.jsonl`), entries);
    const at = new Date(Date.now() - daysAgo * 864e5);
    fs.utimesSync(file, at, at);
    return file;
  };
  return { home, log };
}

const listed = async (home: string) => (await import('../src/main/history')).listSessions(new Set(), home);

describe('History lists real sessions', () => {
  it('a log that opens with mode and snapshot lines, as Claude Code 2.1.301 writes them', async () => {
    const { home, log } = folder();
    log('-tmp-a', 1, [
      JSON.stringify({ type: 'mode', mode: 'default' }),
      JSON.stringify({ type: 'file-history-snapshot', messageId: 'm1', snapshot: {} }),
      userEntry('fix the build', { cwd: '/tmp/a' }),
      assistantEntry('Done.'),
      JSON.stringify({ type: 'ai-title', aiTitle: 'Fix the build' }),
    ]);
    const [session] = await listed(home);
    expect(session).toMatchObject({ sessionId: id(1), title: 'Fix the build', firstPrompt: 'fix the build', cwd: '/tmp/a', messages: 2 });
  });

  it('keeps a session whose cwd folder no longer exists', async () => {
    const { home, log } = folder();
    log('-tmp-gone', 2, [userEntry('old work', { cwd: '/tmp/petal-folder-that-is-gone' }), assistantEntry('ok')]);
    expect((await listed(home)).map((s) => s.title)).toEqual(['old work']);
  });

  it('keeps a session whose first line is not her prompt (a tool result, then her prompt)', async () => {
    const { home, log } = folder();
    log('-tmp-b', 3, [toolResultEntry(), userEntry('second line is mine'), assistantEntry('ok')]);
    expect((await listed(home)).map((s) => s.firstPrompt)).toEqual(['second line is mine']);
  });

  it('keeps a session whose every line is bigger than the read windows (pasted images, long tool output)', async () => {
    const { home, log } = folder();
    log('-tmp-c', 4, [
      JSON.stringify({ type: 'mode', mode: 'default' }),
      userEntry(`look at this ${big(80)}`, { cwd: '/tmp/c' }),
      assistantEntry(big(120)),
    ]);
    const sessions = await listed(home);
    expect(sessions.map((s) => s.sessionId)).toEqual([id(4)]);
    expect(sessions[0].title.startsWith('look at this')).toBe(true);
    expect(sessions[0].cwd).toBe('/tmp/c');
  });

  it('a very large log is listed from its head and tail', async () => {
    const { home, log } = folder();
    const filler = Array.from({ length: 400 }, (_, i) => assistantEntry(`step ${i} ${big(2)}`, `a-${i}`));
    log('-tmp-d', 5, [userEntry('long one', { cwd: '/tmp/d' }), ...filler, JSON.stringify({ type: 'ai-title', aiTitle: 'Long session' })]);
    const [session] = await listed(home);
    expect(session).toMatchObject({ title: 'Long session', messagesExact: false });
  });

  it('still drops an empty log and ignores loose files beside the project folders', async () => {
    const { home, log } = folder();
    log('-tmp-e', 6, [JSON.stringify({ type: 'mode', mode: 'default' })]);
    fs.writeFileSync(path.join(home, 'projects', '.DS_Store'), '');
    expect(await listed(home)).toEqual([]);
  });
});

describe('the past-sessions summary for the setup guide', () => {
  it('counts what History lists, names projects as History does, and the 3 newest titles', async () => {
    const { home, log } = folder();
    log('-tmp-acme', 1, [userEntry('one', { cwd: '/tmp/acme' })], 1);
    log('-tmp-acme', 2, [userEntry('two', { cwd: '/tmp/acme' })], 2);
    log('-tmp-acme', 3, [userEntry('three', { cwd: '/tmp/acme' })], 3);
    log('-tmp-beta', 4, [userEntry('four', { cwd: '/tmp/beta' })], 0.5);
    log('-tmp-beta', 5, [userEntry('five', { cwd: '/tmp/beta' })], 4);
    log('-tmp-beta', 6, [JSON.stringify({ type: 'mode', mode: 'default' })], 0); // empty: History drops it, so the count does too
    const history = await import('../src/main/history');
    const summary = await history.pastSessionsSummary(home);
    expect(summary).toEqual({
      sessions: 5,
      projects: 2,
      newest: [{ title: 'four', project: '/tmp/beta' }, { title: 'one', project: '/tmp/acme' }, { title: 'two', project: '/tmp/acme' }],
    });
    expect(summary.sessions).toBe(history.listSessions(new Set(), home).length);
  });

  it('a log with no cwd counts in its own project folder and borrows that project’s name', async () => {
    const { home, log } = folder();
    log('-tmp-acme', 1, [userEntry('no cwd here'), assistantEntry('ok')], 0);
    log('-tmp-acme', 2, [userEntry('with cwd', { cwd: '/tmp/acme' })], 1);
    log('-tmp-solo', 3, [userEntry('alone'), assistantEntry('ok')], 2);
    const history = await import('../src/main/history');
    expect(await history.pastSessionsSummary(home)).toEqual({
      sessions: 3,
      projects: 2,
      newest: [{ title: 'no cwd here', project: '/tmp/acme' }, { title: 'with cwd', project: '/tmp/acme' }, { title: 'alone', project: '-tmp-solo' }],
    });
  });

  it('is empty with the folder declined, and with no projects folder', async () => {
    const { home, log } = folder();
    const history = await import('../src/main/history');
    expect(await history.pastSessionsSummary(home)).toEqual({ sessions: 0, projects: 0, newest: [] });
    log('-tmp-acme', 1, [userEntry('one', { cwd: '/tmp/acme' })]);
    const config = await import('../src/main/config-store');
    config.save({ claudeFolder: { choice: 'declined' } });
    expect(await history.pastSessionsSummary(home)).toEqual({ sessions: 0, projects: 0, newest: [] });
  });
});

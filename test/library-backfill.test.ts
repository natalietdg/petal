// Read past sessions: which logs by age and offsets, the call estimate, Stop, and the session header's Add to Library rules.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assistantEntry, removeTempDirs, tempDir, useTempUserData, userEntry } from './helpers';
import { CATEGORY_HUES, addButtonState, addResultText, categoryHue, isBackfillDays } from '../src/shared/library';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 16, 12);
const envelope = (result: string) => JSON.stringify({ type: 'result', is_error: false, result });
const reply = envelope(JSON.stringify({ topics: [{ topic: 'Payout cutoff', category: 'Payments', facts: ['Payouts after 3pm settle next day.'] }] }));
const talk = `${JSON.stringify(userEntry('when do payouts settle?'))}\n${JSON.stringify(assistantEntry('After 3pm they settle the next day.'))}\n`;

afterEach(() => {
  delete process.env.PASTEL_SNAPSHOT;
  removeTempDirs();
  vi.resetModules();
});

// A stand-in Claude folder with logs of given ages; config written with the gate and Build my Library as given.
async function setUp({ allowed = true, autoBuild = false } = {}) {
  process.env.PASTEL_SNAPSHOT = '1';
  const userData = useTempUserData();
  fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({ claudeFolder: { choice: allowed ? 'allowed' : 'declined' }, library: { autoBuild } }));
  const home = tempDir('petal-fake-claude-');
  const project = path.join(home, 'projects', '-tmp-acme');
  fs.mkdirSync(project, { recursive: true });
  const mode = await import('../src/main/snapshot-mode');
  mode.folderFixture.home = home;
  const calls: string[] = [];
  mode.libraryFixture.extract = async (prompt) => { calls.push(prompt); return reply; };
  const log = (id: string, daysAgo: number, text = talk, dir = project) => {
    const file = path.join(dir, `${id}.jsonl`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, text);
    const at = new Date(NOW - daysAgo * DAY_MS);
    fs.utimesSync(file, at, at);
    return file;
  };
  return { home, project, mode, calls, log };
}

describe('which past sessions', () => {
  it('picks logs by age, newest first; all means every log', async () => {
    const { home, log } = await setUp();
    log('s-5', 5);
    log('s-1', 1);
    log('s-40', 40);
    log('s-200', 200);
    const { listPastSessions } = await import('../src/main/library-backfill');
    expect(listPastSessions(home, { days: 30, now: NOW }).map((s) => s.sessionId)).toEqual(['s-1', 's-5']);
    expect(listPastSessions(home, { days: 90, now: NOW }).map((s) => s.sessionId)).toEqual(['s-1', 's-5', 's-40']);
    expect(listPastSessions(home, { days: 0, now: NOW }).map((s) => s.sessionId)).toEqual(['s-1', 's-5', 's-40', 's-200']);
  });

  it('skips fully read logs, counts only the unread part of the rest, and rereads a replaced one', async () => {
    const { home, log } = await setUp();
    const full = log('s-full', 2);
    const part = log('s-part', 3);
    const replaced = log('s-replaced', 4);
    const { saveOffset } = await import('../src/main/library-extract');
    saveOffset('s-full', fs.statSync(full).size);
    saveOffset('s-part', 10);
    saveOffset('s-replaced', fs.statSync(replaced).size + 500);
    const { listPastSessions } = await import('../src/main/library-backfill');
    const found = listPastSessions(home, { days: 30, now: NOW });
    expect(found.map((s) => s.sessionId)).toEqual(['s-part', 's-replaced']);
    expect(found[0]?.unread).toBe(fs.statSync(part).size - 10);
    expect(found[1]?.unread).toBe(fs.statSync(replaced).size);
  });

  it('leaves out subagent logs: sidechain-only, agent- files and the deeper subagents folder', async () => {
    const { home, project, log } = await setUp();
    log('s-main', 1);
    log('s-side', 1, `${JSON.stringify(userEntry('task', { isSidechain: true }))}\n${JSON.stringify(assistantEntry('done', 'a1', { isSidechain: true }))}\n`);
    log('agent-1234', 1);
    log('s-nested', 1, talk, path.join(project, 's-main', 'subagents'));
    const { listPastSessions } = await import('../src/main/library-backfill');
    expect(listPastSessions(home, { days: 30, now: NOW }).map((s) => s.sessionId)).toEqual(['s-main']);
  });

  it('only known ranges are accepted', () => {
    expect([30, 90, 0].every(isBackfillDays)).toBe(true);
    expect([7, '30', null, -1].some(isBackfillDays)).toBe(false);
  });
});

describe('the call estimate', () => {
  it('one call per megabyte unread, capped per session at the run cap', async () => {
    await setUp();
    const { callsFor } = await import('../src/main/library-backfill');
    const { CHUNK_BYTES, MAX_CHUNKS_PER_RUN } = await import('../src/main/library-extract');
    expect(callsFor(100)).toBe(1);
    expect(callsFor(CHUNK_BYTES)).toBe(1);
    expect(callsFor(CHUNK_BYTES + 1)).toBe(2);
    expect(callsFor(50 * CHUNK_BYTES)).toBe(MAX_CHUNKS_PER_RUN);
  });

  it('the plan sums the sessions in range, and asks the gate first', async () => {
    const { log } = await setUp();
    log('s-a', 1);
    log('s-b', 2, talk + 'x'.repeat(1024 * 1024 + 10));
    log('s-old', 100);
    const { planBackfill } = await import('../src/main/library-backfill');
    expect(planBackfill(30, NOW)).toMatchObject({ days: 30, sessions: 2, calls: 3 });
    expect(planBackfill(0, NOW)).toMatchObject({ days: 0, sessions: 3, calls: 4 });
  });

  it('without the Claude folder allowed, nothing is listed', async () => {
    const { log } = await setUp({ allowed: false });
    log('s-a', 1);
    const { planBackfill, startBackfill } = await import('../src/main/library-backfill');
    expect(planBackfill(30, NOW)).toMatchObject({ skipped: expect.stringContaining('Claude folder') });
    expect(startBackfill(30, NOW)).toMatchObject({ skipped: expect.stringContaining('Claude folder') });
  });
});

describe('the run', () => {
  it('reads every session newest first through the queue, even with Build my Library off', async () => {
    const { calls, log } = await setUp({ autoBuild: false });
    log('s-old', 3, `${JSON.stringify(userEntry('older question'))}\n`);
    log('s-new', 1, `${JSON.stringify(userEntry('newer question'))}\n`);
    const { startBackfill, whenIdle, backfillState } = await import('../src/main/library-backfill');
    expect(startBackfill(30, NOW)).toMatchObject({ running: true, total: 2, done: 0 });
    await whenIdle();
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('newer question');
    expect(backfillState()).toMatchObject({ running: false, done: 2, total: 2, added: 1, updated: 0 });
  });

  it('Stop ends after the current run; a rerun resumes with what was not read', async () => {
    const { mode, calls, log } = await setUp();
    for (let i = 1; i <= 4; i += 1) log(`s-${i}`, i);
    let release: () => void = () => {};
    let started: () => void = () => {};
    const firstStarted = new Promise<void>((resolve) => { started = resolve; });
    mode.libraryFixture.extract = async (prompt) => {
      calls.push(prompt);
      started();
      if (calls.length === 1) await new Promise<void>((resolve) => { release = resolve; });
      return envelope('{"topics": []}');
    };
    const { startBackfill, stopBackfill, whenIdle, backfillState, onBackfill } = await import('../src/main/library-backfill');
    const seen: boolean[] = [];
    onBackfill((s) => seen.push(s.stopping));
    startBackfill(30, NOW);
    await firstStarted;
    expect(stopBackfill()).toMatchObject({ running: true, stopping: true });
    expect(startBackfill(30, NOW)).toMatchObject({ running: true }); // a second start while running changes nothing
    release();
    await whenIdle();
    expect(calls).toHaveLength(1);
    expect(backfillState()).toMatchObject({ running: false, stopping: false, done: 1, total: 4 });
    expect(seen).toContain(true);
    expect(startBackfill(30, NOW)).toMatchObject({ running: true, total: 3 }); // the read one is skipped
    await whenIdle();
    expect(calls).toHaveLength(4);
  });

  it('a skip that would repeat for every log ends the run with a note', async () => {
    const { mode, log } = await setUp();
    log('s-1', 1);
    log('s-2', 2);
    mode.libraryFixture.extract = null; // the snapshot run without a stub: nothing can run
    const { startBackfill, whenIdle, backfillState } = await import('../src/main/library-backfill');
    startBackfill(30, NOW);
    await whenIdle();
    expect(backfillState()).toMatchObject({ running: false, done: 1, total: 2, note: 'snapshot run' });
  });
});

describe('Add to Library in the session header', () => {
  it('hidden without a Claude session; off with a reason when the folder is not allowed or a read is going', () => {
    expect(addButtonState({ sessionId: null, folderAllowed: true, busy: false })).toMatchObject({ hidden: true });
    expect(addButtonState({ sessionId: 's', folderAllowed: false, busy: false })).toEqual({ hidden: false, disabled: true, title: expect.stringMatching(/Allow reading your Claude folder/) });
    expect(addButtonState({ sessionId: 's', folderAllowed: true, busy: true })).toMatchObject({ hidden: false, disabled: true });
    expect(addButtonState({ sessionId: 's', folderAllowed: true, busy: false })).toEqual({ hidden: false, disabled: false, title: 'Save this session’s domain knowledge to your Library' });
  });

  it('the status line says what happened in a few words', () => {
    expect(addResultText({ added: 2, updated: 1 })).toBe('Added 2 notes, updated 1.');
    expect(addResultText({ added: 1, updated: 0 })).toBe('Added 1 note.');
    expect(addResultText({ added: 0, updated: 3 })).toBe('Updated 3.');
    expect(addResultText({ added: 0, updated: 0, skipped: 'nothing said in this session yet' })).toBe('Nothing added: nothing said in this session yet.');
    expect(addResultText({ added: 0, updated: 0 })).toBe('Nothing new since this session was last read.');
  });
});

describe('category colour', () => {
  it('is the same for a name every time, any case, and always a theme hue', () => {
    for (const name of ['Payments', 'Ledger', 'Settlement', 'x']) {
      expect(categoryHue(name)).toBe(categoryHue(name.toUpperCase()));
      expect(CATEGORY_HUES).toContain(categoryHue(name));
    }
  });

  it('the five most common starter categories each get their own hue', () => {
    const hues = ['Payments', 'Auth', 'Data', 'Infra', 'Integrations'].map(categoryHue);
    expect(new Set(hues).size).toBe(5);
  });
});

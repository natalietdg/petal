import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListedSession } from '../src/main/history';
import { assistantEntry, removeTempDirs, tempDir, tmpLeftovers, useTempUserData, userEntry, writeJsonl } from './helpers';

const stub = vi.hoisted(() => ({
  sessions: [] as ListedSession[],
  claude: '/fake/claude' as string | null,
  reply: '',
  runClaude: undefined as unknown as import('vitest').Mock<(input: string, opts: { model?: string }) => Promise<string>>,
}));

vi.mock('../src/main/history', () => ({ listSessions: () => stub.sessions }));
vi.mock('../src/main/claude-cli', () => ({
  claudePath: async () => stub.claude,
  cleanEnv: () => ({}),
  runClaude: (input: string, opts: { model?: string }) => stub.runClaude(input, opts),
}));

type Organizer = typeof import('../src/main/session-organizer');
type ConfigStore = typeof import('../src/main/config-store');
type TagsStore = typeof import('../src/main/tags-store');

let userData: string;
let organizer: Organizer;
let config: ConfigStore;
let tags: TagsStore;
let fixture: string;

const DEFAULT_REPLY = '{"title":"Organizer reads config.","project":"Petal","status":"Done","tags":["petal"]}';
const CONTRACT = 'Answer with JSON only, no prose:\n{"title": "<title>", "project": "<project>", "status": "done" | "in progress" | "blocked", "tags": ["<tag>"]}';

function session(sessionId: string, file: string, extra: Partial<ListedSession> = {}): ListedSession {
  return {
    sessionId,
    file,
    cwd: '/work/petal',
    title: '',
    firstPrompt: '',
    lastAt: fs.statSync(file).mtimeMs,
    messages: 2,
    messagesExact: true,
    shortCwd: '/work/petal',
    live: false,
    ...extra,
  };
}

const organizerFile = () => path.join(userData, 'organizer.json');
const lastInput = (): string => stub.runClaude.mock.calls.at(-1)?.[0] as string;

beforeEach(async () => {
  userData = useTempUserData();
  fixture = writeJsonl(path.join(tempDir(), 'session.jsonl'), [
    userEntry('make the organizer customisable'),
    assistantEntry('Done, it reads config.json now.'),
  ]);
  stub.sessions = [session('s1', fixture)];
  stub.claude = '/fake/claude';
  stub.reply = DEFAULT_REPLY;
  stub.runClaude = vi.fn(async () => JSON.stringify({ result: stub.reply }));
  vi.resetModules();
  organizer = await import('../src/main/session-organizer');
  config = await import('../src/main/config-store');
  tags = await import('../src/main/tags-store');
});

afterEach(() => {
  organizer.stop();
  vi.restoreAllMocks();
  removeTempDirs();
});

describe('session-organizer prompt contract', () => {
  it('puts her custom prompt first, then the contract, hints, folder and digest', async () => {
    config.save({ organizer: { prompt: 'Custom style: titles in Title Case.', model: 'sonnet' } });
    tags.applyOrganizerTags('other', ['existing-tag']);
    expect(await organizer.runNow()).toEqual({ titled: 1, failed: 0, due: 1 });
    const input = lastInput();
    expect(input.startsWith('Custom style: titles in Title Case.\n')).toBe(true);
    expect(input).toContain(CONTRACT);
    expect(input).toContain('Existing projects: (none yet)');
    expect(input).toContain('Existing tags: "existing-tag"');
    expect(input).toContain('Folder: /work/petal');
    expect(input).toContain('First request: make the organizer customisable');
    expect(input).toContain('Claude: Done, it reads config.json now.');
  });

  it('passes the model from config to runClaude', async () => {
    config.save({ organizer: { model: 'opus' } });
    await organizer.runNow();
    expect(stub.runClaude).toHaveBeenCalledTimes(1);
    expect(stub.runClaude.mock.calls[0][1]).toEqual({ model: 'opus' });
  });

  it('saves the parsed label to organizer.json and the tags to tags.json', async () => {
    await organizer.runNow();
    const saved = JSON.parse(fs.readFileSync(organizerFile(), 'utf8')) as Record<string, { title: string; project: string; status: string; mtimeMs: number }>;
    expect(saved.s1).toMatchObject({ title: 'Organizer reads config', project: 'Petal', status: 'done', mtimeMs: fs.statSync(fixture).mtimeMs });
    expect(tags.load().sessions.s1).toEqual({ tags: ['petal'], manual: false });
    expect(tmpLeftovers(userData)).toEqual([]);
  });

  it('pulls the JSON out of prose or a fence and normalises odd fields', async () => {
    stub.reply = 'Sure!\n```json\n{"title":"  Spaced   out  title. ","project":"","status":"weird","tags":["a","b","c","d"]}\n```';
    await organizer.runNow();
    expect(organizer.load().s1).toMatchObject({ title: 'Spaced out title', project: null, status: 'in progress' });
    expect(tags.load().sessions.s1.tags).toEqual(['a', 'b', 'c']);
  });

  it('feeds earlier projects back as hints, most used first', async () => {
    fs.writeFileSync(organizerFile(), JSON.stringify({
      a: { title: 'x', project: 'Rare', status: 'done', mtimeMs: 0, at: '' },
      b: { title: 'x', project: 'Common', status: 'done', mtimeMs: 0, at: '' },
      c: { title: 'x', project: 'Common', status: 'done', mtimeMs: 0, at: '' },
    }));
    await organizer.runNow();
    expect(lastInput()).toContain('Existing projects: "Common", "Rare"');
  });

  it('records lastPass for the Customize page', async () => {
    expect(organizer.status()).toEqual({ lastPass: null, running: false, schedule: null });
    await organizer.runNow();
    expect(organizer.status().lastPass).toMatchObject({ titled: 1, failed: 0, due: 1 });
    expect(typeof organizer.status().lastPass?.at).toBe('string');
  });

  it('promptFor with the default prompt contains the contract', () => {
    const text = organizer.promptFor(config.load().organizer.prompt, 'D', null, [], []);
    expect(text.startsWith(config.defaults().organizer.prompt)).toBe(true);
    expect(text).toContain(CONTRACT);
    expect(text).toContain('Folder: unknown');
    expect(text.endsWith('Session:\nD')).toBe(true);
  });
});

describe('session-organizer passes', () => {
  it('a concurrent runNow joins the same pass', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    stub.runClaude = vi.fn(async () => { await gate; return JSON.stringify({ result: stub.reply }); });
    const a = organizer.runNow({ limit: 2 });
    const b = organizer.runNow({ limit: 2 });
    expect(a).toBe(b);
    expect(organizer.isRunning()).toBe(true);
    release();
    expect(await a).toEqual({ titled: 1, failed: 0, due: 1 });
    expect(stub.runClaude).toHaveBeenCalledTimes(1);
    expect(organizer.isRunning()).toBe(false);
  });

  it('a second pass with nothing changed has due 0', async () => {
    await organizer.runNow();
    expect(await organizer.runNow()).toEqual({ titled: 0, failed: 0, due: 0 });
    expect(stub.runClaude).toHaveBeenCalledTimes(1);
  });

  it('a session that changed since its label is due again and retitled', async () => {
    await organizer.runNow();
    fs.appendFileSync(fixture, `${JSON.stringify(userEntry('one more thing'))}\n`);
    stub.sessions = [session('s1', fixture)];
    stub.reply = '{"title":"New title","project":"Petal","status":"done","tags":[]}';
    expect((await organizer.runNow()).titled).toBe(1);
    expect(organizer.load().s1.title).toBe('New title');
  });

  it('an already-titled but untagged session keeps its title (tag-only backfill)', async () => {
    const mtimeMs = fs.statSync(fixture).mtimeMs;
    fs.writeFileSync(organizerFile(), JSON.stringify({ s1: { title: 'SEEDED TITLE', project: 'Seed', status: 'done', mtimeMs, at: 'x' } }));
    expect(await organizer.runNow()).toEqual({ titled: 1, failed: 0, due: 1 });
    expect(organizer.load().s1).toEqual({ title: 'SEEDED TITLE', project: 'Seed', status: 'done', mtimeMs, at: 'x' });
    expect(tags.load().sessions.s1.tags).toEqual(['petal']);
    expect((await organizer.runNow()).due).toBe(0);
  });

  it('leaves her manual tags alone', async () => {
    tags.addTag('s1', 'mine');
    await organizer.runNow();
    expect(tags.load().sessions.s1).toEqual({ tags: ['mine'], manual: true });
    expect(tags.load().tags.petal).toBeUndefined();
  });

  it('respects the limit and the configured perPass', async () => {
    const second = writeJsonl(path.join(tempDir(), 'two.jsonl'), [userEntry('second session')]);
    const third = writeJsonl(path.join(tempDir(), 'three.jsonl'), [userEntry('third session')]);
    stub.sessions = [session('s1', fixture), session('s2', second), session('s3', third)];
    expect((await organizer.runNow({ limit: 1 })).due).toBe(1);
    config.save({ organizer: { perPass: 1 } });
    expect((await organizer.runNow()).due).toBe(1);
    expect((await organizer.runNow({ limit: 5 })).due).toBe(1);
  });

  it('counts a bad reply as failed and retries it next pass', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    stub.runClaude = vi.fn(async () => JSON.stringify({ result: 'no json here' }));
    expect(await organizer.runNow()).toEqual({ titled: 0, failed: 1, due: 1 });
    expect(organizer.load()).toEqual({});
    stub.runClaude = vi.fn(async () => JSON.stringify({ result: stub.reply }));
    expect(await organizer.runNow()).toEqual({ titled: 1, failed: 0, due: 1 });
  });

  it('a transcript with no prompts fails without calling the CLI', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const empty = writeJsonl(path.join(tempDir(), 'empty.jsonl'), [assistantEntry('orphan reply')]);
    stub.sessions = [session('s9', empty)];
    expect(await organizer.runNow()).toEqual({ titled: 0, failed: 1, due: 1 });
    expect(stub.runClaude).not.toHaveBeenCalled();
  });

  it('skips the whole pass when claude is not installed', async () => {
    stub.claude = null;
    expect(await organizer.runNow()).toEqual({ titled: 0, failed: 0, due: 0, skipped: 'no claude' });
    expect(stub.runClaude).not.toHaveBeenCalled();
  });

  it('skips an open session written to within the last two minutes', async () => {
    vi.spyOn(globalThis, 'setInterval');
    organizer.start({ openSessionIds: () => ['s1'] });
    stub.sessions = [session('s1', fixture, { lastAt: Date.now() })];
    expect((await organizer.runNow()).due).toBe(0);
    stub.sessions = [session('s1', fixture, { lastAt: Date.now() - 3 * 60 * 1000 })];
    expect((await organizer.runNow()).due).toBe(1);
  });

  it('only keeps the newest six turns in the digest and says how many were omitted', async () => {
    const many = writeJsonl(path.join(tempDir(), 'many.jsonl'), Array.from({ length: 9 }, (_, i) => userEntry(`prompt number ${i}`)));
    stub.sessions = [session('s1', many)];
    await organizer.runNow();
    const input = lastInput();
    expect(input).toContain('First request: prompt number 0');
    expect(input).toContain('(3 turns omitted)');
    expect(input).not.toContain('User: prompt number 2');
    expect(input).toContain('User: prompt number 3');
    expect(input).toContain('User: prompt number 8');
  });
});

describe('session-organizer schedule', () => {
  it('reschedules on an interval or enabled change only', () => {
    config.save({ organizer: { enabled: true } });
    const intervals: number[] = [];
    const realSetInterval = globalThis.setInterval;
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((fn: () => void, ms: number) => {
      intervals.push(ms);
      return realSetInterval(() => {}, 1e9);
    }) as typeof setInterval);
    organizer.start({ openSessionIds: () => [] });
    expect(organizer.status().schedule).toEqual({ enabled: true, intervalMinutes: 10 });
    config.save({ organizer: { intervalMinutes: 3 } });
    expect(organizer.status().schedule).toEqual({ enabled: true, intervalMinutes: 3 });
    expect(intervals).toEqual([600_000, 180_000]);
    config.save({ organizer: { enabled: false } });
    expect(organizer.status().schedule?.enabled).toBe(false);
    expect(intervals).toHaveLength(2);
    config.save({ organizer: { perPass: 5 } });
    expect(intervals).toHaveLength(2);
    organizer.stop();
    expect(organizer.status().schedule).toBeNull();
    config.save({ organizer: { enabled: true, intervalMinutes: 9 } });
    expect(intervals).toHaveLength(2); // stopped: no longer listening
  });

  it('start twice is a no-op', () => {
    config.save({ organizer: { enabled: true } });
    const spy = vi.spyOn(globalThis, 'setInterval');
    organizer.start();
    organizer.start();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('session-organizer store file', () => {
  it('a corrupt organizer.json is moved aside, not overwritten', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fs.writeFileSync(organizerFile(), '{"s1": {"title": "kept"');
    expect(organizer.load()).toEqual({});
    const aside = fs.readdirSync(userData).filter((f) => /^organizer\.broken-\d+\.json$/.test(f));
    expect(aside).toHaveLength(1);
    expect(fs.readFileSync(path.join(userData, aside[0]), 'utf8')).toBe('{"s1": {"title": "kept"');
    warn.mockRestore();
  });
});

// A session is named once, after enough of her prompts, then the name sticks: later ai-titles and organizer passes never rename it.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListedSession, SessionRecord } from '../src/main/history';
import { removeTempDirs, useTempUserData } from './helpers';

const stub = vi.hoisted(() => ({ listed: [] as ListedSession[] }));
vi.mock('../src/main/history', () => ({ listSessions: () => stub.listed, findRecord: () => null }));

type Titles = typeof import('../src/main/session-title');
type Names = typeof import('../src/main/session-names');
let titles: Titles;
let names: Names;
let userData: string;

const LATER = Date.now() + 60_000; // written after the upgrade
const record = (extra: Partial<SessionRecord> = {}): SessionRecord => ({
  sessionId: 's1', file: '/x/s1.jsonl', cwd: '/work/acme', title: 'fix the build', firstAiTitle: null, customTitle: null,
  firstPrompt: 'fix the build', lastAt: LATER, messages: 6, messagesExact: true, prompts: 3, ...extra,
});
const listed = (extra: Partial<SessionRecord>): ListedSession => ({ ...record(extra), shortCwd: '/work/acme', live: false });
const name = (rec: SessionRecord | null, organizerTitle: string | null = null) => titles.nameFor(rec?.sessionId ?? 's1', { record: rec, organizerTitle, cwd: '/work/acme' });

beforeEach(async () => {
  userData = useTempUserData();
  stub.listed = [];
  vi.resetModules();
  titles = await import('../src/main/session-title');
  names = await import('../src/main/session-names');
});
afterEach(removeTempDirs);

describe('naming a session once', () => {
  it('waits for enough of her prompts: a placeholder, no pin, even when titles exist', () => {
    expect(names.PROMPTS_BEFORE_NAMING).toBe(3);
    for (const prompts of [0, 1, 2]) {
      expect(name(record({ prompts, firstAiTitle: 'Fix the CI build', title: 'Fix the CI build' }), 'Organizer name')).toBe('fix the build');
    }
    expect(names.pinned('s1')).toBeNull();
    expect(titles.nameFor('s9', { record: null, organizerTitle: 'Organizer name', firstPrompt: 'hello', cwd: '/work/acme' })).toBe('hello');
    expect(titles.nameFor('s9', { record: null, cwd: '/work/acme' })).toBe('acme · new session');
    expect(names.pinned('s9')).toBeNull();
  });

  it('names a log too big to read whole, even when the sampled prompt count is low', () => {
    expect(name(record({ prompts: 1, messagesExact: false, firstAiTitle: 'Long Petal session', title: 'Long Petal session' }))).toBe('Long Petal session');
  });

  it('pins once at the threshold from the latest ai-title', () => {
    expect(name(record({ prompts: 2, firstAiTitle: 'Session list scroll bug', title: 'Session list scroll bug' }))).toBe('fix the build');
    expect(name(record({ prompts: 3, firstAiTitle: 'Session list scroll bug', title: 'Petal naming and scroll fixes' }))).toBe('Petal naming and scroll fixes');
    expect(names.pinned('s1')).toMatchObject({ title: 'Petal naming and scroll fixes', from: 'claude' });
  });

  it('prefers the organizer title at the threshold', () => {
    expect(name(record({ firstAiTitle: 'Fix the CI build', title: 'Fix the CI build' }), 'Organizer name')).toBe('Organizer name');
    expect(names.pinned('s1')).toMatchObject({ title: 'Organizer name', from: 'organizer' });
  });

  it('stays a placeholder at the threshold until a title lands, then pins that', () => {
    expect(name(record())).toBe('fix the build');
    expect(names.pinned('s1')).toBeNull();
    expect(name(record({ prompts: 4, firstAiTitle: 'Fix the CI build', title: 'Fix the CI build' }))).toBe('Fix the CI build');
  });

  it('ignores later ai-titles and organizer passes', () => {
    expect(name(record({ firstAiTitle: 'Fix the CI build', title: 'Fix the CI build' }))).toBe('Fix the CI build');
    expect(name(record({ prompts: 9, firstAiTitle: 'Fix the CI build', title: 'Deploy the hotfix' }))).toBe('Fix the CI build');
    expect(name(record({ prompts: 12, firstAiTitle: 'Fix the CI build', title: 'Deploy the hotfix' }), 'Organizer name')).toBe('Fix the CI build');
    expect(names.pinned('s1')).toMatchObject({ title: 'Fix the CI build', from: 'claude' });
  });

  it('lets her /rename win anytime, even before the threshold, and only she renames it again', () => {
    expect(name(record({ prompts: 1, customTitle: 'CI fix' }))).toBe('CI fix');
    expect(names.pinned('s1')).toMatchObject({ title: 'CI fix', from: 'manual' });
    expect(name(record({ firstAiTitle: 'Fix the CI build', title: 'Fix the CI build' }), 'Organizer name')).toBe('CI fix');
    expect(name(record({ customTitle: 'CI fix, round two' }))).toBe('CI fix, round two');
  });

  it('leaves an existing known pin untouched', () => {
    fs.writeFileSync(path.join(userData, 'session-names.json'), JSON.stringify({ since: 0, names: { s1: { title: 'Session list scroll position bug', from: 'known', at: 'x' } } }));
    expect(name(record({ prompts: 40, firstAiTitle: 'Other', title: 'Other' }), 'Organizer name')).toBe('Session list scroll position bug');
    expect(names.pinned('s1')).toMatchObject({ title: 'Session list scroll position bug', from: 'known', at: 'x' });
  });

  it('keeps the pin across restarts (on disk in userData)', async () => {
    name(record({ firstAiTitle: 'Fix the CI build', title: 'Fix the CI build' }));
    vi.resetModules();
    const fresh = await import('../src/main/session-title');
    expect(fresh.nameFor('s1', { record: record({ firstAiTitle: 'Other', title: 'Other' }) })).toBe('Fix the CI build');
    expect(fs.existsSync(path.join(userData, 'session-names.json'))).toBe(true);
  });
});

describe('upgrade', () => {
  it('pins what every listed session shows now: organizer title, else the latest ai-title', () => {
    fs.writeFileSync(path.join(userData, 'organizer.json'), JSON.stringify({ a: { title: 'Organized name', project: null, status: 'done', mtimeMs: 1, at: 'x' } }));
    stub.listed = [
      listed({ sessionId: 'a', firstAiTitle: 'First ai', title: 'Latest ai', lastAt: 1 }),
      listed({ sessionId: 'b', firstAiTitle: 'First ai', title: 'Latest ai', lastAt: 1 }),
      listed({ sessionId: 'c', lastAt: 1 }), // prompt only: stays a placeholder
    ];
    expect(titles.nameFor('b', { record: stub.listed[1] })).toBe('Latest ai');
    expect(names.pinned('a')).toMatchObject({ title: 'Organized name', from: 'known' });
    expect(names.pinned('b')).toMatchObject({ title: 'Latest ai', from: 'known' });
    expect(names.pinned('c')).toBeNull();
  });

  it('a session last written before the upgrade but not listed keeps its latest ai-title', () => {
    name(null); // creates the store
    expect(titles.nameFor('old', { record: record({ sessionId: 'old', firstAiTitle: 'First ai', title: 'Latest ai', lastAt: 1 }) })).toBe('Latest ai');
    expect(names.pinned('old')).toMatchObject({ title: 'Latest ai', from: 'known' });
  });
});

// A session is named once from context, then the name sticks: later ai-titles and organizer passes never rename it.
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
  firstPrompt: 'fix the build', lastAt: LATER, messages: 2, messagesExact: true, ...extra,
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
  it('shows the first prompt as a placeholder, then pins the first context title', () => {
    expect(name(record())).toBe('fix the build');
    expect(names.pinned('s1')).toBeNull();
    expect(name(record({ firstAiTitle: 'Fix the CI build', title: 'Fix the CI build' }))).toBe('Fix the CI build');
    expect(names.pinned('s1')).toMatchObject({ title: 'Fix the CI build', from: 'claude' });
  });

  it('ignores a later ai-title', () => {
    expect(name(record({ firstAiTitle: 'Fix the CI build', title: 'Fix the CI build' }))).toBe('Fix the CI build');
    expect(name(record({ firstAiTitle: 'Fix the CI build', title: 'Deploy the hotfix' }))).toBe('Fix the CI build');
    expect(name(record({ firstAiTitle: 'Something else', title: 'Something else' }))).toBe('Fix the CI build');
  });

  it('takes the first ai-title, not the latest, when it first reads a session', () => {
    expect(name(record({ firstAiTitle: 'Fix the CI build', title: 'Deploy the hotfix' }))).toBe('Fix the CI build');
  });

  it('ignores an organizer retitle, and pins the organizer title when it lands first', () => {
    name(record({ firstAiTitle: 'Fix the CI build', title: 'Fix the CI build' }));
    expect(name(record({ firstAiTitle: 'Fix the CI build' }), 'Organizer name')).toBe('Fix the CI build');
    expect(titles.nameFor('s2', { record: record({ sessionId: 's2' }), organizerTitle: 'Organizer name' })).toBe('Organizer name');
    expect(titles.nameFor('s2', { record: record({ sessionId: 's2', firstAiTitle: 'Late ai title' }), organizerTitle: 'Organizer v2' })).toBe('Organizer name');
  });

  it('lets her /rename win, stick, and be renamed again only by her', () => {
    name(record({ firstAiTitle: 'Fix the CI build', title: 'Fix the CI build' }));
    expect(name(record({ firstAiTitle: 'Fix the CI build', customTitle: 'CI fix' }))).toBe('CI fix');
    expect(names.pinned('s1')).toMatchObject({ title: 'CI fix', from: 'manual' });
    expect(name(record({ firstAiTitle: 'Fix the CI build' }), 'Organizer name')).toBe('CI fix');
    expect(name(record({ customTitle: 'CI fix, round two' }))).toBe('CI fix, round two');
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

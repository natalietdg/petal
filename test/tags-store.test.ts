import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { removeTempDirs, tmpLeftovers, useTempUserData } from './helpers';

type TagsStore = typeof import('../src/main/tags-store');

let dir: string;
let store: TagsStore;

beforeEach(async () => {
  dir = useTempUserData();
  vi.resetModules();
  store = await import('../src/main/tags-store');
});
afterEach(removeTempDirs);

describe('tags-store load', () => {
  it('missing or corrupt file -> empty store', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(store.load()).toEqual({ tags: {}, deleted: [], sessions: {} });
    fs.writeFileSync(path.join(dir, 'tags.json'), '[1,2');
    expect(store.load()).toEqual({ tags: {}, deleted: [], sessions: {} });
    expect(fs.readdirSync(dir).filter((f) => /^tags\.broken-\d+\.json$/.test(f))).toHaveLength(1);
    expect(fs.existsSync(path.join(dir, 'tags.json'))).toBe(false);
    fs.writeFileSync(path.join(dir, 'tags.json'), JSON.stringify({ tags: [], deleted: 'x', sessions: null }));
    expect(store.load()).toEqual({ tags: {}, deleted: [], sessions: {} });
  });
});

describe('tags-store organizer apply', () => {
  it('creates tags with palette colours round-robin and marks the session organizer-owned', () => {
    expect(store.applyOrganizerTags('s1', ['Auth', 'petal ui'])).toEqual(['Auth', 'petal ui']);
    const d = store.load();
    expect(d.tags.Auth.color).toBe(store.PALETTE[0]);
    expect(d.tags['petal ui'].color).toBe(store.PALETTE[1]);
    expect(d.sessions.s1).toEqual({ tags: ['Auth', 'petal ui'], manual: false });
  });

  it('walks the whole palette, then wraps to the least-used colour', () => {
    const names = store.PALETTE.map((_, i) => `t${i}`);
    store.applyOrganizerTags('s1', names);
    store.applyOrganizerTags('s2', ['wrap']);
    const d = store.load();
    expect(names.map((n) => d.tags[n].color)).toEqual(store.PALETTE);
    expect(d.tags.wrap.color).toBe(store.PALETTE[0]);
  });

  it('reuses an existing name case-insensitively and keeps its spelling', () => {
    store.applyOrganizerTags('s1', ['Auth', 'petal ui']);
    expect(store.applyOrganizerTags('s2', ['auth', 'Resume'])).toEqual(['Auth', 'Resume']);
    const d = store.load();
    expect(d.tags.Resume.color).toBe(store.PALETTE[2]);
    expect(Object.keys(d.tags)).toEqual(['Auth', 'petal ui', 'Resume']);
  });

  it('cleans names (whitespace, 24 chars), drops empties and duplicates', () => {
    expect(store.applyOrganizerTags('s1', ['  a   b ', '', null, 'A B', 'x'.repeat(40)])).toEqual(['a b', 'x'.repeat(24)]);
  });

  it('an empty suggestion still marks the session as tagged', () => {
    expect(store.applyOrganizerTags('s1', null)).toEqual([]);
    expect(store.load().sessions.s1).toEqual({ tags: [], manual: false });
  });

  it('skips manual sessions and creates no tag for them', () => {
    store.applyOrganizerTags('s2', ['Auth', 'Resume']);
    store.addTag('s2', 'Career');
    expect(store.applyOrganizerTags('s2', ['Other'])).toEqual(['Auth', 'Resume', 'Career']);
    expect(store.load().tags.Other).toBeUndefined();
  });
});

describe('tags-store manual edits', () => {
  it('addTag appends and sets manual; adding twice is a no-op on the list', () => {
    store.applyOrganizerTags('s2', ['Auth', 'Resume']);
    store.addTag('s2', 'Career');
    store.addTag('s2', 'career');
    expect(store.load().sessions.s2).toEqual({ tags: ['Auth', 'Resume', 'Career'], manual: true });
  });

  it('addTag ignores an empty name or session id', () => {
    store.addTag('', 'x');
    store.addTag('s1', '   ');
    expect(store.load()).toEqual({ tags: {}, deleted: [], sessions: {} });
  });

  it('removeTag drops the tag from that session and sets manual', () => {
    store.applyOrganizerTags('s1', ['Auth', 'petal ui']);
    store.removeTag('s1', 'petal ui');
    const d = store.load();
    expect(d.sessions.s1).toEqual({ tags: ['Auth'], manual: true });
    expect(d.tags['petal ui']).toBeDefined(); // still exists for other sessions
  });

  it('re-adding a deleted name by hand brings it back', () => {
    store.applyOrganizerTags('s1', ['Auth']);
    store.deleteTag('Auth');
    store.addTag('s1', 'auth');
    const d = store.load();
    expect(d.deleted).toEqual([]);
    expect(d.tags.auth).toBeDefined();
  });

  it('names() orders by how many sessions use each tag', () => {
    store.applyOrganizerTags('s1', ['rare', 'common']);
    store.applyOrganizerTags('s2', ['common']);
    store.applyOrganizerTags('s3', ['common', 'mid']);
    store.applyOrganizerTags('s4', ['mid']);
    expect(store.names()).toEqual(['common', 'mid', 'rare']);
  });
});

describe('tags-store delete', () => {
  it('removes the tag everywhere and remembers it', () => {
    store.applyOrganizerTags('s1', ['Auth', 'petal ui']);
    store.applyOrganizerTags('s2', ['auth', 'Resume']);
    store.deleteTag('Auth');
    const d = store.load();
    expect(d.tags.Auth).toBeUndefined();
    expect(d.deleted).toEqual(['Auth']);
    expect(Object.values(d.sessions).every((e) => !e.tags?.includes('Auth'))).toBe(true);
    expect(store.names()).not.toContain('Auth');
  });

  it('is never recreated by the organizer, in any case', () => {
    store.applyOrganizerTags('s1', ['Auth']);
    store.deleteTag('Auth');
    expect(store.applyOrganizerTags('s3', ['AUTH', 'Infra'])).toEqual(['Infra']);
    const d = store.load();
    expect(d.tags.Auth).toBeUndefined();
    expect(d.tags.AUTH).toBeUndefined();
  });

  it('deleting twice records the name once', () => {
    store.applyOrganizerTags('s1', ['Auth']);
    store.deleteTag('Auth');
    store.deleteTag('Auth');
    expect(store.load().deleted).toEqual(['Auth']);
  });
});

describe('tags-store rename', () => {
  it('renaming onto an existing tag merges, and the old name counts as deleted', () => {
    store.applyOrganizerTags('s2', ['Auth', 'Resume']);
    store.addTag('s2', 'Career');
    store.renameTag('Career', 'resume');
    const d = store.load();
    expect(d.tags.Career).toBeUndefined();
    expect(d.sessions.s2.tags).toEqual(['Auth', 'Resume']);
    expect(d.deleted).toContain('Career');
    expect(store.applyOrganizerTags('s9', ['career'])).toEqual([]);
  });

  it('renaming to a new name keeps the colour and moves every session', () => {
    store.applyOrganizerTags('s1', ['old']);
    store.applyOrganizerTags('s2', ['old', 'other']);
    const color = store.load().tags.old.color;
    store.renameTag('old', '  brand   new ');
    const d = store.load();
    expect(d.tags['brand new'].color).toBe(color);
    expect(d.sessions.s1.tags).toEqual(['brand new']);
    expect(d.sessions.s2.tags).toEqual(['brand new', 'other']);
    expect(d.deleted).toEqual(['old']);
  });

  it('renaming onto a deleted name revives it', () => {
    store.applyOrganizerTags('s1', ['gone', 'keep']);
    store.deleteTag('gone');
    store.renameTag('keep', 'Gone');
    const d = store.load();
    expect(d.deleted).toEqual(['keep']);
    expect(d.tags.Gone).toBeDefined();
  });

  it('ignores unknown, empty or identical names', () => {
    store.applyOrganizerTags('s1', ['a']);
    const before = store.load();
    store.renameTag('missing', 'b');
    store.renameTag('a', '  ');
    store.renameTag('a', 'a');
    expect(store.load()).toEqual(before);
  });

  it('a case-only rename keeps the tag', () => {
    store.applyOrganizerTags('s1', ['auth']);
    store.renameTag('auth', 'Auth');
    const d = store.load();
    expect(Object.keys(d.tags)).toEqual(['Auth']);
    expect(d.sessions.s1.tags).toEqual(['Auth']);
  });
});

describe('tags-store files', () => {
  it('writes <userData>/tags.json and leaves no .tmp', () => {
    store.applyOrganizerTags('s1', ['a']);
    store.addTag('s1', 'b');
    store.removeTag('s1', 'a');
    store.deleteTag('b');
    store.renameTag('a', 'c');
    expect(fs.existsSync(path.join(dir, 'tags.json'))).toBe(true);
    expect(tmpLeftovers(dir)).toEqual([]);
  });
});

describe('tags-store case-insensitive edits', () => {
  it('remove and delete match tags regardless of case', () => {
    store.applyOrganizerTags('s1', ['Auth', 'Infra']);
    store.removeTag('s1', 'auth');
    expect(store.load().sessions.s1.tags).toEqual(['Infra']);
    store.applyOrganizerTags('s2', ['Auth']);
    store.deleteTag('auth');
    const d = store.load();
    expect(Object.keys(d.tags).some((k) => k.toLowerCase() === 'auth')).toBe(false);
    expect(d.sessions.s2.tags).toEqual([]);
  });
});

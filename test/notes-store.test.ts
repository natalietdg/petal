import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { removeTempDirs, tmpLeftovers, useTempUserData } from './helpers';

type NotesStore = typeof import('../src/main/notes-store');

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
let dir: string;
let store: NotesStore;

beforeEach(async () => {
  dir = useTempUserData();
  vi.resetModules();
  store = await import('../src/main/notes-store');
});
afterEach(removeTempDirs);

describe('notes-store', () => {
  it('saves per session under userData/notes and reads it back', () => {
    expect(store.read(A)).toBe('');
    expect(store.save(A, '# mine\nonly for A')).toEqual({ ok: true });
    expect(store.save(B, 'B notes')).toEqual({ ok: true });
    expect(fs.readFileSync(path.join(dir, 'notes', `${A}.md`), 'utf8')).toBe('# mine\nonly for A');
    expect(store.read(A)).toBe('# mine\nonly for A');
    expect(store.read(B)).toBe('B notes');
    expect(tmpLeftovers(path.join(dir, 'notes'))).toEqual([]);
  });

  it('clearing the notes removes the file', () => {
    store.save(A, 'x');
    expect(store.save(A, '  \n')).toEqual({ ok: true });
    expect(fs.existsSync(path.join(dir, 'notes', `${A}.md`))).toBe(false);
  });

  it('refuses ids that are not session ids, so nothing escapes the folder', () => {
    for (const bad of ['../config', '../../x', 'snapshot-fixture', '', null]) {
      expect(store.save(bad, 'x')).toEqual({ note: 'Notes need a Claude session.' });
      expect(store.read(bad)).toBe('');
    }
    expect(fs.existsSync(path.join(dir, 'config.md'))).toBe(false);
  });

  it('refuses non-text and oversized notes', () => {
    expect(store.save(A, 42)).toEqual({ note: 'Notes must be text.' });
    expect('note' in store.save(A, 'x'.repeat(store.MAX_NOTE_CHARS + 1))).toBe(true);
  });

  it('searchable lists only sessions with notes', () => {
    store.save(A, 'pineapple');
    fs.writeFileSync(path.join(dir, 'notes', 'stray.md'), 'ignored');
    expect(store.searchable()).toEqual({ [A]: 'pineapple' });
  });
});

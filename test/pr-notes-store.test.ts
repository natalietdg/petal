import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { removeTempDirs, tmpLeftovers, useTempUserData } from './helpers';

type Store = typeof import('../src/main/pr-notes-store');

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const PR1 = 'https://github.com/acme/api/pull/1';
const PR2 = 'https://dev.azure.com/org/proj/_git/web/pullrequest/2';
const notes = (risks = '', env = '', checks = '') => ({ risks, env, checks });
let dir: string;
let store: Store;

beforeEach(async () => {
  dir = useTempUserData();
  vi.resetModules();
  store = await import('../src/main/pr-notes-store');
});
afterEach(removeTempDirs);

describe('pr-notes-store', () => {
  const file = () => path.join(dir, 'notes', `${A}.prs.json`);
  const legacy = () => path.join(dir, 'session-prs', `notes-${A}.json`);
  const writeLegacy = (data: unknown) => {
    fs.mkdirSync(path.dirname(legacy()), { recursive: true });
    fs.writeFileSync(legacy(), JSON.stringify(data));
  };

  it('saves each PR’s three notes per session and reads them back', () => {
    expect(store.read(A)).toEqual({});
    expect(store.save(A, PR1, notes('drops a column', 'NEW_FLAG', 'watch 5xx'))).toEqual({ ok: true });
    expect(store.save(A, PR2, notes('', 'SMS_KEY'))).toEqual({ ok: true });
    expect(store.read(A)).toEqual({ [PR1]: notes('drops a column', 'NEW_FLAG', 'watch 5xx'), [PR2]: notes('', 'SMS_KEY') });
    expect(JSON.parse(fs.readFileSync(file(), 'utf8'))[PR1].env).toBe('NEW_FLAG');
    expect(tmpLeftovers(path.join(dir, 'notes'))).toEqual([]);
  });

  it('drops a PR whose notes are all empty, and the file with the last one', () => {
    store.save(A, PR1, notes('x'));
    store.save(A, PR2, notes('y'));
    store.save(A, PR1, notes(' ', '\n'));
    expect(Object.keys(store.read(A))).toEqual([PR2]);
    store.save(A, PR2, notes());
    expect(fs.existsSync(file())).toBe(false);
  });

  it('refuses ids that could leave the folder, a missing PR and non-text notes', () => {
    for (const bad of ['../config', 'a/b', '', null]) expect(store.save(bad, PR1, notes('x'))).toEqual({ note: 'Notes need a Claude session.' });
    expect(store.save(A, '', notes('x'))).toEqual({ note: 'Notes need a PR.' });
    expect(store.save(A, PR1, { risks: 1, env: '', checks: '' })).toEqual({ note: 'Notes must be text.' });
    expect('note' in store.save(A, PR1, notes('x'.repeat(store.MAX_FIELD_CHARS + 1)))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'notes'))).toBe(false);
  });

  it('keeps only the three fields, and skips entries a hand edit broke', () => {
    store.save(A, PR1, { ...notes('r'), extra: 'dropped' });
    fs.writeFileSync(file(), JSON.stringify({ ...JSON.parse(fs.readFileSync(file(), 'utf8')), [PR2]: { risks: 3 } }));
    expect(store.read(A)).toEqual({ [PR1]: notes('r') });
  });

  it('lives in the one notes store, beside the session’s markdown notes', async () => {
    store.save(A, PR1, notes('r'));
    const notesStore = await import('../src/main/notes-store');
    expect(notesStore.readPrNotes(A)).toEqual({ [PR1]: notes('r') });
    expect(notesStore.searchable()).toEqual({}); // the .prs.json file is not a markdown note
  });

  it('migrates the old session-prs file on first read and leaves it in place', () => {
    writeLegacy({ [PR1]: notes('old risk', 'OLD_FLAG') });
    expect(store.read(A)).toEqual({ [PR1]: notes('old risk', 'OLD_FLAG') });
    expect(JSON.parse(fs.readFileSync(file(), 'utf8'))).toEqual({ [PR1]: notes('old risk', 'OLD_FLAG') });
    expect(fs.existsSync(legacy())).toBe(true);
  });

  it('after migrating, the new store wins and the old file is never read again', () => {
    writeLegacy({ [PR1]: notes('old') });
    store.save(A, PR2, notes('new'));
    expect(store.read(A)).toEqual({ [PR1]: notes('old'), [PR2]: notes('new') });
    writeLegacy({ [PR1]: notes('edited by hand later') });
    expect(store.read(A)[PR1]).toEqual(notes('old'));
  });

  it('clearing every migrated PR keeps an empty file, so the old notes do not come back', () => {
    writeLegacy({ [PR1]: notes('old') });
    store.save(A, PR1, notes());
    expect(store.read(A)).toEqual({});
    expect(JSON.parse(fs.readFileSync(file(), 'utf8'))).toEqual({});
    expect(fs.existsSync(legacy())).toBe(true);
  });

  it('a broken old file migrates nothing and is left alone', () => {
    fs.mkdirSync(path.dirname(legacy()), { recursive: true });
    fs.writeFileSync(legacy(), '{not json');
    expect(store.read(A)).toEqual({});
    expect(fs.existsSync(file())).toBe(false);
    expect(fs.readFileSync(legacy(), 'utf8')).toBe('{not json');
  });
});

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
  const file = () => path.join(dir, 'session-prs', `notes-${A}.json`);

  it('saves each PR’s three notes per session and reads them back', () => {
    expect(store.read(A)).toEqual({});
    expect(store.save(A, PR1, notes('drops a column', 'NEW_FLAG', 'watch 5xx'))).toEqual({ ok: true });
    expect(store.save(A, PR2, notes('', 'SMS_KEY'))).toEqual({ ok: true });
    expect(store.read(A)).toEqual({ [PR1]: notes('drops a column', 'NEW_FLAG', 'watch 5xx'), [PR2]: notes('', 'SMS_KEY') });
    expect(JSON.parse(fs.readFileSync(file(), 'utf8'))[PR1].env).toBe('NEW_FLAG');
    expect(tmpLeftovers(path.join(dir, 'session-prs'))).toEqual([]);
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
    expect(fs.existsSync(path.join(dir, 'session-prs'))).toBe(false);
  });

  it('keeps only the three fields, and skips entries a hand edit broke', () => {
    store.save(A, PR1, { ...notes('r'), extra: 'dropped' });
    fs.writeFileSync(file(), JSON.stringify({ ...JSON.parse(fs.readFileSync(file(), 'utf8')), [PR2]: { risks: 3 } }));
    expect(store.read(A)).toEqual({ [PR1]: notes('r') });
  });
});

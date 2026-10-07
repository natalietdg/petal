// Reply-box echoes: shown at once, replaced (never doubled) when the log catches up, dropped when they can't land.
import { describe, expect, it } from 'vitest';
import { add, echoes, reconcile, remove } from '../src/renderer/pending-echo';

const live = { state: 'live' as const, sessionId: 's1', promptCount: 3, busy: true };

describe('pending echo', () => {
  it('stays until the log has one more prompt than when it was sent', () => {
    const list = add([], 'hello', live);
    expect(reconcile(list, live)).toHaveLength(1);
    expect(reconcile(list, { ...live, promptCount: 4 })).toEqual([]);
  });

  it('two quick sends are replaced one at a time, oldest first', () => {
    const list = add(add([], 'one', live), 'two', live);
    expect(list.map((e) => e.target)).toEqual([4, 5]);
    expect(reconcile(list, { ...live, promptCount: 4 }).map((e) => e.text)).toEqual(['two']);
    expect(reconcile(list, { ...live, promptCount: 5 })).toEqual([]);
  });

  it('drops echoes when the session changes or Claude is no longer live', () => {
    const list = add([], 'hello', live);
    expect(reconcile(list, { ...live, sessionId: 's2' })).toEqual([]);
    expect(reconcile(list, { ...live, state: 'ended' })).toEqual([]);
  });

  it('adopts the session when sent before its file was readable', () => {
    const list = add([], 'first', { ...live, sessionId: null, promptCount: 0 });
    const kept = reconcile(list, { ...live, sessionId: 's9', promptCount: 0 });
    expect(kept.map((e) => e.sessionId)).toEqual(['s9']);
    expect(reconcile(kept, { ...live, sessionId: 's9', promptCount: 1 })).toEqual([]);
  });

  it('drops an echo the log never got once Claude has been idle for long', () => {
    const list = add([], 'lost', live, 0);
    expect(reconcile(list, { ...live, busy: false }, 60_000)).toHaveLength(1);
    expect(reconcile(list, { ...live, busy: true }, 600_000)).toHaveLength(1);
    expect(reconcile(list, { ...live, busy: false }, 600_000)).toEqual([]);
  });

  it('remove takes back one echo by key', () => {
    const list = add(add([], 'a', live), 'b', live);
    expect(remove(list, list[0]?.key ?? -1).map((e) => e.text)).toEqual(['b']);
  });

  it('skips slash commands and shell escapes, which never show as prompts', () => {
    expect(echoes('/clear')).toBe(false);
    expect(echoes('!ls')).toBe(false);
    expect(echoes('fix the bug')).toBe(true);
  });
});

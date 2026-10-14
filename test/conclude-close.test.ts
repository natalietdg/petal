// The "conclude closes the session" rule: once, after Claude's reply is done, never for a conclusion already there.
import { describe, expect, it } from 'vitest';
import { ConcludeWatch } from '../src/main/conclude-close';
import type { Conclusion } from '../src/shared/conclusion';

const ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER = 'aaaaaaaa-0000-4000-8000-000000000002';
const said = (conclusion: string, at = '2026-10-13T10:00:00.000Z'): Conclusion => ({ title: '', conclusion, result: '', impact: '', at });

// Ticks until the watch fires or gives up; returns how many ticks it took (or null).
function ticksToFire(watch: ConcludeWatch, busy = false, max = 10, concludeIsLatest = true): number | null {
  for (let n = 1; n <= max; n++) if (watch.tick({ busy, concludeIsLatest })) return n;
  return null;
}
const idle = { busy: false, concludeIsLatest: true };
const working = { busy: true, concludeIsLatest: true };

describe('ConcludeWatch', () => {
  it('fires once for a conclusion that arrives after the first read', () => {
    const watch = new ConcludeWatch();
    watch.read(ID, null);
    expect(watch.tick(working)).toBeNull(); // this tab's claude answers
    watch.read(ID, said('Shipped.'));
    expect(watch.tick(idle)).toBeNull(); // one quiet tick first
    expect(watch.tick(idle)).toBe(ID);
    expect(ticksToFire(watch)).toBeNull();
    watch.read(ID, said('Again.', '2026-10-13T11:00:00.000Z'));
    expect(ticksToFire(watch)).toBeNull();
  });

  it('never fires for a conclusion already in the log at the first read', () => {
    const watch = new ConcludeWatch();
    watch.read(ID, said('Old.'));
    watch.read(ID, said('Old.'));
    expect(ticksToFire(watch)).toBeNull();
  });

  it('does not fire while Claude is busy, and waits for the reply to stop changing', () => {
    const watch = new ConcludeWatch();
    watch.read(ID, null);
    watch.read(ID, said('Part'));
    expect(ticksToFire(watch, true)).toBeNull();
    watch.read(ID, said('Part one, part two.'));
    expect(watch.tick(working)).toBeNull();
    expect(watch.tick(idle)).toBeNull();
    watch.read(ID, said('Part one, part two, done.')); // a late line resets the quiet tick
    expect(watch.tick(idle)).toBeNull();
    expect(watch.tick(idle)).toBe(ID);
  });

  it('a new session or a reset takes a fresh baseline', () => {
    const watch = new ConcludeWatch();
    watch.read(ID, null);
    watch.read(OTHER, said('Concluded elsewhere before Petal looked.'));
    expect(ticksToFire(watch)).toBeNull();
    watch.reset();
    watch.read(ID, said('Concluded before the resume.'));
    expect(ticksToFire(watch)).toBeNull();
  });

  it('does nothing before any read', () => {
    expect(ticksToFire(new ConcludeWatch())).toBeNull();
  });

  it('bug 1: a "waiting" status (prompt on screen) counts as busy, so no close mid-prompt', () => {
    // The feed maps every status but 'idle' to busy; the watch must hold while that lasts.
    const watch = new ConcludeWatch();
    watch.read(ID, null);
    watch.read(ID, said('Part one.'));
    expect(ticksToFire(watch, true, 6)).toBeNull();
    expect(ticksToFire(watch)).toBe(2);
  });

  it('bug 3: a prompt she sent after "conclude" cancels the pending close', () => {
    const watch = new ConcludeWatch();
    watch.read(ID, null);
    expect(watch.tick(working)).toBeNull();
    watch.read(ID, said('Shipped.'));
    expect(watch.tick({ busy: true, concludeIsLatest: false })).toBeNull(); // "run the tests first" queued
    expect(ticksToFire(watch, false, 10, false)).toBeNull(); // the follow-up runs and finishes
    expect(ticksToFire(watch, true, 3, false)).toBeNull();
    expect(ticksToFire(watch, false, 10, false)).toBeNull();
  });

  it('bug 3: a fresh "conclude" after the cancelled one closes again', () => {
    const watch = new ConcludeWatch();
    watch.read(ID, null);
    watch.read(ID, said('First.'));
    expect(ticksToFire(watch, false, 5, false)).toBeNull(); // a follow-up came after it
    expect(watch.tick(working)).toBeNull();
    watch.read(ID, said('Second.', '2026-10-13T11:00:00.000Z'));
    expect(ticksToFire(watch)).toBe(2);
  });

  it('bug 4: a second tab on the same session never closes, since its own claude never worked on the conclude', () => {
    const other = new ConcludeWatch(); // tab B tails the same log; its claude stays idle
    other.read(ID, null);
    other.read(ID, said('Concluded in tab A.'));
    expect(ticksToFire(other, false, 10)).toBeNull();
  });

  it('bug 6: a conclusion half written at the first read never closes as it finishes streaming', () => {
    const watch = new ConcludeWatch();
    const at = '2026-10-13T10:00:00.000Z';
    watch.read(ID, said('Part', at)); // Petal restarted mid-answer
    expect(watch.tick(working)).toBeNull();
    watch.read(ID, said('Part one, part two.', at));
    watch.read(ID, said('Part one, part two, done.', at));
    expect(ticksToFire(watch)).toBeNull();
  });

  it('bug 6: a later conclude in that session still closes', () => {
    const watch = new ConcludeWatch();
    watch.read(ID, said('Part', '2026-10-13T10:00:00.000Z'));
    expect(watch.tick(working)).toBeNull();
    watch.read(ID, said('New answer.', '2026-10-13T12:00:00.000Z'));
    expect(ticksToFire(watch)).toBe(2);
  });
});

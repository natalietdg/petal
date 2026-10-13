// The "conclude closes the session" rule: once, after Claude's reply is done, never for a conclusion already there.
import { describe, expect, it } from 'vitest';
import { ConcludeWatch } from '../src/main/conclude-close';
import type { Conclusion } from '../src/shared/conclusion';

const ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER = 'aaaaaaaa-0000-4000-8000-000000000002';
const said = (conclusion: string, at = '2026-10-13T10:00:00.000Z'): Conclusion => ({ title: '', conclusion, result: '', impact: '', at });

// Ticks until the watch fires or gives up; returns how many ticks it took (or null).
function ticksToFire(watch: ConcludeWatch, busy = false, max = 10): number | null {
  for (let n = 1; n <= max; n++) if (watch.tick(busy)) return n;
  return null;
}

describe('ConcludeWatch', () => {
  it('fires once for a conclusion that arrives after the first read', () => {
    const watch = new ConcludeWatch();
    watch.read(ID, null);
    watch.read(ID, said('Shipped.'));
    expect(watch.tick(false)).toBeNull(); // one quiet tick first
    expect(watch.tick(false)).toBe(ID);
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
    expect(watch.tick(true)).toBeNull();
    expect(watch.tick(false)).toBeNull();
    watch.read(ID, said('Part one, part two, done.')); // a late line resets the quiet tick
    expect(watch.tick(false)).toBeNull();
    expect(watch.tick(false)).toBe(ID);
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
});

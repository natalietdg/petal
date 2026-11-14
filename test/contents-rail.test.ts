import { describe, expect, it } from 'vitest';
import { RAIL_MIN_GUTTER_PX, RAIL_TITLE_MAX, railTitle, showsRail } from '../src/shared/contents-rail';

describe('contents rail titles', () => {
  it('names a reply by its headline', () => {
    expect(railTitle('Redis reconnects on every login', 'Abstract. The pool is too small.')).toBe('Redis reconnects on every login');
  });

  it('falls back to the first sentence when there is no headline', () => {
    expect(railTitle(null, 'Tests pass on Node 22. Two flaky ones were retried.')).toBe('Tests pass on Node 22.');
    expect(railTitle('   ', 'Done.')).toBe('Done.');
  });

  it('clips long titles at a word, under the limit', () => {
    const title = railTitle('word '.repeat(40), '');
    expect(title.length).toBeLessThanOrEqual(RAIL_TITLE_MAX);
    expect(title.endsWith('word…')).toBe(true);
  });

  it('says Reply when a reply has no text at all', () => {
    expect(railTitle(null, '')).toBe('Reply');
  });
});

describe('when the contents rail shows', () => {
  it('needs two replies and room in the gutter', () => {
    expect(showsRail(2, RAIL_MIN_GUTTER_PX, false)).toBe(true);
    expect(showsRail(1, 900, false)).toBe(false);
    expect(showsRail(5, RAIL_MIN_GUTTER_PX - 1, false)).toBe(false);
  });

  it('never shows in Book, whose left page holds the margin notes', () => {
    expect(showsRail(5, 900, true)).toBe(false);
  });
});

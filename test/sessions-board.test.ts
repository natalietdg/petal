// The Sessions board's card model: headline, digest, status, sort and filter.
import { describe, expect, it } from 'vitest';
import {
  EMPTY_DIGEST, boardStatus, digestReplies, filterCards, lastUpdate, replyHeadline, sortCards, toCard,
  type BoardCard, type BoardSource,
} from '../src/shared/sessions-board';
import type { Conclusion } from '../src/shared/conclusion';

const T0 = Date.parse('2026-10-13T09:00:00.000Z');
const iso = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();
const conclusion = (at: string | null): Conclusion => ({ title: '', conclusion: 'Shipped the board', result: '', impact: '', at });

const source = (over: Partial<BoardSource> = {}): BoardSource => ({
  sessionId: 's1', tabId: null, name: 'Session', place: 'petal · main', busy: false, asking: false,
  updatedAt: T0, digest: EMPTY_DIGEST, conclusion: null, agents: 0, starred: false, ...over,
});

describe('replyHeadline', () => {
  it('takes the first line that is bold all the way through', () => {
    expect(replyHeadline('**The board ships today.**\n\nBody text.')).toBe('The board ships today.');
    expect(replyHeadline('__Underscore bold works too__')).toBe('Underscore bold works too');
  });

  it('skips a line that only starts bold, and code fences', () => {
    expect(replyHeadline('**Done:** wired it\n\n**Real headline**')).toBe('Real headline');
    expect(replyHeadline('```\n**not this**\n```\n**This one**')).toBe('This one');
  });

  it('does not take two bold runs on one line as one headline', () => {
    expect(replyHeadline('**a** and **b**\n**Headline**')).toBe('Headline');
  });

  it('never takes a labelled line such as Conclusion or Done as the headline', () => {
    expect(replyHeadline('**Conclusion:** shipped\n**Result:** done')).toBe('');
    expect(replyHeadline('- **Done**: wired it\nThen the rest.')).toBe('Then the rest.');
  });

  it('falls back to the first line of text, without markdown markers', () => {
    expect(replyHeadline('\n\n## Plan for `today`\nmore')).toBe('Plan for today');
    expect(replyHeadline('You are welcome.')).toBe('You are welcome.');
    expect(replyHeadline('')).toBe('');
  });
});

describe('digestReplies', () => {
  it('headline and time from the newest reply, status lines from the newest that has any', () => {
    const digest = digestReplies([
      { markdown: '**Newest reply**\n\nNo status lines here.', timestamp: iso(5) },
      { markdown: '**Older**\n\n**Doing:** wiring\n**Next:** tests', timestamp: iso(1) },
    ]);
    expect(digest).toEqual({ headline: 'Newest reply', lines: { doing: 'wiring', next: 'tests' }, at: T0 + 5 * 60_000 });
  });

  it('empty with no replies, and a null time for a bad timestamp', () => {
    expect(digestReplies([])).toEqual(EMPTY_DIGEST);
    expect(digestReplies([{ markdown: 'hi', timestamp: 'not a date' }]).at).toBeNull();
  });
});

describe('boardStatus', () => {
  const digest = { ...EMPTY_DIGEST, at: T0 };

  it('a prompt on screen is Waiting, even mid-turn', () => {
    expect(boardStatus({ busy: true, asking: true, conclusion: null, digest })).toBe('waiting');
  });

  it('busy is Working, otherwise Idle', () => {
    expect(boardStatus({ busy: true, asking: false, conclusion: null, digest })).toBe('working');
    expect(boardStatus({ busy: false, asking: false, conclusion: null, digest })).toBe('idle');
  });

  it('Concluded while nothing came after the conclude reply', () => {
    expect(boardStatus({ busy: false, asking: false, conclusion: conclusion(iso(0)), digest })).toBe('concluded');
    expect(boardStatus({ busy: false, asking: false, conclusion: conclusion(null), digest })).toBe('concluded');
    expect(boardStatus({ busy: false, asking: false, conclusion: conclusion(iso(-10)), digest })).toBe('idle');
    expect(boardStatus({ busy: true, asking: false, conclusion: conclusion(iso(0)), digest })).toBe('working');
  });
});

describe('toCard', () => {
  it('carries the conclusion line only when concluded', () => {
    expect(toCard(source({ conclusion: conclusion(null) })).conclusion).toBe('Shipped the board');
    expect(toCard(source({ busy: true, conclusion: conclusion(null) })).conclusion).toBeNull();
  });

  it('drops the raw flags and keeps the rest', () => {
    const card = toCard(source({ tabId: 't2', agents: 3, starred: true }));
    expect(card).toMatchObject({ sessionId: 's1', tabId: 't2', agents: 3, starred: true, status: 'idle' });
    expect(card).not.toHaveProperty('busy');
    expect(card).not.toHaveProperty('asking');
  });
});

describe('sortCards and filterCards', () => {
  const cards: BoardCard[] = [
    toCard(source({ sessionId: 'idle-old', updatedAt: T0 - 60_000 })),
    toCard(source({ sessionId: 'done', conclusion: conclusion(null), updatedAt: T0 + 60_000 })),
    toCard(source({ sessionId: 'work', busy: true, updatedAt: T0 - 120_000 })),
    toCard(source({ sessionId: 'idle-new', updatedAt: T0 })),
    toCard(source({ sessionId: 'wait', asking: true, updatedAt: T0 - 600_000 })),
  ];

  it('Waiting, then Working, then Idle newest first, then Concluded', () => {
    expect(sortCards(cards).map((c) => c.sessionId)).toEqual(['wait', 'work', 'idle-new', 'idle-old', 'done']);
  });

  it('does not reorder the list it was given', () => {
    const before = cards.map((c) => c.sessionId);
    sortCards(cards);
    expect(cards.map((c) => c.sessionId)).toEqual(before);
  });

  it('filters by status; Idle includes concluded sessions', () => {
    const ids = (filter: Parameters<typeof filterCards>[1]) => filterCards(sortCards(cards), filter).map((c) => c.sessionId);
    expect(ids('all')).toHaveLength(5);
    expect(ids('waiting')).toEqual(['wait']);
    expect(ids('working')).toEqual(['work']);
    expect(ids('idle')).toEqual(['idle-new', 'idle-old', 'done']);
  });
});

describe('lastUpdate', () => {
  it('the newest known time, or null', () => {
    expect(lastUpdate(T0, null, T0 + 5)).toBe(T0 + 5);
    expect(lastUpdate(null, undefined)).toBeNull();
  });
});

describe('replyHeadline fences', () => {
  it('skips a bold line inside a longer fence that a shorter one would have closed', () => {
    expect(replyHeadline(['````', '```', '**Not this**', '````', '**This one**'].join('\n'))).toBe('This one');
    expect(replyHeadline(['~~~', '```', '**Not this**', '~~~', '**Tilde closed**'].join('\n'))).toBe('Tilde closed');
  });
});

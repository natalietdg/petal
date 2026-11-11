import { describe, expect, it } from 'vitest';
import { entriesOf, relatedLine, relatedWork, shortFile, topicsOf, type SessionContext } from '../src/shared/context-store';

describe('relatedLine', () => {
  const s = (over: Partial<SessionContext>): SessionContext => ({ sessionId: 'x', cwd: null, repo: null, title: '', topics: [], entries: [], files: [], firstAt: null, lastAt: null, ...over });
  it('is nothing when nothing relates', () => {
    expect(relatedLine({ waitsOn: [], waitingOnThis: [], sharedTopics: {}, overlap: [] })).toBeNull();
  });
  it('leads with overlap, then earlier decisions, then later sessions', () => {
    const earlier = s({ sessionId: 'e', entries: [{ kind: 'decided', text: 'a' }, { kind: 'decided', text: 'b' }, { kind: 'next', text: 'c' }] });
    const work = { waitsOn: [earlier], waitingOnThis: [s({ sessionId: 'l' })], sharedTopics: {}, overlap: [{ file: '/r/a.ts', sessions: [earlier] }] };
    expect(relatedLine(work)).toBe('1 file also being changed elsewhere · 2 decisions made earlier · 1 later session builds on this');
  });
  it('counts earlier sessions when they decided nothing', () => {
    expect(relatedLine({ waitsOn: [s({ sessionId: 'e' })], waitingOnThis: [], sharedTopics: {}, overlap: [] })).toBe('1 earlier session');
  });
});

const session = (over: Partial<SessionContext>): SessionContext => ({
  sessionId: 's', cwd: null, repo: null, title: '', topics: [], entries: [], files: [], firstAt: null, lastAt: null, ...over,
});

describe('topicsOf', () => {
  it('collects the repo and ticket ids, once each', () => {
    expect(topicsOf(['AB#10496 is scoped. PAY-412 too, and AB#10496 again.'], 'admin-v3')).toEqual(['admin-v3', 'AB#10496', 'PAY-412']);
  });

  it('ignores ordinary words and short dashes', () => {
    expect(topicsOf(['a well-known fix, 2026-11-11, step 3'], null)).toEqual([]);
  });
});

describe('entriesOf', () => {
  it('reads decisions, open threads and the next line from the replies', () => {
    const newest = {
      id: '2', prompt: 'yes', markdown: '**Done.**\n\n**Next:** ship it\n\n## Open threads\n- Does it scale? *Check: load test.*\n',
    };
    const older = { id: '1', prompt: 'go', markdown: '**Decide:** flag at 10% or 50%?' };
    const entries = entriesOf([newest, older]);
    expect(entries).toContainEqual({ kind: 'next', text: 'ship it' });
    expect(entries).toContainEqual({ kind: 'open', text: 'Does it scale?' });
    expect(entries).toContainEqual({ kind: 'decided', text: 'Flag at 10% or 50%? · yes' });
  });
});

describe('relatedWork', () => {
  const me = session({ sessionId: 'me', topics: ['petal', 'AB#1'], files: ['/r/a.ts', '/r/b.ts'], firstAt: 100 });
  const earlier = session({ sessionId: 'earlier', topics: ['AB#1'], files: ['/r/a.ts'], firstAt: 50, lastAt: 60 });
  const later = session({ sessionId: 'later', topics: ['petal'], files: [], firstAt: 200, lastAt: 210 });
  const unrelated = session({ sessionId: 'other', topics: ['sweep'], files: ['/r/b.ts'], firstAt: 10 });

  it('splits related sessions by when they started and keeps the shared topics', () => {
    const related = relatedWork(me, [earlier, later, unrelated, me]);
    expect(related.waitsOn.map((s) => s.sessionId)).toEqual(['earlier']);
    expect(related.waitingOnThis.map((s) => s.sessionId)).toEqual(['later']);
    expect(related.sharedTopics).toEqual({ earlier: ['AB#1'], later: ['petal'] });
  });

  it('lists a file edited here and in any other session, related or not', () => {
    const { overlap } = relatedWork(me, [earlier, later, unrelated]);
    expect(overlap.map((o) => [o.file, o.sessions.map((s) => s.sessionId)])).toEqual([['/r/a.ts', ['earlier']], ['/r/b.ts', ['other']]]);
  });

  it('shortens a path to its last two segments', () => {
    expect(shortFile('/Users/x/repo/src/renderer/reader.ts')).toBe('renderer/reader.ts');
  });
});

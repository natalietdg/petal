import { describe, expect, it } from 'vitest';
import { codeFenceTracker, newestStatus, parseStatus, parseStatusLine } from '../src/shared/status-lines';

const REPLY = [
  '**Cycles already live in Work.**',
  '',
  'Abstract paragraph.',
  '',
  '**Doing:** tracing where withdrawal cycles are stored across five repos.',
  '**Recommend:** store cycles in Work\'s table rather than rebuilding them.',
  '**Next:** I draft the two API contracts once the trace reports.',
].join('\n');

describe('parseStatus', () => {
  it('reads the three bold lines', () => {
    expect(parseStatus(REPLY)).toEqual({
      doing: 'tracing where withdrawal cycles are stored across five repos.',
      recommend: 'store cycles in Work\'s table rather than rebuilding them.',
      next: 'I draft the two API contracts once the trace reports.',
    });
  });

  it('reads plain labels, a colon outside the bold, and no trailing period', () => {
    expect(parseStatus('Doing: tracing\n**Recommend**: keep it\nNext: ship')).toEqual({ doing: 'tracing', recommend: 'keep it', next: 'ship' });
  });

  it('accepts mixed case labels', () => {
    expect(parseStatus('DOING: a\n**recommend:** b\nnExT: c')).toEqual({ doing: 'a', recommend: 'b', next: 'c' });
  });

  it('leaves missing items out', () => {
    expect(parseStatus('Intro.\n\n**Next:** run it.')).toEqual({ next: 'run it.' });
    expect(parseStatus('Nothing to see.')).toEqual({});
  });

  it('ignores lines inside code fences', () => {
    expect(parseStatus('```\nDoing: inside a fence\n```\n~~~\nNext: also inside\n~~~\nRecommend: outside')).toEqual({ recommend: 'outside' });
  });

  it('ignores labels mid-sentence or without text', () => {
    expect(parseStatus('The next: thing\nDoing:\nNextly: no')).toEqual({});
  });

  it('keeps the first of a repeated label and strips inline markers', () => {
    expect(parseStatus('Next: run `npm test` first\nNext: later')).toEqual({ next: 'run npm test first' });
  });
});

describe('parseStatusLine', () => {
  it('returns the key and the raw sentence', () => {
    expect(parseStatusLine('  **Next:** run `claude`')).toEqual({ key: 'next', text: 'run `claude`' });
    expect(parseStatusLine('Done: x')).toBeNull();
  });
});

describe('newestStatus', () => {
  it('takes the newest reply that has any line', () => {
    expect(newestStatus(['no lines here', 'Doing: newer', 'Doing: older\nNext: older next'])).toEqual({ doing: 'newer' });
  });

  it('is null when no reply has them', () => {
    expect(newestStatus(['a', 'b'])).toBeNull();
    expect(newestStatus([])).toBeNull();
  });
});

describe('code fences and indentation', () => {
  it('a shorter or different fence inside a block does not close it', () => {
    const md = ['````md', '```', '**Doing:** inside', '~~~', '````', '**Next:** outside'].join('\n');
    expect(parseStatus(md)).toEqual({ next: 'outside' });
    expect(parseStatus(['~~~', '```', 'Doing: inside', '~~~', 'Doing: out'].join('\n'))).toEqual({ doing: 'out' });
  });

  it('a closing fence takes no info string; an opener may', () => {
    expect(parseStatus(['```ts', 'Next: a', '```ts', 'Next: b', '```', 'Next: c'].join('\n'))).toEqual({ next: 'c' });
  });

  it('4-space indented lines are code, not status lines; up to 3 spaces still count', () => {
    expect(parseStatus('    **Doing:** code sample')).toEqual({});
    expect(parseStatus('\t**Doing:** code sample')).toEqual({});
    expect(parseStatus('   **Doing:** real')).toEqual({ doing: 'real' });
    expect(parseStatus('    ```\nDoing: x')).toEqual({ doing: 'x' }); // an indented fence opens nothing
  });

  it('tracker marks fence lines and their contents', () => {
    const inCode = codeFenceTracker();
    expect(['a', '```js', 'b', '``', '```', 'c', '``` x`y', 'd'].map(inCode)).toEqual([false, true, true, true, true, false, false, false]);
  });
});

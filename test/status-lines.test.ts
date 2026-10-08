import { describe, expect, it } from 'vitest';
import { newestStatus, parseStatus, parseStatusLine } from '../src/shared/status-lines';

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

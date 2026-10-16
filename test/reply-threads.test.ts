import { describe, expect, it } from 'vitest';
import { isAssumedTitle, isCheckedLabel, isOpenThreadsHeading, parseThreads, sameThread, splitThread, threadCheckStart, threadNeedsYou, threadPrompt } from '../src/shared/reply-threads';
import { isOpen, newFold } from '../src/shared/reply-fold';

describe('isOpenThreadsHeading', () => {
  it.each(['Open threads', 'open threads', 'OPEN THREADS', 'Open thread', '4. Open threads', '4) Open threads', '  Open threads:  ', 'Open  threads'])('matches %j', (text) => {
    expect(isOpenThreadsHeading(text)).toBe(true);
  });

  it.each(['Threads', 'Open questions', 'Open threads to pull', 'Opening threads', 'Steps', 'References', ''])('leaves %j alone', (text) => {
    expect(isOpenThreadsHeading(text)).toBe(false);
  });
});

describe('labels', () => {
  it('spots the Checked label and the Assumed title', () => {
    expect(isCheckedLabel('Checked:')).toBe(true);
    expect(isCheckedLabel('checked')).toBe(true);
    expect(isCheckedLabel('Checked out:')).toBe(false);
    expect(isAssumedTitle('Assumed')).toBe(true);
    expect(isAssumedTitle('Assumed:')).toBe(true);
    expect(isAssumedTitle('Assumptions')).toBe(false);
  });
});

describe('splitThread', () => {
  it('splits the question from its Check', () => {
    expect(splitThread('Does the cache expire? Check: read src/cache.ts:40.')).toEqual({ question: 'Does the cache expire?', check: 'read src/cache.ts:40.' });
  });

  it('keeps an item without a Check whole', () => {
    expect(splitThread('Is the old flag still read anywhere?')).toEqual({ question: 'Is the old flag still read anywhere?', check: null });
  });

  it('reads the text of nested formatting as plain words', () => {
    // "Does `getClient()` reuse **one** client? *Check: run `npm test`*" once rendered
    expect(splitThread('Does getClient() reuse one client? Check: run npm test')).toEqual({ question: 'Does getClient() reuse one client?', check: 'run npm test' });
  });

  it('takes the last Check, so a question that mentions checking stays whole', () => {
    const text = 'Should the check: label be bold? Check: the shape guide.';
    expect(threadCheckStart(text)).toBe(text.lastIndexOf('Check:'));
    expect(splitThread(text).question).toBe('Should the check: label be bold?');
  });

  it('drops brackets around a Check and folds whitespace', () => {
    expect(splitThread('Is it   deployed?\n(Check: the image tag)')).toEqual({ question: 'Is it deployed?', check: 'the image tag' });
  });

  it('never treats a leading Check as the split, or a word that only ends in check', () => {
    expect(splitThread('Check: is this a question?')).toEqual({ question: 'Check: is this a question?', check: null });
    expect(threadCheckStart('Run the precheck: then what?')).toBe(-1);
  });

  it('an empty Check counts as none', () => {
    expect(splitThread('Is it live? Check:')).toEqual({ question: 'Is it live?', check: null });
  });
});

describe('threadPrompt', () => {
  it('sends the question with its check', () => {
    expect(threadPrompt({ question: 'Is it live?', check: 'curl /health' })).toBe('Is it live? Check: curl /health');
    expect(threadPrompt({ question: 'Is it live?', check: null })).toBe('Is it live?');
  });
});

describe('Open threads in the fold state', () => {
  it('starts open like Steps', () => {
    expect(isOpen(newFold(), 2, true)).toBe(true);
  });
});

describe('parseThreads', () => {
  it('reads the section’s items from markdown, emphasis and links dropped, continuation lines joined', () => {
    const md = 'Intro.\n\n## Open threads\n- Does the cache expire? *Check: read [cache.ts](src/cache.ts) line 40*\n- Is **retry** safe\n  on a 503? Check: `npm test -- retry`\n\n## Next\n- not a thread';
    expect(parseThreads(md)).toEqual([
      { question: 'Does the cache expire?', check: 'read cache.ts line 40' },
      { question: 'Is retry safe on a 503?', check: 'npm test -- retry' },
    ]);
  });
  it('skips code fences and stops at a bold label line', () => {
    expect(parseThreads('```\n## Open threads\n- in code\n```\nNo threads.')).toEqual([]);
    expect(parseThreads('### 4. Open threads\n- One? Check: x\n**Loop:** round 1/2 · testing\n- after')).toEqual([{ question: 'One?', check: 'x' }]);
  });
  it('spots needs-you checks and the same thread reworded', () => {
    expect(threadNeedsYou({ question: 'q', check: 'needs you · the product rule' })).toBe(true);
    expect(threadNeedsYou({ question: 'q', check: 'read api.ts' })).toBe(false);
    expect(sameThread('Is tax rounded per line in the API as well?', 'Is tax rounded per line in the API too?')).toBe(true);
    expect(sameThread('Is tax rounded per line?', 'Does the retry test fail on a slow network?')).toBe(false);
  });
});

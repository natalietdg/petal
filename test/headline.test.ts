import { describe, expect, it } from 'vitest';
import { HEADLINE_WORD_BUDGET, headlineOverBudget, sessionWordsLine, wordCount } from '../src/shared/headline';

describe('sessionWordsLine', () => {
  it('sums every reply and rounds past a thousand', () => {
    expect(sessionWordsLine(['one two', 'three'])).toBe('3 words this session');
    expect(sessionWordsLine([Array(1250).fill('w').join(' ')])).toBe('1.3k words this session');
    expect(sessionWordsLine([Array(12_400).fill('w').join(' ')])).toBe('12k words this session');
  });
});

describe('headline word budget', () => {
  it('counts words across any whitespace', () => {
    expect(wordCount('Redis reconnects   on every\nlogin')).toBe(5);
    expect(wordCount('   ')).toBe(0);
  });

  it('is quiet at ten words and under', () => {
    expect(headlineOverBudget('One two three four five six seven eight nine ten')).toBeNull();
    expect(headlineOverBudget('The build tab needs a spec')).toBeNull();
  });

  it('returns the count once the budget is passed', () => {
    const eleven = Array.from({ length: HEADLINE_WORD_BUDGET + 1 }, (_, i) => `w${i}`).join(' ');
    expect(headlineOverBudget(eleven)).toBe(11);
  });
});

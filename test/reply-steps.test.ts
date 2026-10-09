import { describe, expect, it } from 'vitest';
import { checkLineStart, isCheckLine, isStepsHeading, stepRuns, stripCheckLabel, type StepBlock } from '../src/shared/reply-steps';
import { allOpen, isOpen, newFold, setAll, toggleDone, toggleSection } from '../src/shared/reply-fold';

describe('isStepsHeading', () => {
  it.each(['Steps', 'steps', 'STEPS', 'Steps to deploy', 'Steps to …', '3. Steps', '3.Steps', '2) Steps to ship', '  Steps:  '])('matches %j', (text) => {
    expect(isStepsHeading(text)).toBe(true);
  });

  it.each(['Next steps', 'Stepsister', 'Steps 2', 'How the steps work', 'Step', 'References', ''])('leaves %j alone', (text) => {
    expect(isStepsHeading(text)).toBe(false);
  });
});

describe('Check lines', () => {
  it('spots a Check line in any case, with or without a space', () => {
    expect(isCheckLine('Check: the app opens')).toBe(true);
    expect(isCheckLine('  check :it opens')).toBe(true);
    expect(isCheckLine('Checkout the branch')).toBe(false);
    expect(isCheckLine('Run it. Check: later')).toBe(false);
  });

  it('drops only the label', () => {
    expect(stripCheckLabel('Check: the tick shows')).toBe('the tick shows');
    expect(stripCheckLabel('Check:  Check: twice')).toBe('Check: twice');
  });

  it('finds a Check line written under the action without a blank line', () => {
    expect(checkLineStart('Run npm test\nCheck: it passes')).toBe(12);
    expect(checkLineStart('Run npm test\n   check: it passes')).toBe(12);
    expect(checkLineStart('Run npm test. Check: inline is not a line')).toBe(-1);
    expect(checkLineStart('Check: at the very start is the whole item')).toBe(-1);
  });
});

describe('stepRuns', () => {
  it('turns each list into a run', () => {
    expect(stepRuns(['list'])).toEqual([[0]]);
  });

  it('joins lists split by Check lines into one run numbered straight through', () => {
    expect(stepRuns(['list', 'check', 'list', 'check'])).toEqual([[0, 1, 2, 3]]);
  });

  it('ends a run at any other block', () => {
    const blocks: StepBlock[] = ['other', 'list', 'other', 'list', 'check'];
    expect(stepRuns(blocks)).toEqual([[1], [3, 4]]);
  });

  it('ignores a Check line with no step above it', () => {
    expect(stepRuns(['check', 'other', 'check'])).toEqual([]);
  });
});

describe('Steps in the fold state', () => {
  it('a Steps section starts open while the others start folded', () => {
    const state = newFold();
    const steps = new Set([1]);
    expect([0, 1, 2].map((i) => isOpen(state, i, steps.has(i)))).toEqual([false, true, false]);
    expect(allOpen(state, 3, steps)).toBe(false);
  });

  it('folds by hand, and Collapse all folds it with the rest', () => {
    const state = newFold();
    toggleSection(state, 1);
    expect(isOpen(state, 1, true)).toBe(false);
    setAll(state, true);
    expect(allOpen(state, 3, new Set([1]))).toBe(true);
    setAll(state, false);
    expect(isOpen(state, 1, true)).toBe(false);
  });

  it('ticks and unticks a step, leaving the others', () => {
    const state = newFold();
    expect(toggleDone(state, '1:1')).toBe(true);
    expect(toggleDone(state, '1:2')).toBe(true);
    expect(toggleDone(state, '1:1')).toBe(false);
    expect([...state.done]).toEqual(['1:2']);
  });

  it('opening sections never touches the ticks', () => {
    const state = newFold();
    toggleDone(state, '0:3');
    setAll(state, true);
    toggleSection(state, 0);
    expect(state.done.has('0:3')).toBe(true);
  });
});

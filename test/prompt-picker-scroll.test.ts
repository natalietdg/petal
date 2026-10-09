// The picker as Claude Code 2.1.29x draws a long question: a │ gutter, scroll markers, options cut off the screen.
// Synthetic screens with the same structure as the one seen live on 2.1.295 (wording made generic).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseQuestionPicker, type QuestionPage } from '../src/shared/prompt-answer';
import { pickerKeys } from '../src/main/prompt-keys';

const screen = (name: string): string[] => fs.readFileSync(path.join(__dirname, 'fixtures', 'screens', `${name}.txt`), 'utf8').split('\n');
const page = (name: string): QuestionPage => {
  const picker = parseQuestionPicker(screen(name));
  expect(picker?.page).toBe('question');
  return picker as QuestionPage;
};

const QUESTION_SCROLLED = '"Combine both": which do you mean? Note: the switch to the new contract stopped halfway (uncommitted … on the server are still the old reused-route version.';

describe('parseQuestionPicker on a scrolled picker with a gutter question', () => {
  it('reads the live shape: │ question, ↓ marker, options 1-2 visible, Chat about this as 5', () => {
    const picker = page('q295-scrolled');
    expect(picker).toMatchObject({ tabs: [], header: '', question: QUESTION_SCROLLED, multiSelect: false, chat: 5, hidden: [3], otherShown: false });
    expect(picker.options).toEqual([
      { number: 1, label: 'Combine both contracts (Recommended)', description: 'The new contract plus what ours has that it lacks (pending states, past records, code mapp… rebuild, then report.', checked: false, focused: true },
      { number: 2, label: 'Merge the two open changes now', description: 'Merge the current versions (old reused-route design) to main. The half-done rebuild…', checked: false, focused: false },
    ]);
    expect(picker.other).toMatchObject({ number: 4 });
  });

  it('reads it under Claude output, a ☐ header and with the cursor on Chat about this', () => {
    const picker = page('q295-scrolled-above');
    expect(picker).toMatchObject({ header: 'Merge', question: QUESTION_SCROLLED, chat: 5, hidden: [3], otherShown: false });
    expect(picker.options.map((o) => o.focused)).toEqual([false, false]);
  });

  it('reads an ↑ marker: option 1 scrolled off the top, the free-text slot on screen', () => {
    const picker = page('q295-scrolled-top');
    expect(picker).toMatchObject({ header: 'Merge', chat: 5, hidden: [1], otherShown: true, other: { number: 4, label: 'Type something.' } });
    expect(picker.options.map((o) => [o.number, o.label, o.focused])).toEqual([[2, 'Merge the two open changes now', false], [3, 'Finish the rebuild first', true]]);
  });

  it('reads every option when nothing is scrolled', () => {
    const picker = page('q295-all-visible');
    expect(picker).toMatchObject({ header: 'Merge', chat: 5, hidden: [], otherShown: true, other: { number: 4 } });
    expect(picker.question).toBe('"Combine both": which do you mean? Note: the switch to the new contract stopped halfway (uncommitted), and the open changes are still the old version.');
    expect(picker.options.map((o) => o.number)).toEqual([1, 2, 3]);
    expect(picker.options[0]?.description).toBe('The new contract plus what ours has that it lacks, rebuild, then report.');
  });

  it('reads a tab row above a gutter question', () => {
    const picker = page('q295-tabs-gutter');
    expect(picker).toMatchObject({ tabs: [{ header: 'Merge', answered: false }, { header: 'Order', answered: false }], header: '', chat: 5, hidden: [3] });
  });

  it('keeps the older shapes: chat number and every option on screen', () => {
    expect(page('q293-single')).toMatchObject({ chat: 4, hidden: [], otherShown: true, other: { number: 3 } });
    expect(page('q293-tabs-first')).toMatchObject({ chat: 5, hidden: [], otherShown: true });
    expect(page('q293-multiselect')).toMatchObject({ chat: 5, hidden: [], multiSelect: true });
  });

  it('refuses near misses on the scrolled shape', () => {
    const lines = screen('q295-scrolled');
    expect(parseQuestionPicker(lines.map((l) => l.replace('↓ 2.', '↓ 3.')))).toBeNull(); // gap in the visible numbers
    expect(parseQuestionPicker(lines.map((l) => l.replace('5. Chat about this', '2. Chat about this')))).toBeNull(); // chat inside the options
    expect(parseQuestionPicker(lines.filter((l) => !l.startsWith('│')))).toBeNull(); // no question
    expect(parseQuestionPicker([...lines, '% '])).toBeNull();
  });
});

describe('answer keys reach options the picker has scrolled away', () => {
  // Claude Code's select maps digit k to options[k-1] of the whole list, not the visible window (2.1.295 bundle).
  it('sends the option number as one digit, and Chat about this by its own number', () => {
    expect(pickerKeys({ pick: 1 })).toEqual(['1']);
    expect(pickerKeys({ pick: 3 })).toEqual(['3']);
    expect(pickerKeys({ pick: 5 })).toEqual(['5']);
    expect(pickerKeys({ other: 4, text: 'both, then report' })).toEqual(['4', 'both, then report', '\r']);
  });
});

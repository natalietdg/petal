// Screens captured from real Claude Code 2.1.291, 2.1.293 and 2.1.301 (paths renamed): the permission and question-picker parsers.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePermissionPrompt, parseQuestionPicker, screenIsAsking } from '../src/shared/prompt-answer';

const screen = (name: string): string[] => fs.readFileSync(path.join(__dirname, 'fixtures', 'screens', `${name}.txt`), 'utf8').split('\n');

describe('parsePermissionPrompt', () => {
  it('reads the Bash prompt: title, command, question and the three numbered options', () => {
    expect(parsePermissionPrompt(screen('permission-bash'))).toEqual({
      title: 'Bash command',
      details: ['List files in /private/tmp with details', 'ls -la /private/tmp'],
      question: 'Do you want to proceed?',
      options: [
        { number: 1, label: 'Yes' },
        { number: 2, label: 'Yes, allow reading from /private/tmp from this project' },
        { number: 3, label: 'No' },
      ],
    });
  });

  it('joins an option that wraps onto an indented second line', () => {
    const parsed = parsePermissionPrompt(screen('permission-read-wrapped'));
    expect(parsed?.title).toBe('Read file');
    expect(parsed?.options.map((o) => o.number)).toEqual([1, 2, 3]);
    expect(parsed?.options[1]?.label).toMatch(/^Yes, allow reading from \/private\/tmp\/.*scratchpad\/probe during this session$/);
    expect(parsed?.options[1]?.label).not.toMatch(/\s{2}/);
  });

  it.each(['question-single', 'question-two', 'question-multiselect', 'question-review', 'idle-after-answer', 'q293-tabs-first', 'q293-review'])('finds nothing on %s', (name) => {
    expect(parsePermissionPrompt(screen(name))).toBeNull();
  });

  it('refuses near misses: anything below the footer, no cursor, two cursors, a gap in the numbers', () => {
    const lines = screen('permission-bash');
    const footer = lines.findIndex((line) => line.includes('Esc to cancel'));
    const withShellBelow = [...lines.slice(0, footer + 1), '% '];
    expect(parsePermissionPrompt(withShellBelow)).toBeNull();
    expect(parsePermissionPrompt(lines.map((line) => line.replace('❯', ' ')))).toBeNull();
    expect(parsePermissionPrompt(lines.map((line) => line.replace('   3. No', ' ❯ 3. No')))).toBeNull();
    expect(parsePermissionPrompt(lines.map((line) => line.replace('   3. No', '   4. No')))).toBeNull();
    expect(parsePermissionPrompt(lines.map((line) => line.replace('Do you want to proceed?', 'Proceed now')))).toBeNull();
    // No rule and a blank top row: not a prompt cut off by the screen's edge.
    expect(parsePermissionPrompt(lines.filter((line) => !/^─+$/.test(line.trim())))).toBeNull();
  });

  it('finds nothing on an empty or blank screen', () => {
    expect(parsePermissionPrompt([])).toBeNull();
    expect(parsePermissionPrompt(['', '   ', ''])).toBeNull();
  });
});

describe('parsePermissionPrompt on live 2.1.301 screens', () => {
  const YES_NO_AUTO = ['Yes', 'Yes, and switch to auto mode · auto mode handles these prompts for you', 'No'];

  it('reads the rule-topped prompt: title, details without the Tip row, four options', () => {
    const parsed = parsePermissionPrompt(screen('p301-permission-rule'));
    expect(parsed).toMatchObject({ title: 'Bash command', details: ['Create a marker file', 'touch walk-permission.txt'], question: 'Do you want to proceed?' });
    expect(parsed?.options.map((o) => o.number)).toEqual([1, 2, 3, 4]);
    expect(parsed?.options[1]?.label).toMatch(/^Yes, and always allow access to \/private\/tmp\/.+walk-shop from this project$/);
    expect([0, 2, 3].map((i) => parsed?.options[i]?.label)).toEqual(YES_NO_AUTO);
  });

  it('reads the prompt when the rule and title have scrolled off the top', () => {
    const parsed = parsePermissionPrompt(screen('p301-permission-scrolled'));
    expect(parsed).toMatchObject({ title: 'Permission', details: ['Create a marker file', 'touch walk-permission.txt'], question: 'Do you want to proceed?' });
    expect(parsed?.options.map((o) => o.number)).toEqual([1, 2, 3, 4]);
    expect(parsed?.options[1]?.label).toMatch(/^Yes, and always allow access to \/private\/tmp\/.+home-dev from this project$/);
  });

  it('reads a scrolled-off prompt with a blank row above the question', () => {
    const parsed = parsePermissionPrompt(screen('p301-permission-scrolled-gap'));
    expect(parsed?.details).toEqual(['Run the unit tests', 'npx vitest run', 'This command requires approval']);
    expect(parsed?.options.map((o) => o.label)).toEqual(['Yes', 'Yes, and don’t ask again for: npx vitest *', ...YES_NO_AUTO.slice(1)]);
  });

  it('still refuses ambiguous options once the rule has scrolled off', () => {
    const lines = screen('p301-permission-scrolled');
    expect(parsePermissionPrompt(lines.map((line) => line.replace('❯', ' ')))).toBeNull();
    expect(parsePermissionPrompt(lines.map((line) => line.replace('   4. No', ' ❯ 4. No')))).toBeNull();
    expect(parsePermissionPrompt(lines.map((line) => line.replace('   4. No', '   5. No')))).toBeNull();
    expect(parsePermissionPrompt(lines.map((line) => line.replace('   3. Yes', '   3 Yes')))).toBeNull();
    expect(parsePermissionPrompt(['', ...lines])).toBeNull();
    expect(parsePermissionPrompt([...lines, '% '])).toBeNull();
  });

  it.each(['p301-question-cut', 'q295-all-visible', 'builtin-model-team', 'builtin-model-api'])('finds no permission prompt on %s, but the screen is asking', (name) => {
    expect(parsePermissionPrompt(screen(name))).toBeNull();
    expect(screenIsAsking(screen(name))).toBe(true);
  });

  // An idle 2.1.301 screen: Claude's reply holds a numbered list and the question text, the input box sits below.
  const IDLE_WITH_NUMBERS = [
    ' Do you want to proceed?',
    ' ❯ 1. Yes',
    '   2. No',
    '',
    '⏺ Those are the two choices the prompt offered. Pick one of:',
    '  1. Run the tests',
    '  2. Skip them',
    '',
    '────────────────────────────────────────────────────────────────────────────────────────────────────',
    '❯ ',
    '────────────────────────────────────────────────────────────────────────────────────────────────────',
    '  ? for shortcuts',
  ];

  it('finds nothing on an idle screen whose reply quotes numbered options', () => {
    expect(parsePermissionPrompt(IDLE_WITH_NUMBERS)).toBeNull();
    expect(parsePermissionPrompt(IDLE_WITH_NUMBERS.slice(0, 3))).toBeNull();
    expect(screenIsAsking(IDLE_WITH_NUMBERS)).toBe(false);
  });

  it.each(['p301-permission-rule', 'p301-permission-scrolled', 'p301-permission-scrolled-gap', 'permission-bash', 'permission-read-wrapped', 'trust-folder'])('screenIsAsking says asking on %s', (name) => {
    expect(screenIsAsking(screen(name))).toBe(true);
  });
});

describe('parseQuestionPicker on live 2.1.293 screens', () => {
  it('reads the first tab of two: tab bar, question, options with descriptions, the free-text slot', () => {
    const picker = parseQuestionPicker(screen('q293-tabs-first'));
    expect(picker).toMatchObject({
      page: 'question',
      tabs: [{ header: 'Palette', answered: false }, { header: 'Accent', answered: false }],
      header: '',
      question: 'Which overall colour palette should we use?',
      multiSelect: false,
      other: { number: 4, label: 'Type something.', checked: false },
    });
    expect(picker?.page === 'question' && picker.options.map((o) => o.label)).toEqual(['Light neutral (Recommended)', 'Dark neutral', 'Brand colours']);
    expect(picker?.page === 'question' && picker.options[1]?.description)
      .toBe('Dark background with light text. Easier on the eyes at night, but harder to read in bright light.');
  });

  it('reads the second tab once the first is answered', () => {
    const picker = parseQuestionPicker(screen('q293-tabs-second'));
    expect(picker).toMatchObject({ page: 'question', tabs: [{ answered: true }, { answered: false }], question: 'Which accent colour should highlight key items like callouts and links?' });
  });

  it('reads a lone question by its ☐ header, and her typed text in the free-text slot', () => {
    expect(parseQuestionPicker(screen('q293-single'))).toMatchObject({
      page: 'question', tabs: [], header: 'Fruit', question: 'Which fruit do you prefer?', multiSelect: false,
      options: [{ number: 1, label: 'Apple (Recommended)', description: 'Crisp and sweet, and easy to carry.' }, { number: 2, label: 'Mango' }],
      other: { number: 3, label: 'Type something.' },
    });
    expect(parseQuestionPicker(screen('q293-single-typing'))).toMatchObject({ page: 'question', other: { number: 3, label: 'kiwi' } });
  });

  it('reads multiSelect boxes and their ticks, skipping the Next row', () => {
    const fresh = parseQuestionPicker(screen('q293-multiselect'));
    expect(fresh).toMatchObject({ page: 'question', multiSelect: true, other: { number: 4, label: 'Type something', description: '' } });
    expect(fresh?.page === 'question' && fresh.options.map((o) => o.checked)).toEqual([false, false, false]);
    const ticked = parseQuestionPicker(screen('q293-multiselect-checked'));
    expect(ticked?.page === 'question' && ticked.options.map((o) => o.checked)).toEqual([true, false, true]);
    expect(ticked?.page === 'question' && ticked.tabs[0]?.answered).toBe(true);
  });

  it('marks the typed answer on a tab she came back to', () => {
    expect(parseQuestionPicker(screen('q293-tabs-typed'))).toMatchObject({ page: 'question', other: { label: 'teal', checked: true } });
  });

  it('reads the review page: every answer, and whether some are missing', () => {
    expect(parseQuestionPicker(screen('q293-review'))).toEqual({
      page: 'review',
      tabs: [{ header: 'Palette', answered: true }, { header: 'Accent', answered: true }],
      answers: [
        { question: 'Which overall colour palette should we use?', answer: 'Light neutral (Recommended)' },
        { question: 'Which accent colour should highlight key items like callouts and links?', answer: 'Indigo' },
      ],
      complete: true,
    });
    expect(parseQuestionPicker(screen('q293-review-multi'))).toMatchObject({ page: 'review', answers: [{ answer: 'Apple, Plum' }, { answer: 'teal' }], complete: true });
    expect(parseQuestionPicker(screen('q293-review-unanswered'))).toMatchObject({ page: 'review', answers: [], complete: false });
  });

  it('still reads the 2.1.291 screens the same way', () => {
    expect(parseQuestionPicker(screen('question-single'))).toMatchObject({ page: 'question', header: 'Fruit choice', question: 'Which fruit would you prefer?' });
    expect(parseQuestionPicker(screen('question-two'))).toMatchObject({ page: 'question', tabs: [{ header: 'Fruit' }, { header: 'Color' }] });
    expect(parseQuestionPicker(screen('question-multiselect'))).toMatchObject({ page: 'question', multiSelect: true });
    expect(parseQuestionPicker(screen('question-review'))).toMatchObject({ page: 'review', answers: [{ answer: 'Pear' }, { answer: 'Red' }] });
  });

  it('reads trailing spaces the way xterm hands them over', () => {
    expect(parseQuestionPicker(screen('q293-tabs-first').map((line) => line.padEnd(100)))).toMatchObject({ page: 'question' });
  });

  it.each(['q293-idle-after-answer', 'idle-after-answer', 'permission-bash', 'permission-read-wrapped'])('finds nothing on %s', (name) => {
    expect(parseQuestionPicker(screen(name))).toBeNull();
  });

  it('refuses near misses: text below the picker, a gap in the numbers, a tab bar without Submit', () => {
    const lines = screen('q293-tabs-first');
    const footer = lines.findIndex((line) => line.startsWith('Enter to select'));
    expect(parseQuestionPicker([...lines.slice(0, footer + 1), '% '])).toBeNull();
    expect(parseQuestionPicker(lines.map((line) => line.replace('  3. Brand colours', '  7. Brand colours')))).toBeNull();
    expect(parseQuestionPicker(lines.map((line) => line.replace('✔ Submit', '✔ Done')))).toBeNull();
    expect(parseQuestionPicker(lines.filter((line) => !line.includes('Chat about this')))).toBeNull();
    const review = screen('q293-review');
    expect(parseQuestionPicker(review.map((line) => line.replace('Ready to submit your answers?', 'Ready?')))).toBeNull();
  });

  it('finds nothing on an empty or blank screen', () => {
    expect(parseQuestionPicker([])).toBeNull();
    expect(parseQuestionPicker(['', '   '])).toBeNull();
  });
});

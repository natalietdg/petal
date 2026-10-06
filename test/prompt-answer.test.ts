// Screens captured from a real Claude Code 2.1.291 (paths renamed): the permission parser and the question check.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePermissionPrompt, questionOnScreen } from '../src/shared/prompt-answer';

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

  it.each(['question-single', 'question-two', 'question-multiselect', 'question-review', 'idle-after-answer'])('finds nothing on %s', (name) => {
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
    expect(parsePermissionPrompt(lines.filter((line) => !/^─+$/.test(line.trim())))).toBeNull();
  });

  it('finds nothing on an empty or blank screen', () => {
    expect(parsePermissionPrompt([])).toBeNull();
    expect(parsePermissionPrompt(['', '   ', ''])).toBeNull();
  });
});

describe('questionOnScreen', () => {
  it('is true while the picker shows that question', () => {
    expect(questionOnScreen(screen('question-single'), 'Which fruit would you prefer?')).toBe(true);
    expect(questionOnScreen(screen('question-two'), 'Which fruit do you prefer?')).toBe(true);
    expect(questionOnScreen(screen('question-multiselect'), 'Which fruits do you like?')).toBe(true);
  });

  it('is false for another question, after answering, on the review page or a permission prompt', () => {
    expect(questionOnScreen(screen('question-single'), 'Which colour do you prefer?')).toBe(false);
    expect(questionOnScreen(screen('idle-after-answer'), 'Which fruit do you prefer?')).toBe(false);
    expect(questionOnScreen(screen('question-review'), 'Which fruit do you prefer?')).toBe(false);
    expect(questionOnScreen(screen('permission-bash'), 'Do you want to proceed?')).toBe(false);
  });

  it('matches a question the picker wrapped across lines', () => {
    const lines = ['Which fruit would', 'you prefer?', '❯ 1. Apple', 'Enter to select · ↑/↓ to navigate · Esc to cancel'];
    expect(questionOnScreen(lines, 'Which fruit would you prefer?')).toBe(true);
  });
});

describe('questionOnScreen looks only at the newest picker', () => {
  it('ignores the same question text far above the footer', () => {
    const lines = ['Which fruit would you prefer?', ...Array(40).fill('filler'), '❯ 1. Apple', 'Enter to select · ↑/↓ to navigate · Esc to cancel'];
    expect(questionOnScreen(lines, 'Which fruit would you prefer?')).toBe(false);
  });
});

// Keystrokes for each answer shape; the sequences match what a real Claude Code 2.1.291 accepted.
import { describe, expect, it } from 'vitest';
import { keysFor, permissionKeys, questionKeys } from '../src/main/prompt-keys';
import type { AskQuestion } from '../src/shared/prompt-answer';

const q = (multiSelect = false, count = 2): AskQuestion => ({
  question: multiSelect ? 'Which fruits?' : 'Which fruit?',
  header: 'Fruit',
  multiSelect,
  options: Array.from({ length: count }, (_, i) => ({ label: `Option ${i + 1}`, description: '' })),
});

describe('questionKeys', () => {
  it('one single-select question: the option digit alone submits', () => {
    expect(questionKeys([q()], [{ selected: [1] }])).toEqual(['2']);
  });

  it('typed answer: the "Type something" digit, the text, Enter', () => {
    expect(questionKeys([q()], [{ other: 'mango' }])).toEqual(['3', 'mango', '\r']);
  });

  it('strips controls from typed text so Esc cannot cancel the picker', () => {
    expect(questionKeys([q()], [{ other: 'ki\x1bwi\r\nnow' }])).toEqual(['3', 'ki wi now', '\r']);
    expect(questionKeys([q()], [{ other: ' \x1b ' }])).toBeNull();
  });

  it('multiSelect: toggle digits in order, → to the review page, 1 to submit', () => {
    expect(questionKeys([q(true, 3)], [{ selected: [2, 0] }])).toEqual(['1', '3', '\x1b[C', '1']);
  });

  it('two questions (the sequence measured live: Apple, Plum + teal)', () => {
    expect(questionKeys([q(true, 3), q()], [{ selected: [0, 2] }, { other: 'teal' }])).toEqual(['1', '3', '\x1b[C', '3', 'teal', '\r', '1']);
  });

  it('refuses answers that do not fit', () => {
    expect(questionKeys([q()], [])).toBeNull();
    expect(questionKeys([q()], [{ selected: [] }])).toBeNull();
    expect(questionKeys([q()], [{ selected: [0, 1] }])).toBeNull();
    expect(questionKeys([q()], [{ selected: [2] }])).toBeNull();
    expect(questionKeys([q()], [{ selected: [-1] }])).toBeNull();
    expect(questionKeys([q()], [{ selected: [0.5] }])).toBeNull();
    expect(questionKeys([q(true, 3)], [{ selected: [1, 1] }])).toBeNull();
    expect(questionKeys([q(true, 3)], [{ other: 'kiwi' }])).toBeNull();
    expect(questionKeys([], [])).toBeNull();
  });
});

describe('permissionKeys / keysFor', () => {
  it('a permission option is its digit; anything else is refused', () => {
    expect(permissionKeys(1)).toEqual(['1']);
    expect(permissionKeys(3)).toEqual(['3']);
    for (const bad of [0, 10, 1.5, '1', null, undefined]) expect(permissionKeys(bad)).toBeNull();
  });

  it('a question answer needs the pending questions from the transcript', () => {
    const answer = { kind: 'question' as const, toolUseId: 't1', answers: [{ selected: [0] }] };
    expect(keysFor(answer, null)).toBeNull();
    expect(keysFor(answer, [q()])).toEqual(['1']);
    expect(keysFor({ kind: 'permission', option: 2 }, null)).toEqual(['2']);
  });
});

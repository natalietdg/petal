// Turns a structured answer from the reader into the keystrokes Claude Code's picker expects (measured in shared/prompt-answer.ts).
import type { AskQuestion, PromptAnswer, QuestionAnswer } from '../shared/prompt-answer';

const RIGHT = '\x1b[C';
const ENTER = '\r';
const SUBMIT_ANSWERS = '1'; // "1. Submit answers" on the review page
const MAX_OTHER_LENGTH = 500;

// Typed answers go in as plain text: no controls (Esc would cancel the picker), one line.
// eslint-disable-next-line no-control-regex -- stripping controls is the point
const cleanOther = (text: string): string => text.replace(/[\x00-\x1F\x7F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_OTHER_LENGTH);

const validIndexes = (selected: unknown, count: number): selected is number[] =>
  Array.isArray(selected) && selected.length > 0 && new Set(selected).size === selected.length
  && selected.every((i) => Number.isInteger(i) && i >= 0 && i < count);

function keysForQuestion(question: AskQuestion, answer: QuestionAnswer | undefined): string[] | null {
  if (!answer) return null;
  if ('other' in answer) {
    const text = typeof answer.other === 'string' ? cleanOther(answer.other) : '';
    if (!text || question.multiSelect) return null;
    return [String(question.options.length + 1), text, ENTER];
  }
  if (!validIndexes(answer.selected, question.options.length)) return null;
  if (question.multiSelect) return [...[...answer.selected].sort((a, b) => a - b).map((i) => String(i + 1)), RIGHT];
  return answer.selected.length === 1 ? [String((answer.selected[0] ?? 0) + 1)] : null;
}

// One write per key: the picker reads each chunk as one keypress. Null when the answer doesn't fit the questions.
export function questionKeys(questions: readonly AskQuestion[], answers: readonly QuestionAnswer[]): string[] | null {
  if (!questions.length || answers.length !== questions.length) return null;
  const keys: string[] = [];
  for (const [i, question] of questions.entries()) {
    const part = keysForQuestion(question, answers[i]);
    if (!part) return null;
    keys.push(...part);
  }
  const reviewPage = questions.length > 1 || questions.some((q) => q.multiSelect);
  return reviewPage ? [...keys, SUBMIT_ANSWERS] : keys;
}

const MAX_PERMISSION_OPTION = 9;

export function permissionKeys(option: unknown): string[] | null {
  return Number.isInteger(option) && (option as number) >= 1 && (option as number) <= MAX_PERMISSION_OPTION ? [String(option)] : null;
}

export function keysFor(answer: PromptAnswer, pendingQuestions: readonly AskQuestion[] | null): string[] | null {
  if (answer.kind === 'permission') return permissionKeys(answer.option);
  return pendingQuestions && Array.isArray(answer.answers) ? questionKeys(pendingQuestions, answer.answers) : null;
}

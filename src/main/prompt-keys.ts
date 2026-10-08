// Turns a click in the reader into the keystrokes Claude Code's picker expects (measured in shared/prompt-answer.ts).
import type { PromptAnswer } from '../shared/prompt-answer';

const RIGHT = '\x1b[C';
const LEFT = '\x1b[D';
const ENTER = '\r';
const MAX_OPTION = 9; // pickers are driven by single digits
const MAX_OTHER_LENGTH = 500;

// Typed answers go in as plain text: no controls (Esc would cancel the picker), one line.
// eslint-disable-next-line no-control-regex -- stripping controls is the point
const cleanOther = (text: string): string => text.replace(/[\x00-\x1F\x7F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_OTHER_LENGTH);

const optionDigit = (option: unknown): string | null =>
  Number.isInteger(option) && (option as number) >= 1 && (option as number) <= MAX_OPTION ? String(option) : null;

export function permissionKeys(option: unknown): string[] | null {
  const digit = optionDigit(option);
  return digit ? [digit] : null;
}

// One step on the picker as shown on screen. One write per key: the picker reads each chunk as one keypress.
export function pickerKeys(step: unknown): string[] | null {
  if (typeof step !== 'object' || step === null) return null;
  if ('move' in step) return step.move === 'next' ? [RIGHT] : step.move === 'back' ? [LEFT] : null;
  if ('other' in step) {
    const digit = optionDigit(step.other);
    const text = 'text' in step && typeof step.text === 'string' ? cleanOther(step.text) : '';
    return digit && text ? [digit, text, ENTER] : null;
  }
  return 'pick' in step ? permissionKeys(step.pick) : null;
}

export function keysFor(answer: PromptAnswer): string[] | null {
  return answer.kind === 'permission' ? permissionKeys(answer.option) : pickerKeys(answer.step);
}

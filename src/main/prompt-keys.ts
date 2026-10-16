// Turns a click in the reader into the keystrokes Claude Code's picker expects (measured in shared/prompt-answer.ts).
import type { PromptAnswer } from '../shared/prompt-answer';

const RIGHT = '\x1b[C';
const LEFT = '\x1b[D';
const DOWN = '\x1b[B';
const UP = '\x1b[A';
const ESC = '\x1b';
const ENTER = '\r';
const MAX_OPTION = 9; // pickers are driven by single digits
const MAX_OTHER_LENGTH = 500;
const MAX_ARROWS = 60; // /mcp lists ~30 rows; more means a bad step

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

// A step on one of Claude Code's own menus: a digit, n arrows (down if positive) then maybe Enter, or Esc.
export function menuKeys(step: unknown): string[] | null {
  if (typeof step !== 'object' || step === null) return null;
  if ('cancel' in step) return step.cancel === true ? [ESC] : null;
  if ('digit' in step) {
    const digit = optionDigit(step.digit);
    return digit ? [digit] : null;
  }
  if (!('arrows' in step) || !('enter' in step) || typeof step.enter !== 'boolean') return null;
  const { arrows, enter } = step;
  if (!Number.isInteger(arrows) || Math.abs(arrows as number) > MAX_ARROWS || (arrows === 0 && !enter)) return null;
  const moves: string[] = Array((Math.abs(arrows as number))).fill((arrows as number) > 0 ? DOWN : UP);
  return enter ? [...moves, ENTER] : moves;
}

export function keysFor(answer: PromptAnswer): string[] | null {
  if (answer.kind === 'interrupt') return [ESC];
  if (answer.kind === 'permission') return permissionKeys(answer.option);
  return answer.kind === 'menu' ? menuKeys(answer.step) : pickerKeys(answer.step);
}

// Answering Claude Code's interactive prompts from the reader: the shapes that cross IPC, and the screen parser.
//
// Measured on Claude Code 2.1.291 (haiku, real pty, 100x40), 2026-10-06:
// AskUserQuestion, single question, single-select:
//   " ☐ <header>" / question / "❯ 1. <label>" + indented description ... / "N+1. Type something." /
//   "N+2. Chat about this" / "Enter to select · ↑/↓ to navigate · Esc to cancel".
//   Digit k picks option k and submits at once. Digit N+1 focuses "Type something": typed text + Enter submits it.
//   Arrows + Enter also work. Esc cancels (tool_result is_error "doesn't want to proceed").
// Several questions: a tab row "←  ☐ A  ☐ B  ✔ Submit  →". A digit answers the current question and moves on;
//   after the last one a review page shows "Ready to submit your answers?" / "❯ 1. Submit answers" / "2. Cancel".
// multiSelect: options render as "k. [ ] label"; digit k toggles; → moves to the next tab (or the review page).
//   Digit N+1 toggles "Type something" but does not focus a text field, so Petal offers no typed answer there.
// The transcript records the answer as a tool_result for the tool_use id (toolUseResult.answers maps question -> label(s)).
// Tool permission prompt (Bash, Read outside the project), not in the transcript until answered:
//   "────" rule / " Bash command" / details between "╌╌╌" rules / " Do you want to proceed?" /
//   " ❯ 1. Yes" / "   2. Yes, allow reading from <dir> from this project" (wraps, indented) / "   3. No" /
//   " Esc to cancel · Tab to amend". Digit k picks option k at once ("1" ran the command, "3" -> "Interrupted").
import type { TabId } from './types';

export interface QuestionOption {
  label: string;
  description: string;
}

export interface AskQuestion {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

// An AskUserQuestion tool_use that has no tool_result yet.
export interface PendingQuestion {
  toolUseId: string;
  questions: AskQuestion[];
}

// One answer per question: option indexes (0-based), or typed text for a single-select question.
export type QuestionAnswer = { selected: number[] } | { other: string };

export type PromptAnswer =
  | { kind: 'question'; toolUseId: string; answers: QuestionAnswer[] }
  | { kind: 'permission'; option: number };

export interface PromptAnswerRequest {
  tabId: TabId;
  answer: PromptAnswer;
}

export interface PermissionOption {
  number: number;
  label: string;
}

export interface PermissionPrompt {
  title: string;
  details: string[];
  question: string;
  options: PermissionOption[];
}

const RULE = /^\s*─{10,}\s*$/;
const DASHED_RULE = /^\s*╌{10,}\s*$/;
const PERMISSION_QUESTION = /^ ?Do you want to [^?]{1,200}\?\s*$/;
const OPTION = /^ ?(❯ | {2})(\d)\. (\S.*?)\s*$/;
const CONTINUATION = /^ {6,}(\S.*?)\s*$/;
const PERMISSION_FOOTER = /^ ?Esc to cancel\b/;
const MAX_DETAIL_LINES = 6;

// The permission prompt at the bottom of the visible screen, or null unless every part matches exactly.
export function parsePermissionPrompt(lines: readonly string[]): PermissionPrompt | null {
  let end = lines.length;
  while (end > 0 && !lines[end - 1]?.trim()) end -= 1;
  const footerAt = end - 1;
  if (footerAt < 0 || !PERMISSION_FOOTER.test(lines[footerAt] ?? '')) return null;

  const options: PermissionOption[] = [];
  let cursors = 0;
  let at = footerAt - 1;
  while (at >= 0 && !lines[at]?.trim()) at -= 1; // one blank row sits above the footer
  const body: string[] = [];
  for (; at >= 0; at -= 1) {
    const line = lines[at] ?? '';
    const option = OPTION.exec(line);
    if (option) {
      if (option[1] === '❯ ') cursors += 1;
      options.unshift({ number: Number(option[2]), label: [option[3] ?? '', ...body].join(' ').trim() });
      body.length = 0;
      continue;
    }
    const more = CONTINUATION.exec(line);
    if (more) { body.unshift(more[1] ?? ''); continue; }
    break;
  }
  if (body.length || options.length < 2 || cursors !== 1) return null;
  if (!options.every((option, i) => option.number === i + 1)) return null;

  const question = (lines[at] ?? '').trim();
  if (!PERMISSION_QUESTION.test(lines[at] ?? '')) return null;

  let ruleAt = at - 1;
  while (ruleAt >= 0 && !RULE.test(lines[ruleAt] ?? '')) ruleAt -= 1;
  if (ruleAt < 0) return null;
  const request = lines.slice(ruleAt + 1, at).filter((line) => line.trim() && !DASHED_RULE.test(line)).map((line) => line.trim());
  const [title, ...details] = request;
  if (!title) return null;
  return { title, details: details.slice(0, MAX_DETAIL_LINES), question, options };
}

const flat = (text: string): string => text.replace(/\s+/g, ' ').trim();
const QUESTION_FOOTER = /^\s*Enter to select · .*Esc to cancel\s*$/;

const PICKER_MAX_LINES = 30; // 4 options with descriptions, wrapped, fit well inside this

// True while the terminal shows this question's picker untouched: its text just above the newest picker footer.
export function questionOnScreen(lines: readonly string[], question: string): boolean {
  const footerAt = lines.findLastIndex((line) => QUESTION_FOOTER.test(line));
  if (footerAt < 0) return false;
  return flat(lines.slice(Math.max(0, footerAt - PICKER_MAX_LINES), footerAt).join(' ')).includes(flat(question));
}

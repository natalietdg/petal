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
// Re-measured on 2.1.293 (haiku, 100x40), 2026-10-08: the screens are unchanged, but the tool_use reaches the
//   transcript only with its tool_result, after she answers. So the picker is read off the screen, not the transcript.
//   → or Tab moves to the next tab, ← back, without answering. A digit on a single-select tab answers and moves on.
//   Typed text: digit N+1, text, Enter. The review page has no footer; "1" submits, "2" cancels.
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

// One move on the picker as it stands on screen: press option k, type into the free-text slot k, or change tab.
export type PickerStep = { pick: number } | { other: number; text: string } | { move: 'next' | 'back' };

export type PromptAnswer =
  | { kind: 'question'; toolUseId: string; answers: QuestionAnswer[] }
  | { kind: 'picker'; step: PickerStep }
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

export interface PickerTab {
  header: string;
  answered: boolean;
}

export interface PickerOption {
  number: number;
  label: string;
  description: string;
  checked: boolean; // multiSelect [✔], or the ✔ after a single-select answer
}

export interface QuestionPage {
  page: 'question';
  tabs: PickerTab[]; // empty for a lone question
  header: string; // a lone question's header; tabbed ones show theirs in the tab bar
  question: string;
  multiSelect: boolean;
  options: PickerOption[];
  other: PickerOption; // the free-text slot: "Type something." or her typed text
}

export interface ReviewPage {
  page: 'review';
  tabs: PickerTab[];
  answers: { question: string; answer: string }[];
  complete: boolean;
}

// What Claude Code's AskUserQuestion picker shows right now, read off the terminal.
export type QuestionPicker = QuestionPage | ReviewPage;

const QUESTION_FOOTER = /^Enter to select · .*Esc to cancel$/;
const TAB_BAR = /^←\s+(.+?)\s+→$/;
const TAB = /^([☐☒✔]) (\S.*)$/;
const LONE_HEADER = /^ ([☐☒]) (\S.*)$/;
const PICK = /^(?:❯ | {2})(\d)\. (?:\[([ ✔])\] )?(\S.*)$/;
const CHAT = /^(?:❯ | {2})(\d)\. Chat about this$/;
const NEXT_ROW = /^(?:❯| ) {4}Next$/; // multiSelect's own "Next" row under the options
const DESCRIPTION = /^ {5,}(\S.*)$/;
const ANSWERED_MARK = / ✔$/;
const REVIEW_TITLE = 'Review your answers';
const REVIEW_QUESTION = 'Ready to submit your answers?';
const REVIEW_WARNING = /^⚠ You have not answered all questions$/;
const REVIEW_ITEM = /^ ● (\S.*)$/;
const REVIEW_ANSWER = /^ {3}→ (\S.*)$/;
const REVIEW_MORE = /^ {3,}(\S.*)$/;

const lastFilled = (lines: readonly string[], from = lines.length - 1): number => {
  let at = from;
  while (at >= 0 && !lines[at]?.trim()) at -= 1;
  return at;
};

// The tabs above a picker page, or null if the row isn't a tab bar ending in Submit.
function parseTabBar(line: string): PickerTab[] | null {
  const bar = TAB_BAR.exec(line);
  if (!bar) return null;
  const items = (bar[1] ?? '').split(/\s{2,}/).map((item) => TAB.exec(item));
  const submit = items.pop();
  if (!submit || submit[1] !== '✔' || submit[2] !== 'Submit' || !items.length) return null;
  if (items.some((item) => !item || item[1] === '✔')) return null;
  return items.map((item) => ({ header: item?.[2] ?? '', answered: item?.[1] === '☒' }));
}

function parseOptions(rows: readonly string[]): { options: PickerOption[]; boxed: boolean } | null {
  const options: PickerOption[] = [];
  let boxes = 0;
  for (const row of rows) {
    if (NEXT_ROW.test(row)) continue;
    const pick = PICK.exec(row);
    if (pick) {
      if (pick[2] !== undefined) boxes += 1;
      const raw = pick[3] ?? '';
      options.push({ number: Number(pick[1]), label: raw.replace(ANSWERED_MARK, ''), description: '', checked: pick[2] === '✔' || ANSWERED_MARK.test(raw) });
      continue;
    }
    const more = DESCRIPTION.exec(row);
    const last = options.at(-1);
    if (!more || !last) return null;
    last.description = [last.description, more[1]].filter(Boolean).join(' ');
  }
  if (boxes && boxes !== options.length) return null;
  if (!options.every((option, i) => option.number === i + 1)) return null;
  return { options, boxed: boxes > 0 };
}

function parseQuestionPage(lines: readonly string[], footerAt: number): QuestionPage | null {
  const chatAt = lastFilled(lines, footerAt - 1);
  const chat = CHAT.exec(lines[chatAt] ?? '');
  const ruleAt = chatAt - 1;
  if (!chat || !RULE.test(lines[ruleAt] ?? '')) return null;

  // The header row (tab bar or lone ☐ header) sits right under the picker's top rule.
  let headAt = ruleAt - 1;
  while (headAt >= 0 && !(RULE.test(lines[headAt - 1] ?? '') && (TAB_BAR.test(lines[headAt] ?? '') || LONE_HEADER.test(lines[headAt] ?? '')))) headAt -= 1;
  if (headAt < 0) return null;
  const tabs = parseTabBar(lines[headAt] ?? '');
  const lone = tabs ? null : LONE_HEADER.exec(lines[headAt] ?? '');
  if (!tabs && !lone) return null;

  // Below the header: blank, the question (may wrap), blank, the options.
  const body = lines.slice(headAt + 1, ruleAt);
  const questionStart = body.findIndex((row) => row.trim());
  const gap = body.findIndex((row, i) => i > questionStart && !row.trim());
  if (questionStart < 0 || gap < 0) return null;
  const question = body.slice(questionStart, gap).map((row) => row.trim()).join(' ');
  const parsed = parseOptions(body.slice(gap).filter((row) => row.trim()));
  if (!parsed) return null;
  const { options, boxed } = parsed;
  const other = options.pop();
  if (!other || options.length < 2 || Number(chat[1]) !== other.number + 1) return null;
  return { page: 'question', tabs: tabs ?? [], header: lone?.[2] ?? '', question, multiSelect: boxed, options, other };
}

function parseReviewPage(lines: readonly string[], cancelAt: number): ReviewPage | null {
  if (!/^(?:❯ | {2})2\. Cancel$/.test(lines[cancelAt] ?? '') || !/^(?:❯ | {2})1\. Submit answers$/.test(lines[cancelAt - 1] ?? '')) return null;
  const askAt = lastFilled(lines, cancelAt - 2);
  if (lines[askAt] !== REVIEW_QUESTION) return null;
  const titleAt = lines.lastIndexOf(REVIEW_TITLE, askAt);
  const headAt = lastFilled(lines, titleAt - 1);
  if (titleAt < 0 || !RULE.test(lines[headAt - 1] ?? '')) return null;
  const tabs = parseTabBar(lines[headAt] ?? '');
  if (!tabs) return null;

  const answers: { question: string; answer: string }[] = [];
  let complete = true;
  for (const row of lines.slice(titleAt + 1, askAt)) {
    if (!row.trim()) continue;
    if (REVIEW_WARNING.test(row)) { complete = false; continue; }
    const item = REVIEW_ITEM.exec(row);
    const answer = REVIEW_ANSWER.exec(row);
    const more = REVIEW_MORE.exec(row);
    const last = answers.at(-1);
    if (item) answers.push({ question: item[1] ?? '', answer: '' });
    else if (answer && last && !last.answer) last.answer = answer[1] ?? '';
    else if (more && last) {
      if (last.answer) last.answer += ` ${more[1]}`;
      else last.question += ` ${more[1]}`;
    } else return null;
  }
  return { page: 'review', tabs, answers, complete };
}

// The AskUserQuestion picker at the bottom of the visible screen, or null unless every part matches exactly.
export function parseQuestionPicker(screen: readonly string[]): QuestionPicker | null {
  const lines = screen.map((line) => line.trimEnd());
  const end = lastFilled(lines);
  if (end < 0) return null;
  return QUESTION_FOOTER.test(lines[end] ?? '') ? parseQuestionPage(lines, end) : parseReviewPage(lines, end);
}

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
// Seen live on 2.1.295, 2026-10-09: a long question is drawn bold behind a "│ " gutter, wrapped, sometimes with no
//   header row. When the options don't fit, the list scrolls: "↓"/"↑" replace the gutter of the edge row (unless the
//   cursor sits there), the rows out of view (even "Type something.") are simply absent, and Chat keeps its number N+2.
//   The 2.1.295 bundle maps digit k to option k of the whole list, so a digit reaches an option scrolled out of view.
// Tool permission prompt (Bash, Read outside the project), not in the transcript until answered:
//   "────" rule / " Bash command" / details between "╌╌╌" rules / " Do you want to proceed?" /
//   " ❯ 1. Yes" / "   2. Yes, allow reading from <dir> from this project" (wraps, indented) / "   3. No" /
//   " Esc to cancel · Tab to amend". Digit k picks option k at once ("1" ran the command, "3" -> "Interrupted").
// Claude Code's own menus, measured on 2.1.301 (haiku, real pty, 100x40), 2026-10-16. Esc closes each one.
//   While one is open the session file says status "waiting", as for permission prompts.
// /model: border row ("────", or "▔▔▔" when her usage notice sits on it) / " Select model" / two wrapped lines of
//   explanation / "❯ 5. Haiku ✔   Fastest for quick answers" rows (✔ marks the current model, the cursor starts
//   on it, descriptions wrap deeper) / " ◐ Medium effort (default) ←/→ to adjust" /
//   " Enter to set as default · s to use this session only · Esc to cancel".
//   Her Team account lists 13 models: numbers pad to "1.  ", the gutter shows "↓ 10." and "… +3 models" follows.
//   Digit k (1-9) picks model k and saves it at once; ↑/↓ then Enter does the same. 10+ only by arrows.
// /memory: " Memory" / " ❯ Auto-memory  true" (its own ❯, always drawn) / blank / an unnumbered cursor list
//   ("User instructions   Saved in ~/.claude/CLAUDE.md" ...) / " Learn more: ..." / " Enter to confirm · Esc to cancel".
//   Digits do nothing; ↑/↓ moves the list's ❯, Enter opens the row.
// /mcp: " Manage MCP servers" / " 30 servers" / an unnumbered list split by blank rows, with section labels
//   ("claude.ai") the cursor skips / " ※ Run claude --debug ..." / " ↑/↓ to navigate · Enter to confirm · Esc to cancel".
// /resume: a "⌕ Search…" box over a two-row-per-session list; its footer wraps:
//   "Ctrl+A to show all projects · ... · Type to search · Esc to" / "cancel". Typed keys go to the search.
// /config: a "Settings  Status  Config  Usage  Stats" tab row, a search box and a value list;
//   footer "Type to filter · Enter/↓ to select · ↑ to tabs · Esc to clear" (or "... · Esc to close").
// /output-style prints its list as text, and /agents prints that its wizard was removed: neither opens a menu.
// The folder trust prompt is the same shape: " ❯ No, exit" / "   Yes, I trust this folder" / " Enter to confirm · Esc to cancel".
import type { TabId } from './types';

// One move on the picker as it stands on screen: press option k, type into the free-text slot k, or change tab.
export type PickerStep = { pick: number } | { other: number; text: string } | { move: 'next' | 'back' };

// One move on a Claude Code menu: a digit, arrows (then Enter when picking), or Esc.
export type MenuStep = { digit: number } | { arrows: number; enter: boolean } | { cancel: true };

// interrupt: one Esc to stop a working Claude, offered only while nothing on screen is asking.
export type PromptAnswer =
  | { kind: 'picker'; step: PickerStep }
  | { kind: 'permission'; option: number }
  | { kind: 'menu'; step: MenuStep }
  | { kind: 'interrupt' };

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
  focused: boolean; // the picker's ❯ cursor is on it
}

export interface QuestionPage {
  page: 'question';
  tabs: PickerTab[]; // empty for a lone question
  header: string; // a lone question's header; tabbed ones show theirs in the tab bar
  question: string;
  multiSelect: boolean;
  options: PickerOption[];
  other: PickerOption; // the free-text slot: "Type something." or her typed text
  otherShown: boolean; // false: the slot is scrolled out of view, so its label is the placeholder, not read
  hidden: number[]; // options scrolled out of view; a digit still picks them, but their labels aren't on screen
  chat: number; // "Chat about this", always N+2
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
// Gutter: the ❯ cursor, a scroll marker (↓ more below, ↑ more above), or blank.
const PICK = /^(❯ |↓ |↑ | {2})(\d)\. (?:\[([ ✔])\] )?(\S.*)$/;
const CHAT = /^(?:❯ | {2})(\d)\. Chat about this$/;
const NEXT_ROW = /^(?:❯| ) {4}Next$/; // multiSelect's own "Next" row under the options
const DESCRIPTION = /^ {5,}(\S.*)$/;
const GUTTER = /^│(?: (.*))?$/; // a long question's left bar
const ANSWERED_MARK = / ✔$/;
const FREE_TEXT_PLACEHOLDER = { single: 'Type something.', multi: 'Type something' };
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

const isHeader = (line: string): boolean => TAB_BAR.test(line) || LONE_HEADER.test(line);

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

// The option rows on screen (a window of the list when it scrolls), with wrapped descriptions joined.
function parseOptions(rows: readonly string[]): { options: PickerOption[]; boxed: boolean } | null {
  const options: PickerOption[] = [];
  let boxes = 0;
  for (const row of rows) {
    if (NEXT_ROW.test(row)) continue;
    const pick = PICK.exec(row);
    if (pick) {
      if (pick[3] !== undefined) boxes += 1;
      const raw = pick[4] ?? '';
      options.push({
        number: Number(pick[2]), label: raw.replace(ANSWERED_MARK, ''), description: '',
        checked: pick[3] === '✔' || ANSWERED_MARK.test(raw), focused: pick[1] === '❯ ',
      });
      continue;
    }
    const more = DESCRIPTION.exec(row);
    const last = options.at(-1);
    if (!more || !last) return null;
    last.description = [last.description, more[1]].filter(Boolean).join(' ');
  }
  if (!options.length || (boxes && boxes !== options.length)) return null;
  const first = options[0]?.number ?? 0;
  if (first < 1 || !options.every((option, i) => option.number === first + i)) return null;
  return { options, boxed: boxes > 0 };
}

// The question rows directly above the options' blank gap, and the header row (if any) above those.
function parseQuestionHead(lines: readonly string[], gapAt: number): { question: string; headAt: number } | null {
  let top = gapAt;
  while (top > 0 && lines[top - 1]?.trim() && !RULE.test(lines[top - 1] ?? '') && !isHeader(lines[top - 1] ?? '')) top -= 1;
  const rows = lines.slice(top, gapAt);
  if (!rows.length) return null;
  const gutter = rows.some((row) => GUTTER.test(row));
  if (gutter && !rows.every((row) => GUTTER.test(row))) return null;
  const question = rows.map((row) => (gutter ? GUTTER.exec(row)?.[1] ?? '' : row).trim()).filter(Boolean).join(' ');
  // Above the question: a header row, the picker's top rule, or the top of the screen (a tall picker is cut there).
  const above = lastFilled(lines, top - 1);
  if (above >= 0 && !isHeader(lines[above] ?? '') && !RULE.test(lines[above] ?? '')) return null;
  return question ? { question, headAt: above } : null;
}

function parseQuestionPage(lines: readonly string[], footerAt: number): QuestionPage | null {
  const chatAt = lastFilled(lines, footerAt - 1);
  const chatRow = CHAT.exec(lines[chatAt] ?? '');
  const ruleAt = chatAt - 1;
  if (!chatRow || !RULE.test(lines[ruleAt] ?? '')) return null;
  const chat = Number(chatRow[1]);

  // Up from the rule: the option rows, then the blank row that sets them off from the question.
  let gapAt = ruleAt - 1;
  while (gapAt >= 0 && lines[gapAt]?.trim()) gapAt -= 1;
  const parsed = parseOptions(lines.slice(gapAt + 1, ruleAt));
  const head = gapAt > 0 ? parseQuestionHead(lines, lastFilled(lines, gapAt) + 1) : null;
  if (!parsed || !head) return null;

  const headLine = lines[head.headAt] ?? '';
  const tabs = head.headAt >= 0 ? parseTabBar(headLine) : null;
  if (TAB_BAR.test(headLine) && !tabs) return null;
  const lone = tabs ? null : LONE_HEADER.exec(headLine);

  // Options run 1..chat-2, the free-text slot is chat-1; the screen shows a window of that list.
  const { options: shown, boxed } = parsed;
  const otherNumber = chat - 1;
  const optionCount = chat - 2;
  if (optionCount < 2 || (shown.at(-1)?.number ?? chat) > otherNumber) return null;
  const otherShown = shown.at(-1)?.number === otherNumber;
  const options = shown.filter((option) => option.number <= optionCount);
  const other = otherShown ? shown.at(-1) as PickerOption
    : { number: otherNumber, label: boxed ? FREE_TEXT_PLACEHOLDER.multi : FREE_TEXT_PLACEHOLDER.single, description: '', checked: false, focused: false };
  const onScreen = new Set(options.map((option) => option.number));
  const hidden = Array.from({ length: optionCount }, (_, i) => i + 1).filter((n) => !onScreen.has(n));
  return { page: 'question', tabs: tabs ?? [], header: lone?.[2] ?? '', question: head.question, multiSelect: boxed, options, other, otherShown, hidden, chat };
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

export interface MenuOption {
  number: number | null; // null on unnumbered lists
  label: string;
  description: string;
  current: boolean; // drawn with a trailing ✔
  focused: boolean; // the menu's ❯ cursor is on it
}

// One of Claude Code's own menus (/model, /memory, /mcp, ...), read off the terminal.
export interface BuiltinMenu {
  title: string;
  subtitle: string;
  options: MenuOption[];
  numbered: boolean;
  scrolled: boolean; // rows above or below are out of view
}

const MENU_FOOTER_ENTER = /(?:^|· )Enter to (?!select\b)[a-z]/;
const MENU_FOOTER_ESC = /· Esc to (?:cancel|exit|close)$/;
const MENU_BORDER = /^\s*[─▔]{10,}|▔\s*$/;
const MENU_MARK = /^[❯↓↑] /;
const MENU_MORE = /^… \+\d+/;
const MENU_NUMBER = /^(\d+)\.\s+(\S.*)$/;
const MENU_SEARCH = /[╭⌕]/;
const MENU_CURRENT = / ✔$/;
const MAX_SUBTITLE = 240;
// Any footer offering Esc: a menu the parsers may not know, so the reader must not stay silent.
const ESC_FOOTER = /\bEsc to (?:cancel|exit|close|clear|go back)\b/;

type MenuRow = 'blank' | 'flat' | 'start' | 'deep';
const indentOf = (line: string): number => line.length - line.trimStart().length;

function menuRow(line: string, gutter: number): MenuRow | null {
  if (!line.trim()) return 'blank';
  const indent = indentOf(line);
  if (indent < gutter) return null;
  if (indent === gutter) return MENU_MARK.test(line.slice(gutter)) ? 'start' : 'flat';
  return indent === gutter + 2 ? 'start' : 'deep';
}

// Label and description sit in two columns, two or more spaces apart.
function menuOption(text: string, focused: boolean): MenuOption {
  const numbered = MENU_NUMBER.exec(text);
  const [label = '', ...rest] = (numbered?.[2] ?? text).split(/\s{2,}/);
  return {
    number: numbered ? Number(numbered[1]) : null,
    label: label.replace(MENU_CURRENT, ''), description: rest.join(' '),
    current: MENU_CURRENT.test(label), focused,
  };
}

// Claude Code's first-run pickers have no Enter/Esc footer: a known title, then a ❯ list (2.1.301, theme and login method).
const FIRST_RUN_TITLES = ['Choose the text style that looks best with your terminal', 'Select login method:'];
const FIRST_RUN_SCROLL = /^[↓↑] \d+ more$/;
const FIRST_RUN_NUMBER = /^\d+\.\s+/;

// One first-run row: cursor, ✔ for the current pick, then "label · description". Unnumbered, so the dock steers by arrows.
function firstRunOption(row: string): MenuOption {
  const focused = row.startsWith('❯ ');
  let text = (focused ? row.slice(2) : row).trim();
  const current = text.startsWith('✔ ');
  if (current) text = text.slice(2).trim();
  const [label = '', ...rest] = text.replace(FIRST_RUN_NUMBER, '').split(' · ');
  return { number: null, label, description: rest.join(' · '), current, focused };
}

function parseFirstRunMenu(lines: readonly string[]): BuiltinMenu | null {
  const titleAt = lines.findLastIndex((line) => FIRST_RUN_TITLES.includes(line.trim()));
  if (titleAt < 0) return null;
  const cursorAt = lines.findIndex((line, i) => i > titleAt && line.trimStart().startsWith('❯ '));
  if (cursorAt < 0) return null;
  let first = cursorAt;
  while (first > titleAt + 1 && lines[first - 1]?.trim()) first -= 1;
  let last = cursorAt;
  while (last < lines.length - 1 && lines[last + 1]?.trim()) last += 1;
  const options: MenuOption[] = [];
  let scrolled = false;
  for (const line of lines.slice(first, last + 1)) {
    const row = line.trim();
    if (FIRST_RUN_SCROLL.test(row)) scrolled = true;
    else options.push(firstRunOption(row));
  }
  if (options.length < 2 || options.some((option) => !option.label)) return null;
  const subtitle = lines.slice(titleAt + 1, first).map((line) => line.trim()).filter(Boolean).join(' ');
  return { title: (lines[titleAt] ?? '').trim(), subtitle: subtitle.slice(0, MAX_SUBTITLE), options, numbered: false, scrolled };
}

// A Claude Code menu at the bottom of the visible screen, or null unless every part matches.
export function parseBuiltinMenu(screen: readonly string[]): BuiltinMenu | null {
  const lines = screen.map((line) => line.trimEnd());
  return parseFooterMenu(lines) ?? parseFirstRunMenu(lines);
}

function parseFooterMenu(lines: readonly string[]): BuiltinMenu | null {
  const footerAt = lastFilled(lines);
  const footer = (lines[footerAt] ?? '').trim();
  if (footerAt < 0 || !MENU_FOOTER_ENTER.test(footer) || !MENU_FOOTER_ESC.test(footer)) return null;
  let borderAt = footerAt - 1;
  while (borderAt >= 0 && !MENU_BORDER.test(lines[borderAt] ?? '')) borderAt -= 1;
  if (borderAt < 0) return null;
  const body = lines.slice(borderAt + 1, footerAt);
  if (body.some((line) => MENU_SEARCH.test(line))) return null;

  const cursors = body.flatMap((line, i) => (line.trimStart().startsWith('❯ ') ? [i] : []));
  const cursorAt = cursors.at(-1);
  if (cursorAt === undefined) return null;
  const gutter = indentOf(body[cursorAt] ?? '');
  const kinds = body.map((line) => menuRow(line, gutter));
  if (kinds.includes(null)) return null;

  // The list runs out from the cursor until a flat row; another ❯ above (/memory's toggle) ends it too.
  const inList = (i: number) => kinds[i] !== 'flat' && !(cursors.includes(i) && i !== cursorAt);
  let first = cursorAt;
  while (first > 0 && inList(first - 1)) first -= 1;
  let last = cursorAt;
  while (last < body.length - 1 && inList(last + 1)) last += 1;
  while (kinds[first] === 'blank') first += 1;
  while (kinds[last] === 'blank') last -= 1;
  if (kinds.slice(last + 1).some((kind) => kind !== 'flat' && kind !== 'blank')) return null; // only hint rows below the list

  const options: MenuOption[] = [];
  let scrolled = false;
  for (let i = first; i <= last; i += 1) {
    const line = body[i] ?? '';
    const text = line.trim();
    if (kinds[i] === 'blank') continue;
    if (kinds[i] === 'deep') {
      const previous = options.at(-1);
      if (MENU_MORE.test(text)) { scrolled = true; continue; }
      if (!previous) return null;
      previous.description = [previous.description, text].filter(Boolean).join(' ');
      continue;
    }
    const mark = line.slice(gutter, gutter + 2);
    if (mark === '↓ ' || mark === '↑ ') scrolled = true;
    options.push(menuOption(line.slice(gutter + 2).trim(), i === cursorAt));
  }
  const numbered = options.every((option) => option.number !== null);
  if (options.length < 2 || (!numbered && options.some((option) => option.number !== null))) return null;
  const firstNumber = options[0]?.number ?? 0;
  if (numbered && !options.every((option, i) => option.number === firstNumber + i)) return null;

  const head = body.slice(0, first).filter((line, i) => line.trim() && !cursors.includes(i)).map((line) => line.trim());
  const [title = '', ...rest] = head;
  return { title, subtitle: rest.join(' ').slice(0, MAX_SUBTITLE), options, numbered, scrolled };
}

// The bottom rows offer Esc (a footer may wrap onto a second row): some menu or prompt is waiting on her.
export function screenOffersEsc(screen: readonly string[]): boolean {
  const lines = screen.map((line) => line.trim());
  const end = lastFilled(lines);
  if (end < 0) return false;
  return ESC_FOOTER.test(lines[end] ?? '') || ESC_FOOTER.test(`${lines[end - 1] ?? ''} ${lines[end]}`);
}

// Claude has stopped on screen for her: any parsed prompt, or an Esc footer the parsers don't know.
export const screenIsAsking = (screen: readonly string[]): boolean =>
  Boolean(parseQuestionPicker(screen) ?? parsePermissionPrompt(screen) ?? parseBuiltinMenu(screen)) || screenOffersEsc(screen);

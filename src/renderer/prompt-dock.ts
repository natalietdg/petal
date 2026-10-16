// Clickable answers for Claude Code's pickers, above the reply box. All are read off the terminal screen:
// the question card mirrors the AskUserQuestion picker tab by tab, the permission bar the tool prompt,
// the menu card Claude Code's own menus (/model, /memory, /mcp). Main turns each click into keystrokes.
// Any other screen offering Esc gets a line pointing at the terminal while it is minimised.
import { byId, el } from './dom';
import * as layout from './layout';
import {
  parseBuiltinMenu, parsePermissionPrompt, parseQuestionPicker, screenOffersEsc,
  type BuiltinMenu, type MenuOption, type MenuStep, type PermissionPrompt, type PickerStep, type QuestionPage, type QuestionPicker, type ReviewPage,
} from '../shared/prompt-answer';
import type { TabId } from '../shared/types';

const dock = byId('prompt-dock');
const card = el('section', 'question-card');
const bar = el('section', 'permission-bar');
const menuCard = el('section', 'menu-card');
const elsewhere = el('section', 'terminal-ask');
card.hidden = true;
bar.hidden = true;
menuCard.hidden = true;
elsewhere.hidden = true;
card.setAttribute('aria-label', 'Claude is asking');
bar.setAttribute('aria-label', 'Claude needs permission');
menuCard.setAttribute('aria-label', 'Claude Code menu');
elsewhere.setAttribute('aria-label', 'Claude is asking in the terminal');
dock.append(card, bar, menuCard, elsewhere);

const UNLOCK_MS = 1500; // a step the picker ignored (← on the first tab) must not leave the card stuck
const FREE_TEXT_PLACEHOLDER = /^Type something\.?$/;

let tabId: TabId | null = null;
let picker: QuestionPicker | null = null;
let pickerKey = '';
let pickerSent = false;
let unlockTimer: ReturnType<typeof setTimeout> | undefined;
const drafts = new Map<string, string>(); // unsent typed text per question, kept across redraws
let permission: PermissionPrompt | null = null;
let permissionKey = '';
let permissionSent = false;
let menu: BuiltinMenu | null = null;
let menuKey = '';
let menuSent = false;
let menuUnlock: ReturnType<typeof setTimeout> | undefined;
// An unnumbered pick: arrows one at a time, each after the screen redraws, until the cursor sits on the label.
let steer: { label: string; dir: 1 | -1; left: number } | null = null;
let menuNote = '';
let unparsedMenu = false;

const MAX_DIGIT = 9; // menus take one keypress per digit
const MAX_STEER = 40;

// What the reader says while the open turn waits on her: set by app.ts.
export type Asking = 'question' | 'permission' | 'menu' | 'terminal' | null;
export const hooks = { askingChanged: (_asking: Asking): void => {} };
let asking: Asking = null;

function sendStep(step: PickerStep): void {
  if (!tabId || !picker || pickerSent) return;
  pickerSent = true;
  window.pastel.answerPrompt(tabId, { kind: 'picker', step });
  const sentKey = pickerKey;
  clearTimeout(unlockTimer);
  unlockTimer = setTimeout(() => { if (pickerKey === sentKey && pickerSent) { pickerSent = false; lockCard(); } }, UNLOCK_MS);
  lockCard();
}

function button(className: string, text: string, step: PickerStep): HTMLButtonElement {
  const b = el('button', className, text);
  b.type = 'button';
  b.addEventListener('click', () => sendStep(step));
  return b;
}

// Headers from the tab bar, ticked once answered, then Submit (current on the review page).
function tabStrip(page: QuestionPicker): HTMLElement {
  const strip = el('ol', 'qc-tabs');
  strip.setAttribute('aria-label', 'Questions');
  for (const tab of page.tabs) {
    const item = el('li', 'qc-tab', tab.answered ? `✓ ${tab.header}` : tab.header);
    item.dataset.answered = String(tab.answered);
    strip.append(item);
  }
  const submit = el('li', 'qc-tab qc-tab-submit', 'Submit');
  if (page.page === 'review') submit.setAttribute('aria-current', 'step');
  strip.append(submit);
  return strip;
}

function navRow(page: QuestionPicker): HTMLElement {
  const row = el('div', 'qc-footer');
  const status = el('p', 'qc-status');
  status.setAttribute('role', 'status');
  row.append(status);
  if (page.tabs.length) row.append(button('qc-nav', 'Back', { move: 'back' }));
  if (page.page === 'question' && page.tabs.length) row.append(button('qc-nav', 'Next', { move: 'next' }));
  if (page.page === 'question') row.append(button('qc-chat', `${page.chat}. Chat about this`, { pick: page.chat }));
  if (page.page === 'review') row.append(button('qc-nav', 'Cancel', { pick: 2 }), button('qc-submit', 'Submit answers', { pick: 1 }));
  return row;
}

function freeText(page: QuestionPage): HTMLElement {
  const row = el('div', 'qc-other');
  if (!FREE_TEXT_PLACEHOLDER.test(page.other.label)) {
    row.append(el('p', 'qc-hint', `Typed in the terminal: ${page.other.label}`));
    return row;
  }
  const input = el('input', 'qc-other-input');
  input.type = 'text';
  input.placeholder = 'Other…';
  input.setAttribute('aria-label', 'Other answer');
  input.maxLength = 500;
  input.value = drafts.get(page.question) ?? '';
  const go = el('button', 'qc-send', 'Send');
  go.type = 'button';
  const submit = () => { if (input.value.trim()) sendStep({ other: page.other.number, text: input.value }); };
  input.addEventListener('input', () => { drafts.set(page.question, input.value); go.disabled = pickerSent || !input.value.trim(); });
  input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); submit(); } });
  go.addEventListener('click', submit);
  row.append(input, go);
  return row;
}

function questionBody(page: QuestionPage): HTMLElement {
  const group = el('fieldset', 'qc-question');
  const legend = el('legend', 'qc-legend');
  if (page.header) legend.append(el('span', 'qc-chip', page.header));
  legend.append(el('span', 'qc-text', page.question));
  const options = el('div', 'qc-options');
  for (const option of page.options) {
    const b = button('qc-option', '', { pick: option.number });
    const head = el('span', 'qc-option-head');
    head.append(el('span', 'qc-num', `${option.number}.`), el('span', 'qc-label', option.label));
    b.append(head, ...(option.description ? [el('span', 'qc-desc', option.description)] : []));
    if (page.multiSelect) b.setAttribute('aria-pressed', String(option.checked));
    if (option.focused) b.dataset.focused = 'true';
    options.append(b);
  }
  group.append(legend, options);
  if (page.hidden.length) group.append(el('p', 'qc-hint qc-hidden', hiddenHint(page.hidden)));
  // The picker takes typed text only on single-select questions.
  group.append(page.multiSelect ? el('p', 'qc-hint', page.tabs.length ? 'Pick any, then Next' : 'Pick any') : freeText(page));
  return group;
}

// Labels of scrolled-away options aren't on screen, so the card names them by number only.
function hiddenHint(hidden: readonly number[]): string {
  const numbers = hidden.length === 1 ? `Option ${hidden[0]} is` : `Options ${hidden.slice(0, -1).join(', ')} and ${hidden.at(-1)} are`;
  return `${numbers} scrolled out of view in the terminal. Use ↑/↓ there to read ${hidden.length === 1 ? 'it' : 'them'}.`;
}

function reviewBody(page: ReviewPage): HTMLElement {
  const group = el('section', 'qc-question');
  group.append(el('p', 'qc-legend', 'Ready to submit your answers?'));
  const list = el('dl', 'qc-review');
  for (const { question, answer } of page.answers) list.append(el('dt', '', question), el('dd', '', answer));
  if (page.answers.length) group.append(list);
  if (!page.complete) group.append(el('p', 'qc-hint', 'Some questions have no answer yet'));
  return group;
}

function buildCard(): void {
  card.replaceChildren();
  card.hidden = !picker;
  if (!picker) return;
  if (picker.tabs.length) card.append(tabStrip(picker));
  card.append(picker.page === 'question' ? questionBody(picker) : reviewBody(picker), navRow(picker));
  lockCard();
}

// Updates disabled state in place, so focus and typed text survive.
function lockCard(): void {
  for (const b of card.querySelectorAll<HTMLButtonElement>('button')) {
    b.disabled = pickerSent || (b.classList.contains('qc-send') && !card.querySelector<HTMLInputElement>('.qc-other-input')?.value.trim());
  }
  for (const input of card.querySelectorAll<HTMLInputElement>('.qc-other-input')) input.disabled = pickerSent;
  const status = card.querySelector('.qc-status');
  if (status) status.textContent = pickerSent ? 'Sent · waiting for Claude' : '';
}

function renderBar(): void {
  bar.replaceChildren();
  bar.hidden = !permission;
  if (!permission) return;
  const head = el('div', 'pb-head');
  head.append(el('span', 'qc-chip', permission.title), el('span', 'pb-question', permission.question));
  const details = permission.details.length ? [el('pre', 'pb-details', permission.details.join('\n'))] : [];
  const options = el('div', 'pb-options');
  for (const option of permission.options) {
    const b = el('button', 'pb-option', `${option.number}. ${option.label}`);
    b.type = 'button';
    b.title = option.label;
    b.disabled = permissionSent;
    b.addEventListener('click', () => {
      if (!tabId || permissionSent) return;
      permissionSent = true;
      window.pastel.answerPrompt(tabId, { kind: 'permission', option: option.number });
      renderBar();
    });
    options.append(b);
  }
  bar.append(head, ...details, options);
}

function sendMenu(step: MenuStep): void {
  if (!tabId) return;
  menuSent = true;
  window.pastel.answerPrompt(tabId, { kind: 'menu', step });
  const sentKey = menuKey;
  clearTimeout(menuUnlock);
  // The menu ignored the keys (a section label the cursor skips): give the buttons back.
  menuUnlock = setTimeout(() => {
    if (menuKey !== sentKey || !menuSent) return;
    if (steer) menuNote = 'That row can only be picked in the terminal';
    steer = null;
    menuSent = false;
    renderMenu();
  }, UNLOCK_MS);
  renderMenu();
}

// Numbered rows: a digit when the whole list is 1-9 (measured on /model), else arrows by the number gap.
function pickMenu(option: MenuOption): void {
  if (!menu || menuSent) return;
  menuNote = '';
  const focused = menu.options.find((o) => o.focused);
  if (option.number !== null && focused?.number != null) {
    const digits = !menu.scrolled && (menu.options.at(-1)?.number ?? 0) <= MAX_DIGIT;
    sendMenu(digits ? { digit: option.number } : { arrows: option.number - focused.number, enter: true });
    return;
  }
  steer = { label: option.label, dir: 1, left: MAX_STEER };
  steerStep(true);
}

function steerStep(first = false): void {
  if (!steer || !menu) { steer = null; return; }
  const labels = menu.options.map((o) => o.label);
  const at = menu.options.findIndex((o) => o.focused);
  const target = labels.indexOf(steer.label);
  if (at === target) { steer = null; sendMenu({ arrows: 0, enter: true }); return; }
  const dir = target > at ? 1 : -1;
  // Off screen, out of steps, or the cursor jumped past it: stop rather than wander.
  if (target < 0 || steer.left <= 0 || (!first && dir !== steer.dir)) {
    steer = null;
    menuNote = 'That row can only be picked in the terminal';
    menuSent = false;
    renderMenu();
    return;
  }
  steer = { ...steer, dir, left: steer.left - 1 };
  sendMenu({ arrows: dir, enter: false });
}

function renderMenu(): void {
  menuCard.replaceChildren();
  menuCard.hidden = !menu;
  if (!menu) return;
  const legend = el('div', 'qc-legend');
  legend.append(el('span', 'qc-chip', 'Claude Code'), el('span', 'qc-text', menu.title || 'Menu'));
  menuCard.append(legend);
  if (menu.subtitle) menuCard.append(el('p', 'mc-subtitle', menu.subtitle));
  const options = el('div', 'qc-options');
  for (const option of menu.options) {
    const b = el('button', 'qc-option mc-option');
    b.type = 'button';
    b.disabled = menuSent;
    const head = el('span', 'qc-option-head');
    if (option.number !== null) head.append(el('span', 'qc-num', `${option.number}.`));
    head.append(el('span', 'qc-label', option.label));
    if (option.current) head.append(el('span', 'mc-current', 'Current'));
    b.append(head, ...(option.description ? [el('span', 'qc-desc', option.description)] : []));
    if (option.focused) b.dataset.focused = 'true';
    if (option.current) b.setAttribute('aria-current', 'true');
    b.addEventListener('click', () => pickMenu(option));
    options.append(b);
  }
  menuCard.append(options);
  if (menu.scrolled) menuCard.append(el('p', 'qc-hint', 'More rows in the terminal: scroll there with ↑/↓.'));
  const footer = el('div', 'qc-footer');
  const status = el('p', 'qc-status', menuSent ? 'Sent · waiting for Claude' : menuNote);
  status.setAttribute('role', 'status');
  const esc = el('button', 'qc-nav mc-cancel', 'Esc · Cancel');
  esc.type = 'button';
  esc.disabled = menuSent && !steer;
  esc.addEventListener('click', () => { steer = null; menuNote = ''; sendMenu({ cancel: true }); });
  footer.append(status, esc);
  menuCard.append(footer);
}

// Something waits on her that no card can show: point at the terminal while it is folded away.
function renderElsewhere(): void {
  const show = unparsedMenu && layout.isTerminalMinimised();
  elsewhere.hidden = !show;
  if (!show || elsewhere.childElementCount) return;
  const go = el('button', 'qc-nav ta-show', 'Show terminal');
  go.type = 'button';
  go.addEventListener('click', () => layout.setTerminalMinimised(false));
  elsewhere.append(el('p', 'ta-text', 'Claude is asking in the terminal'), go);
}
layout.onTerminalMinimised(renderElsewhere);

// Called after the active tab's terminal changes, or another tab becomes active: its visible screen, top to bottom.
export function readScreen(screenTab: TabId, lines: readonly string[]): void {
  if (screenTab !== tabId) {
    tabId = screenTab;
    picker = null;
    pickerKey = '';
    permission = null;
    permissionKey = '';
    menu = null;
    menuKey = '';
    steer = null;
    drafts.clear();
  }

  const nextPicker = parseQuestionPicker(lines);
  const nextPickerKey = nextPicker ? JSON.stringify(nextPicker) : '';
  if (nextPickerKey !== pickerKey || (!nextPicker && !card.hidden)) {
    if (!nextPicker) drafts.clear();
    picker = nextPicker;
    pickerKey = nextPickerKey;
    pickerSent = false;
    buildCard();
  }

  const next = parsePermissionPrompt(lines);
  const key = next ? JSON.stringify(next) : '';
  if (key !== permissionKey || (!next && !bar.hidden)) {
    permissionKey = key;
    permission = next;
    permissionSent = false;
    renderBar();
  }

  // The two older kinds win: their footers never match a menu's, but a menu must not shadow them.
  const nextMenu = picker || permission ? null : parseBuiltinMenu(lines);
  const nextMenuKey = nextMenu ? JSON.stringify(nextMenu) : '';
  if (nextMenuKey !== menuKey || (!nextMenu && !menuCard.hidden)) {
    menu = nextMenu;
    menuKey = nextMenuKey;
    menuSent = false;
    if (!menu) { steer = null; menuNote = ''; }
    if (steer) steerStep();
    else renderMenu();
  }

  unparsedMenu = !picker && !permission && !menu && screenOffersEsc(lines);
  renderElsewhere();

  const nextAsking: Asking = picker ? 'question' : permission ? 'permission' : menu ? 'menu' : unparsedMenu ? 'terminal' : null;
  if (nextAsking !== asking) {
    asking = nextAsking;
    hooks.askingChanged(asking);
  }
}

export const state = () => ({ tabId, picker, pickerSent, permission, menu, menuSent, unparsedMenu });

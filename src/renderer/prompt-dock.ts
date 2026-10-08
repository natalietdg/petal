// Clickable answers for Claude Code's pickers, above the reply box. Both are read off the terminal screen:
// the question card mirrors the AskUserQuestion picker tab by tab, the permission bar the tool prompt.
// Main turns each click into the keystrokes that picker expects.
import { byId, el } from './dom';
import { parsePermissionPrompt, parseQuestionPicker, type PermissionPrompt, type PickerStep, type QuestionPage, type QuestionPicker, type ReviewPage } from '../shared/prompt-answer';
import type { TabId } from '../shared/types';

const dock = byId('prompt-dock');
const card = el('section', 'question-card');
const bar = el('section', 'permission-bar');
card.hidden = true;
bar.hidden = true;
card.setAttribute('aria-label', 'Claude is asking');
bar.setAttribute('aria-label', 'Claude needs permission');
dock.append(card, bar);

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
    b.append(el('span', 'qc-label', option.label), ...(option.description ? [el('span', 'qc-desc', option.description)] : []));
    if (page.multiSelect) b.setAttribute('aria-pressed', String(option.checked));
    options.append(b);
  }
  group.append(legend, options);
  // The picker takes typed text only on single-select questions.
  group.append(page.multiSelect ? el('p', 'qc-hint', page.tabs.length ? 'Pick any, then Next' : 'Pick any') : freeText(page));
  return group;
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

// Called after the active tab's terminal changes, or another tab becomes active: its visible screen, top to bottom.
export function readScreen(screenTab: TabId, lines: readonly string[]): void {
  if (screenTab !== tabId) {
    tabId = screenTab;
    picker = null;
    pickerKey = '';
    permission = null;
    permissionKey = '';
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
  if (key === permissionKey && (next || bar.hidden)) return;
  permissionKey = key;
  permission = next;
  permissionSent = false;
  renderBar();
}

export const state = () => ({ tabId, picker, pickerSent, permission });

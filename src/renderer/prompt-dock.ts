// Clickable answers for Claude Code's pickers, above the reply box: the question card (from the transcript)
// and the permission bar (from the terminal screen). Main turns each choice into keystrokes.
import { byId, el } from './dom';
import { parsePermissionPrompt, questionOnScreen, type PendingQuestion, type PermissionPrompt, type QuestionAnswer } from '../shared/prompt-answer';
import type { TabId } from '../shared/types';

// One draft answer per question: picked option indexes, or typed text.
interface Draft { picked: Set<number>; other: string }

const dock = byId('prompt-dock');
const card = el('section', 'question-card');
const bar = el('section', 'permission-bar');
card.hidden = true;
bar.hidden = true;
card.setAttribute('aria-label', 'Claude is asking');
bar.setAttribute('aria-label', 'Claude needs permission');
dock.append(card, bar);

let tabId: TabId | null = null;
let question: PendingQuestion | null = null;
let drafts: Draft[] = [];
let sentFor: string | null = null;
let screenReady = false;
let permission: PermissionPrompt | null = null;
let permissionKey = '';
let permissionSent = false;

// One click answers at once when the terminal would too: a single, single-select question.
const instant = (q: PendingQuestion): boolean => q.questions.length === 1 && !q.questions[0]?.multiSelect;

function answers(): QuestionAnswer[] | null {
  if (!question) return null;
  const out: QuestionAnswer[] = [];
  for (const draft of drafts) {
    if (draft.other.trim()) out.push({ other: draft.other.trim() });
    else if (draft.picked.size) out.push({ selected: [...draft.picked] });
    else return null;
  }
  return out;
}

function send(answer: QuestionAnswer[] | null): void {
  if (!question || !tabId || !answer || !screenReady || sentFor) return;
  sentFor = question.toolUseId;
  window.pastel.answerPrompt(tabId, { kind: 'question', toolUseId: question.toolUseId, answers: answer });
  refreshCard();
}

function optionButton(qIndex: number, oIndex: number, label: string, description: string): HTMLButtonElement {
  const button = el('button', 'qc-option');
  button.type = 'button';
  button.dataset.q = String(qIndex);
  button.dataset.o = String(oIndex);
  button.append(el('span', 'qc-label', label), ...(description ? [el('span', 'qc-desc', description)] : []));
  button.addEventListener('click', () => {
    const q = question?.questions[qIndex];
    const draft = drafts[qIndex];
    if (!q || !draft || !question) return;
    if (instant(question)) return send([{ selected: [oIndex] }]);
    if (q.multiSelect) {
      if (!draft.picked.delete(oIndex)) draft.picked.add(oIndex);
    } else {
      draft.picked = new Set([oIndex]);
      draft.other = '';
    }
    refreshCard();
  });
  return button;
}

function otherField(qIndex: number): HTMLElement {
  const row = el('div', 'qc-other');
  const input = el('input', 'qc-other-input');
  input.type = 'text';
  input.placeholder = 'Other…';
  input.setAttribute('aria-label', 'Other answer');
  input.maxLength = 500;
  input.addEventListener('input', () => {
    const draft = drafts[qIndex];
    if (!draft) return;
    draft.other = input.value;
    if (input.value.trim()) draft.picked.clear();
    refreshCard();
  });
  row.append(input);
  if (question && instant(question)) {
    const go = el('button', 'qc-send', 'Send');
    go.type = 'button';
    go.addEventListener('click', () => send(answers()));
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); send(answers()); } });
    row.append(go);
  }
  return row;
}

function buildCard(): void {
  card.replaceChildren();
  if (!question) return;
  question.questions.forEach((q, qIndex) => {
    const group = el('fieldset', 'qc-question');
    const legend = el('legend', 'qc-legend');
    if (q.header) legend.append(el('span', 'qc-chip', q.header));
    legend.append(el('span', 'qc-text', q.question));
    const options = el('div', 'qc-options');
    q.options.forEach((option, oIndex) => options.append(optionButton(qIndex, oIndex, option.label, option.description)));
    group.append(legend, options);
    if (q.multiSelect) group.append(el('p', 'qc-hint', 'Pick any'));
    else group.append(otherField(qIndex)); // the picker takes typed text only for single-select questions
    card.append(group);
  });
  const footer = el('div', 'qc-footer');
  const status = el('p', 'qc-status');
  status.setAttribute('role', 'status');
  footer.append(status);
  if (!instant(question)) {
    const submit = el('button', 'qc-submit', 'Submit');
    submit.type = 'button';
    submit.addEventListener('click', () => send(answers()));
    footer.append(submit);
  }
  card.append(footer);
}

// Updates pressed/disabled state in place, so focus and typed text survive.
function refreshCard(): void {
  card.hidden = !question;
  if (!question) return;
  const locked = !screenReady || Boolean(sentFor);
  for (const button of card.querySelectorAll<HTMLButtonElement>('.qc-option')) {
    const draft = drafts[Number(button.dataset.q)];
    if (!instant(question)) button.setAttribute('aria-pressed', String(Boolean(draft?.picked.has(Number(button.dataset.o)))));
    button.disabled = locked;
  }
  for (const input of card.querySelectorAll<HTMLInputElement>('.qc-other-input')) input.disabled = locked;
  for (const go of card.querySelectorAll<HTMLButtonElement>('.qc-send')) go.disabled = locked || !drafts[0]?.other.trim();
  const submit = card.querySelector<HTMLButtonElement>('.qc-submit');
  if (submit) submit.disabled = locked || !answers();
  const status = card.querySelector('.qc-status');
  if (status) {
    status.textContent = sentFor ? 'Sent · waiting for Claude'
      : screenReady ? '' : 'Buttons wake up when the terminal shows this question';
  }
}

// The reader's update for the active tab: its pending question, if any.
export function showQuestion(nextTab: TabId, next: PendingQuestion | null): void {
  const tabChanged = nextTab !== tabId;
  if (!tabChanged && next?.toolUseId === question?.toolUseId) return;
  tabId = nextTab;
  if (tabChanged) {
    permission = null;
    permissionKey = '';
    renderBar();
  }
  screenReady = false; // the next readScreen decides
  question = next;
  drafts = (next?.questions ?? []).map(() => ({ picked: new Set<number>(), other: '' }));
  sentFor = null;
  buildCard();
  refreshCard();
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
    const button = el('button', 'pb-option', `${option.number}. ${option.label}`);
    button.type = 'button';
    button.title = option.label;
    button.disabled = permissionSent;
    button.addEventListener('click', () => {
      if (!tabId || permissionSent) return;
      permissionSent = true;
      window.pastel.answerPrompt(tabId, { kind: 'permission', option: option.number });
      renderBar();
    });
    options.append(button);
  }
  bar.append(head, ...details, options);
}

// Called after the active tab's terminal changes: the visible screen, top to bottom.
export function readScreen(screenTab: TabId, lines: readonly string[]): void {
  if (screenTab !== tabId) return;
  const ready = Boolean(question?.questions[0] && questionOnScreen(lines, question.questions[0].question));
  if (ready !== screenReady) { screenReady = ready; refreshCard(); }

  const next = parsePermissionPrompt(lines);
  const key = next ? JSON.stringify(next) : '';
  if (key === permissionKey) return;
  permissionKey = key;
  permission = next;
  permissionSent = false;
  renderBar();
}

export const state = () => ({ tabId, question: question?.toolUseId ?? null, screenReady, sentFor, permission });

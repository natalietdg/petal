// The Board's Code review for one task: every function its sessions changed, by file then function, newest change first.
import { el, isIpcError } from './dom';
import { timeOf } from './format';
import { functionCard, skippedLine } from './code-review-cards';
import * as explainButton from './code-review-explain';
import type { TaskChange, TaskReview } from '../shared/code-review';

export interface TaskTarget {
  sessionId: string; // the card's session; main finds the task's repo through it
  taskId: string;
  title: string;
}

const panel = el('section', 'board-code-review cr-task');
panel.hidden = true;
panel.setAttribute('aria-label', 'Code review for a task');
let target: TaskTarget | null = null;
let onBack: () => void = () => {};

const viewKey = (t: TaskTarget): string => `task:${t.sessionId}:${t.taskId}`;

function changeItem(change: TaskChange, running: boolean, repaint: () => void): HTMLElement {
  const item = el('li', 'cr-task-change');
  item.append(el('p', 'cr-when', change.at ? `Changed ${timeOf(change.at)}` : 'Changed'));
  item.append(functionCard(change.card, {
    answer: change.answer, explained: change.explained, running,
    onRetry: target ? () => void explainButton.run(viewKey(target as TaskTarget), [{ source: { sessionId: change.sessionId }, turnId: change.turnId, only: [change.card.key] }]).then(repaint) : null,
  }, { heading: false }));
  return item;
}

function body(review: TaskReview, repaint: () => void): HTMLElement[] {
  const total = review.files.reduce((sum, f) => sum + f.functions.length, 0);
  const summary = el('p', 'cr-task-summary', total
    ? `${total} function${total === 1 ? '' : 's'} in ${review.files.length} file${review.files.length === 1 ? '' : 's'}, from ${review.sessions} session${review.sessions === 1 ? '' : 's'}.`
    : 'No code changes found in this task’s sessions yet.');
  const explain = explainButton.explainBar(viewKey(target as TaskTarget), { estimate: review.estimate, running: review.running, targets: review.targets, repaint });
  const files = review.files.map((file) => {
    const section = el('section', 'cr-file-group');
    section.append(el('h3', 'cr-file-name', file.display));
    for (const fn of file.functions) {
      const group = el('div', 'cr-fn-group');
      group.append(el('h4', 'cr-fn-name', fn.name));
      const list = el('ol', 'cr-task-changes');
      list.append(...fn.changes.map((c) => changeItem(c, review.running, repaint)));
      group.append(list);
      section.append(group);
    }
    return section;
  });
  return [summary, explain, ...[skippedLine(review.skipped)].filter((x): x is HTMLElement => x !== null), ...files];
}

export async function refresh(): Promise<void> {
  if (!target) return;
  const shownFor = target;
  const back = el('button', 'session-link cr-back', 'Back to Board');
  back.type = 'button';
  back.addEventListener('click', close);
  const head = el('header', 'cr-task-head');
  head.append(back, el('h2', 'cr-task-title', `Code review · ${shownFor.title}`));
  if (!panel.childElementCount) panel.append(head, el('p', 'cr-loading', 'Reading the task’s sessions…'));
  const review = await window.pastel.codeReview.task(shownFor.sessionId, shownFor.taskId);
  if (target !== shownFor) return; // closed or switched while reading
  const content = isIpcError(review) ? [el('p', 'cr-outcome', `Couldn’t read this task’s changes: ${review.error}`)] : body(review, () => void refresh());
  panel.replaceChildren(head, ...content);
}

export function open(next: TaskTarget, back: () => void): void {
  target = next;
  onBack = back;
  panel.replaceChildren();
  panel.hidden = false;
  void refresh();
}

export function close(): void {
  target = null;
  panel.hidden = true;
  panel.replaceChildren();
  onBack();
}

export const isOpen = (): boolean => target !== null;
export const element = (): HTMLElement => panel;

window.pastel.codeReview.onChanged(() => { if (target) void refresh(); });

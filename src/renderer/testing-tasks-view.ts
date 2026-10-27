// The Testing tab's smaller pieces: the session picker, the empty states, the suite's last change and the test lock.
import { el } from './dom';
import { when } from './testing-view';
import { groupsByActivity, taskActivity } from '../shared/task-activity';
import { groupTasks } from '../shared/task-groups';
import { parseTarget, targetValue, type PickAgent, type PickSession, type TestTarget } from '../shared/task-testing';
import type { TaskData } from '../shared/tasks';
import type { SuiteChange } from '../shared/repo-suite';
import type { LockView, TestingState } from '../shared/testing';
import { restoredText, type RestoredFlag } from '../shared/test-lock';
import { unconfirmedRow, type ResolveUnconfirmed } from './test-lock-confirm';

// The task whose testing and bug fix agents the lanes show, grouped by PRD, newest activity first; subtasks under
// their task. The suite and criteria are the repo's whichever task is picked.
export function taskPicker(data: TaskData & Pick<TestingState, 'runs'>, target: TestTarget, pick: (target: TestTarget) => void): HTMLElement {
  const wrap = el('label', 'tst-picker-bar');
  const select = el('select', 'tst-task-select');
  for (const group of groupsByActivity(groupTasks(data), taskActivity(data.runs))) {
    if (!group.tasks.length) continue;
    const box = el('optgroup');
    box.label = group.prd ? `PRD · ${group.prd.title}` : 'No PRD';
    for (const { task, subtasks } of group.tasks) {
      box.append(new Option(task.title, targetValue({ kind: 'task', id: task.id })));
      for (const sub of subtasks) box.append(new Option(`\u00a0\u00a0\u00a0↳ ${sub.title}`, targetValue({ kind: 'task', id: sub.id })));
    }
    select.append(box);
  }
  select.value = targetValue(target);
  select.addEventListener('change', () => {
    const next = parseTarget(select.value);
    if (next) pick(next);
  });
  wrap.append(el('span', 'tst-picker-label', 'Agents for'), select);
  return wrap;
}

// "Testing agent · busy", or "Testing agent ×3 · idle" for several alike.
const agentLine = (agent: PickAgent): string => `${agent.name}${agent.count > 1 ? ` ×${agent.count}` : ''} · ${agent.status}`;

// The tab is in ~ or outside a repo: her Claude sessions in a repo, newest activity first; a row opens that session's suite.
export function sessionPicker(sessions: readonly PickSession[], choose: (sessionId: string) => void): HTMLElement {
  const box = el('div', 'tst-picker');
  box.append(el('p', 'tst-picker-title', 'This tab isn’t in a project. Pick a session:'));
  if (!sessions.length) {
    box.append(el('p', 'tst-muted', 'No Claude sessions in a repo yet.'));
    return box;
  }
  const list = el('ul', 'tst-picker-list');
  for (const session of sessions) {
    const item = el('li');
    const button = el('button', 'tst-pick');
    button.type = 'button';
    button.dataset.session = session.sessionId;
    button.title = session.root;
    const meta = el('span', 'tst-pick-path', `${session.project} · ${session.status}`);
    if (session.suite) meta.append(' ', el('span', 'tst-pick-suite', 'has a suite'));
    button.append(el('span', 'tst-pick-name', session.name), meta);
    if (session.agents.length) button.append(el('span', 'tst-pick-agents', session.agents.map(agentLine).join(', ')));
    button.addEventListener('click', () => choose(session.sessionId));
    item.append(button);
    list.append(item);
  }
  box.append(list);
  return box;
}

// A repo with no tasks and no Claude in this tab: one line, since a session is what gets the task.
export function noTasks(): HTMLElement {
  const box = el('div', 'tst-no-tasks');
  box.append(el('p', 'tst-empty', 'Start Claude in this tab to give it a test suite.'));
  return box;
}

// draftEnded: the testing agent stopped with no suite; askAgain then stands where Ask Claude was. tester: her name for it.
export interface NoSuiteActions { tester: string; askClaude: () => void; showDraft: (() => void) | null; draftEnded: boolean; askAgain: () => void; seed: (() => void) | null; edit: () => void; fromRuns: (() => void) | null; askEstimate?: string | null; scenariosReady?: boolean }

export function noSuite(actions: NoSuiteActions, seedProblem: string | null, busy: boolean): HTMLElement {
  const box = el('div', 'tst-no-suite');
  const button = (cls: string, text: string, onClick: () => void, primary = false) => {
    const b = el('button', `tst-button ${cls}${primary ? ' tst-primary' : ''}`, text);
    b.type = 'button';
    b.disabled = busy;
    b.addEventListener('click', onClick);
    return b;
  };
  const row = el('div', 'tst-actions');
  let ended: HTMLElement | null = null;
  if (actions.draftEnded) {
    ended = el('p', 'tst-muted tst-draft-ended', `${actions.tester} stopped without a suite.`);
    ended.setAttribute('role', 'status');
    row.append(button('tst-ask-again', 'Ask again', actions.askAgain, true));
    if (actions.showDraft) {
      const show = button('tst-show-draft', 'Show terminal', actions.showDraft);
      show.disabled = false;
      row.append(show);
    }
  } else if (actions.showDraft) {
    // While its testing agent draws, a status stands where Ask Claude was, so a second agent can't be started.
    const status = el('span', 'tst-button tst-drawing', actions.scenariosReady ? 'Scenarios ready for your review below' : `${actions.tester} is drawing up the suite`);
    status.setAttribute('role', 'status');
    status.setAttribute('aria-disabled', 'true');
    const show = button('tst-show-draft', 'Show terminal', actions.showDraft, true);
    show.disabled = false; // a run in progress doesn't stop her looking at its terminal
    row.append(status, show);
  } else row.append(button('tst-ask-suite', 'Ask Claude to draw one up', actions.askClaude, true));
  if (actions.seed) row.append(button('tst-seed-suite', 'Start from the project’s commands', actions.seed));
  if (actions.fromRuns) row.append(button('tst-make-suite', 'Start from Claude’s checks', actions.fromRuns));
  row.append(button('tst-edit-suite', 'Add stages yourself', actions.edit));
  box.append(el('p', 'tst-empty tst-no-suite-title', 'No suite for this repo yet'), ...(ended ? [ended] : []), row);
  if (!actions.showDraft && !actions.draftEnded && actions.askEstimate) box.append(el('p', 'tst-estimate tst-ask-estimate', actions.askEstimate)); // under Ask Claude to draw one up
  if (seedProblem) box.append(el('p', 'tst-muted', `Petal’s copy of the project’s pipeline.json (~/.petal/repos/…/pipeline.json) can’t be used: ${seedProblem}.`));
  return box;
}

const linkButton = (cls: string, text: string, title: string, onClick: () => void): HTMLButtonElement => {
  const button = el('button', `tst-link ${cls}`, text);
  button.type = 'button';
  button.title = title;
  button.addEventListener('click', onClick);
  return button;
};

// "Suite changed · 3 min ago · Undo", or why the file's last change was not taken. Any session may change it.
export function suiteChangeLine(change: SuiteChange | null, problem: string | null, undo: () => void): HTMLElement | null {
  if (!change && !problem) return null;
  const line = el('p', 'tst-suite-change');
  line.setAttribute('role', 'status');
  if (change) {
    const undoButton = linkButton('tst-undo-suite', 'Undo', change.previous ? 'Put back the stages from before this change' : 'Remove the suite again', undo);
    line.append(el('span', null, `Suite changed · ${when(change.at)} · `), undoButton);
  }
  if (problem) line.append(el('span', 'tst-suite-problem', `${change ? ' ' : ''}${problem}`));
  return line;
}

export interface LockHandlers { toggle: (on: boolean) => void; dismiss: () => void; resolve?: ResolveUnconfirmed }

// "Lock tests", a Keep or Restore question for each locked test weakened outside Claude, a red line for each one a
// session weakened and Petal put back, and each edit the lock refused.
export function lockBar(lock: LockView, restored: RestoredFlag[], names: { tester: string; fixer: string }, handlers: LockHandlers): HTMLElement {
  const box = el('div', 'tst-lock');
  const label = el('label', 'tst-toggle tst-lock-toggle');
  const box2 = el('input');
  box2.type = 'checkbox';
  box2.checked = lock.enabled && lock.hookPresent;
  box2.addEventListener('change', () => handlers.toggle(box2.checked));
  label.append(box2, el('span', null, 'Lock tests'), el('span', 'tst-muted', 'Any session may add or fix tests; none may delete, skip or weaken one. Adds one hook to your Claude settings, not the repo.'));
  box.append(label);
  if (lock.enabled && !lock.hookPresent) box.append(el('p', 'tst-lock-flag', 'The lock’s hook is missing from your ~/.claude/settings.json. Turn the lock off and on again.'));
  const asks = restored.filter((f) => f.by === 'unconfirmed');
  if (asks.length) {
    const list = el('ul', 'tst-lock-flags');
    list.append(...asks.map((flag) => unconfirmedRow(flag, handlers.resolve)));
    box.append(list);
  }
  const done = restored.filter((f) => f.by !== 'unconfirmed');
  if (done.length || lock.refusals.length) {
    const list = el('ul', 'tst-lock-flags');
    const lines = [
      ...done.slice(-5).map((flag) => ({ at: flag.at, text: `${restoredText(flag, names)} · ${flag.path} · ${when(flag.at)}` })),
      ...lock.refusals.map((refusal) => ({ at: refusal.at, text: `${refusal.text} · ${when(refusal.at)}` })),
    ].sort((a, b) => b.at - a.at);
    for (const line of lines) {
      const item = el('li', 'tst-lock-flag');
      item.append(el('span', null, line.text));
      list.append(item);
    }
    const dismiss = el('button', 'tst-link tst-lock-dismiss', 'Dismiss');
    dismiss.type = 'button';
    dismiss.addEventListener('click', handlers.dismiss);
    box.append(list, dismiss);
  }
  return box;
}

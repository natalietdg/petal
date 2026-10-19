// The Testing tab's task pieces: the task pickers, a PRD's overview of its tasks' suites, the empty states and the test lock.
import { el } from './dom';
import { when } from './testing-view';
import { groupTasks } from '../shared/task-groups';
import { parseTarget, targetValue, type OverviewRow, type PickSession, type TestTarget } from '../shared/task-testing';
import type { SuiteChange } from '../shared/task-suite';
import type { TaskData } from '../shared/tasks';
import type { LockView } from '../shared/testing';
import { restoredText, type RestoredFlag } from '../shared/test-lock';
import { unconfirmedRow, type ResolveUnconfirmed } from './test-lock-confirm';

// Grouped by PRD, then No PRD; each PRD opens with its overview, subtasks sit under their task.
export function taskPicker(data: TaskData, target: TestTarget, pick: (target: TestTarget) => void): HTMLElement {
  const wrap = el('label', 'tst-picker-bar');
  const select = el('select', 'tst-task-select');
  for (const group of groupTasks(data)) {
    if (!group.prd && !group.tasks.length) continue;
    const box = el('optgroup');
    box.label = group.prd ? `PRD · ${group.prd.title}` : 'No PRD';
    if (group.prd) box.append(new Option(`All tasks in ${group.prd.title}`, targetValue({ kind: 'prd', id: group.prd.id })));
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
  wrap.append(el('span', 'tst-picker-label', 'Testing for'), select);
  return wrap;
}

const percent = (rate: number | null): string => (rate === null ? 'No runs' : `${Math.round(rate * 100)}% passed`);

// Each task's suite at a glance: stages, last result, pass rate, open bugs. A row opens that task.
export function prdOverview(rows: OverviewRow[], open: (taskId: string) => void): HTMLElement {
  const box = el('section', 'tst-overview');
  box.setAttribute('aria-label', 'Tasks in this PRD');
  if (!rows.length) {
    box.append(el('p', 'tst-empty', 'No tasks in this PRD yet. Add them on the Board.'));
    return box;
  }
  const list = el('ul', 'tst-overview-list');
  for (const row of rows) {
    const item = el('li', row.subtask ? 'is-subtask' : '');
    const button = el('button', `tst-overview-row is-${row.last?.state ?? 'none'}`);
    button.type = 'button';
    button.dataset.task = row.task.id;
    const suite = row.stages ? `${row.stages} stage${row.stages === 1 ? '' : 's'}${row.borrowed ? ', its task’s suite' : ''}` : 'No suite yet';
    const last = row.last ? `Last run ${row.last.state} · ${when(row.last.startedAt)}` : 'Not run yet';
    const dot = el('span', `tst-dot is-${row.last?.state ?? 'waiting'}`);
    dot.setAttribute('aria-hidden', 'true');
    button.append(dot, el('span', 'tst-overview-name', row.task.title), el('span', 'tst-overview-meta', [suite, last, percent(row.passRate), `${row.openBugs} open bug${row.openBugs === 1 ? '' : 's'}`].join(' · ')));
    button.addEventListener('click', () => open(row.task.id));
    item.append(button);
    list.append(item);
  }
  box.append(list);
  return box;
}

// The tab is in ~ or outside a repo: her Claude sessions in a repo, live first; a row opens that session's suite.
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
    button.addEventListener('click', () => choose(session.sessionId));
    item.append(button);
    list.append(item);
  }
  box.append(list);
  return box;
}

export function noTasks(openBoard: () => void): HTMLElement {
  const box = el('div', 'tst-no-tasks');
  const go = el('button', 'tst-button tst-open-board', 'Open the Board');
  go.type = 'button';
  go.addEventListener('click', openBoard);
  box.append(el('p', 'tst-empty', 'No tasks yet. Testing keeps a suite for each task. Add a task on the Board first.'), go);
  return box;
}

export interface NoSuiteActions { askClaude: () => void; seed: (() => void) | null; edit: () => void; fromRuns: (() => void) | null }

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
  row.append(button('tst-ask-suite', 'Ask Claude to draw one up', actions.askClaude, true));
  if (actions.seed) row.append(button('tst-seed-suite', 'Start from the project’s commands', actions.seed));
  if (actions.fromRuns) row.append(button('tst-make-pipeline', 'Start from Claude’s checks', actions.fromRuns));
  row.append(button('tst-edit-suite', 'Add stages yourself', actions.edit));
  box.append(el('p', 'tst-empty tst-no-suite-title', 'No suite for this task yet'), row);
  if (seedProblem) box.append(el('p', 'tst-muted', `The project’s .petal/pipeline.json can’t be used: ${seedProblem}.`));
  return box;
}

// "Testing agent updated this suite · 3 min ago · Undo", or why the file's last change was not taken.
export function suiteChangeLine(change: SuiteChange | null, problem: string | null, undo: () => void): HTMLElement | null {
  if (!change && !problem) return null;
  const line = el('p', 'tst-suite-change');
  line.setAttribute('role', 'status');
  if (change) {
    const undoButton = el('button', 'tst-link tst-undo-suite', 'Undo');
    undoButton.type = 'button';
    undoButton.title = change.previous ? 'Put back the stages from before this change' : 'Remove the suite again';
    undoButton.addEventListener('click', undo);
    line.append(el('span', null, `Testing agent updated this suite · ${when(change.at)} · `), undoButton);
  }
  if (problem) line.append(el('span', 'tst-suite-problem', `${change ? ' ' : ''}${problem}`));
  return line;
}

export interface LockHandlers { toggle: (on: boolean) => void; dismiss: () => void; resolve?: ResolveUnconfirmed }

// "Lock tests to the testing agent", a Keep or Restore question for each locked test changed outside Claude, and a
// red line for each one another session changed and Petal put back.
export function lockBar(lock: LockView, restored: RestoredFlag[], fixerName: string, handlers: LockHandlers, busy: boolean): HTMLElement {
  const box = el('div', 'tst-lock');
  const label = el('label', 'tst-toggle tst-lock-toggle');
  const box2 = el('input');
  box2.type = 'checkbox';
  box2.checked = lock.enabled && lock.hookPresent;
  box2.disabled = busy;
  box2.addEventListener('change', () => handlers.toggle(box2.checked));
  label.append(box2, el('span', null, 'Lock tests to the testing agent'), el('span', 'tst-muted', 'Only the testing agent may change tests and suites. Adds a hook to this repo’s .claude/settings.local.json.'));
  box.append(label);
  if (lock.enabled && !lock.hookPresent) box.append(el('p', 'tst-lock-flag', 'The lock’s hook is missing from .claude/settings.local.json. Turn the lock off and on again.'));
  const asks = restored.filter((f) => f.by === 'unconfirmed');
  if (asks.length) {
    const list = el('ul', 'tst-lock-flags');
    list.append(...asks.map((flag) => unconfirmedRow(flag, handlers.resolve, busy)));
    box.append(list);
  }
  const done = restored.filter((f) => f.by !== 'unconfirmed');
  if (done.length) {
    const list = el('ul', 'tst-lock-flags');
    for (const flag of done.slice(-5).reverse()) {
      const item = el('li', 'tst-lock-flag');
      item.append(el('span', null, `${restoredText(flag, fixerName)} · ${flag.path} · ${when(flag.at)}`));
      list.append(item);
    }
    const dismiss = el('button', 'tst-link tst-lock-dismiss', 'Dismiss');
    dismiss.type = 'button';
    dismiss.addEventListener('click', handlers.dismiss);
    box.append(list, dismiss);
  }
  return box;
}

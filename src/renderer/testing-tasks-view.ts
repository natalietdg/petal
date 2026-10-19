// The Testing tab's task pieces: the task pickers, a PRD's overview of its tasks' suites, the empty states and the test lock.
import { el } from './dom';
import { when } from './testing-view';
import { groupsByActivity, taskActivity } from '../shared/task-activity';
import { groupTasks } from '../shared/task-groups';
import { parseTarget, targetValue, type OverviewRow, type PickAgent, type PickSession, type TestTarget } from '../shared/task-testing';
import type { OutsideBy, SuiteChange } from '../shared/task-suite';
import type { TaskData } from '../shared/tasks';
import type { LockView, TestingState } from '../shared/testing';
import { restoredText, type RestoredFlag } from '../shared/test-lock';
import { unconfirmedRow, type ResolveUnconfirmed } from './test-lock-confirm';

// Grouped by PRD, newest activity first; each PRD opens with its overview, subtasks sit under their task.
export function taskPicker(data: TaskData & Pick<TestingState, 'runs' | 'suites'>, target: TestTarget, pick: (target: TestTarget) => void): HTMLElement {
  const wrap = el('label', 'tst-picker-bar');
  const select = el('select', 'tst-task-select');
  for (const group of groupsByActivity(groupTasks(data), taskActivity(data.runs, data.suites))) {
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

// draftEnded: the testing agent stopped with no suite; askAgain then stands where Ask Claude was.
export interface NoSuiteActions { askClaude: () => void; showDraft: (() => void) | null; draftEnded: boolean; askAgain: () => void; seed: (() => void) | null; edit: () => void; fromRuns: (() => void) | null }

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
    ended = el('p', 'tst-muted tst-draft-ended', 'The testing agent stopped without a suite.');
    ended.setAttribute('role', 'status');
    row.append(button('tst-ask-again', 'Ask again', actions.askAgain, true));
    if (actions.showDraft) {
      const show = button('tst-show-draft', 'Show its tab', actions.showDraft);
      show.disabled = false;
      row.append(show);
    }
  } else if (actions.showDraft) {
    // While its testing agent draws, a status stands where Ask Claude was, so a second agent can't be started.
    const status = el('span', 'tst-button tst-drawing', 'Testing agent is drawing up the suite');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-disabled', 'true');
    const show = button('tst-show-draft', 'Show its tab', actions.showDraft, true);
    show.disabled = false; // a run in progress doesn't stop her looking at the tab
    row.append(status, show);
  } else row.append(button('tst-ask-suite', 'Ask Claude to draw one up', actions.askClaude, true));
  if (actions.seed) row.append(button('tst-seed-suite', 'Start from the project’s commands', actions.seed));
  if (actions.fromRuns) row.append(button('tst-make-pipeline', 'Start from Claude’s checks', actions.fromRuns));
  row.append(button('tst-edit-suite', 'Add stages yourself', actions.edit));
  box.append(el('p', 'tst-empty tst-no-suite-title', 'No suite for this task yet'), ...(ended ? [ended] : []), row);
  if (seedProblem) box.append(el('p', 'tst-muted', `The project’s .petal/pipeline.json can’t be used: ${seedProblem}.`));
  return box;
}

export interface OutsideChoice { by: OutsideBy; locked: boolean; use: () => void; keepOld: () => void }

const linkButton = (cls: string, text: string, title: string, onClick: () => void): HTMLButtonElement => {
  const button = el('button', `tst-link ${cls}`, text);
  button.type = 'button';
  button.title = title;
  button.addEventListener('click', onClick);
  return button;
};

// "Testing agent updated this suite · 3 min ago · Undo", or why the file's last change was not taken. A file changed
// outside the testing agent offers her "Use this file"; with the lock off and no session seen, "Keep the old suite" too.
export function suiteChangeLine(change: SuiteChange | null, problem: string | null, undo: () => void, outside: OutsideChoice | null = null): HTMLElement | null {
  if (!change && !problem) return null;
  const line = el('p', 'tst-suite-change');
  line.setAttribute('role', 'status');
  if (change) {
    const undoButton = linkButton('tst-undo-suite', 'Undo', change.previous ? 'Put back the stages from before this change' : 'Remove the suite again', undo);
    line.append(el('span', null, `${change.by === 'you' ? 'You took this file' : 'Testing agent updated this suite'} · ${when(change.at)} · `), undoButton);
  }
  if (problem) line.append(el('span', 'tst-suite-problem', `${change ? ' ' : ''}${problem}`));
  if (problem && outside) {
    line.append(' ', linkButton('tst-use-file', 'Use this file', 'Take the file as it is now. Undo puts the old suite back.', outside.use));
    if (outside.by === 'nobody' && !outside.locked) line.append(el('span', null, ' · '), linkButton('tst-keep-suite', 'Keep the old suite', 'Write the suite in use back over the file', outside.keepOld));
  }
  return line;
}

export interface LockHandlers { toggle: (on: boolean) => void; dismiss: () => void; resolve?: ResolveUnconfirmed }

// "Lock tests to the testing agent", a Keep or Restore question for each locked test changed outside Claude, a red
// line for each one another session changed and Petal put back, and each edit of the main session's the lock refused.
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
  if (done.length || lock.refusals.length) {
    const list = el('ul', 'tst-lock-flags');
    const lines = [
      ...done.slice(-5).map((flag) => ({ at: flag.at, text: `${restoredText(flag, fixerName)} · ${flag.path} · ${when(flag.at)}` })),
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

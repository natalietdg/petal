// The Board's Tasks section: the active tab's project tasks (add, edit, reorder, delete) and giving one to a session,
// by a card's Give task or by dragging a task onto a card. Giving sends the session a brief through the reply box's path.
import * as tabs from './tabs';
import * as coord from './coord';
import { pasteToClaude } from './composer';
import { sinceText } from './sessions-panel';
import { el, isIpcError } from './dom';
import { TASK_STATUS_WORDS, type Task } from '../shared/tasks';
import type { TaskChangeResult, TaskOp, TasksView } from '../shared/coord';
import type { IpcError } from '../shared/types';

export const TASK_DRAG_TYPE = 'application/x-petal-task';

const section = el('section', 'board-tasks');
section.setAttribute('aria-label', 'Tasks');

let view: TasksView | null = null;
let projectTab: string | null = null; // the tab whose repo the list belongs to
let editing: string | null = null;
let note = '';
let confirm: { taskId: string; toTabId: string; text: string } | null = null;
let onChanged: () => void = () => {};
let shownKey = '';
const draft = { title: '', notes: '' }; // the add form survives a repaint

export const element = (): HTMLElement => section;
export const current = (): TasksView | null => view;

// Called by the board: repaint the cards when the list changes.
export function init(changed: () => void): void {
  onChanged = changed;
}

// Re-reads the active tab's project list.
export async function load(): Promise<void> {
  projectTab = tabs.active()?.id ?? null;
  const result = projectTab ? await window.pastel.tasks.get(projectTab) : null;
  view = result && !isIpcError(result) ? result : null;
  if (result && isIpcError(result)) note = result.error;
  const key = JSON.stringify([projectTab, view, note]);
  if (key === shownKey) return; // nothing new: leave her typing alone
  render();
  onChanged();
}

async function change(op: TaskOp): Promise<TaskChangeResult | IpcError | null> {
  if (!projectTab) return null;
  const result = await window.pastel.tasks.change(projectTab, op);
  if (isIpcError(result)) {
    note = result.error;
  } else {
    view = result;
    note = '';
  }
  render();
  onChanged();
  return result;
}

const tabOf = (tabId: string): tabs.Tab | null => tabs.get(tabId);

// One owner per task: a task with someone else asks first. The brief goes out only once the task is theirs.
export async function give(taskId: string, toTabId: string, reassign = false): Promise<void> {
  confirm = null;
  const result = await change({ kind: 'assign', id: taskId, toTabId, reassign });
  if (!result || isIpcError(result)) return;
  if (result.confirm) {
    confirm = { taskId, toTabId, text: result.confirm };
    render();
    return;
  }
  const tab = tabOf(toTabId);
  const sent = tab && result.brief ? await pasteToClaude(tab, result.brief) : false;
  if (!sent) {
    await change({ kind: 'release', id: taskId });
    note = `Couldn’t send the task to ${result.owner?.name ?? 'that session'}, so it is open again.`;
    render();
  }
}

// Tasks a card can be given: anything not finished, in the card's repo only.
export function giveable(root: string | null): Task[] {
  if (!view?.repo || !root || root !== view.repo) return [];
  return view.tasks.filter((t) => t.status !== 'done');
}

function button(className: string, text: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', className, text);
  b.type = 'button';
  b.title = label;
  b.setAttribute('aria-label', label);
  b.addEventListener('click', onClick);
  return b;
}

function ownerLine(task: Task): string {
  if (task.status === 'done') return task.doneBy ? `Done by ${task.doneBy.name} · ${sinceText(task.doneAt)}` : 'Done';
  if (!task.owner) return '';
  return [task.owner.name, task.owner.branch].filter(Boolean).join(' · ');
}

function editRow(task: Task): HTMLElement {
  const form = el('form', 'task-edit');
  const title = el('input', 'task-input');
  title.value = task.title;
  title.setAttribute('aria-label', 'Task title');
  const notes = el('input', 'task-input task-notes-input');
  notes.value = task.notes;
  notes.placeholder = 'Notes (optional)';
  notes.setAttribute('aria-label', 'Task notes');
  const save = el('button', 'flow-button task-save', 'Save');
  save.type = 'submit';
  const cancel = button('session-link task-cancel', 'Cancel', 'Cancel editing', () => { editing = null; render(); });
  form.append(title, notes, save, cancel);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    editing = null;
    void change({ kind: 'edit', id: task.id, title: title.value, notes: notes.value });
  });
  queueMicrotask(() => title.focus());
  return form;
}

function taskRow(task: Task, index: number, count: number): HTMLLIElement {
  const row = el('li', `task-row ${task.status}`);
  row.dataset.taskId = task.id;
  if (editing === task.id) {
    row.append(editRow(task));
    return row;
  }
  row.draggable = task.status !== 'done';
  row.addEventListener('dragstart', (event) => {
    event.dataTransfer?.setData(TASK_DRAG_TYPE, task.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'link';
    section.classList.add('dragging');
  });
  row.addEventListener('dragend', () => section.classList.remove('dragging'));
  const main = el('div', 'task-main');
  const head = el('div', 'task-head');
  head.append(el('span', `task-status ${task.status}`, TASK_STATUS_WORDS[task.status]), el('span', 'task-title', task.title));
  main.append(head);
  if (task.notes) main.append(el('span', 'task-notes', task.notes));
  const owner = ownerLine(task);
  if (owner) main.append(el('span', 'task-owner', owner));
  const actions = el('div', 'task-actions');
  const up = button('task-action task-up', '↑', `Move “${task.title}” up`, () => void change({ kind: 'move', id: task.id, to: index - 1 }));
  const down = button('task-action task-down', '↓', `Move “${task.title}” down`, () => void change({ kind: 'move', id: task.id, to: index + 1 }));
  up.disabled = index === 0;
  down.disabled = index === count - 1;
  actions.append(up, down,
    button('task-action task-edit-button', 'Edit', `Edit “${task.title}”`, () => { editing = task.id; render(); }),
    button('task-action task-delete', 'Delete', `Delete “${task.title}”`, () => void change({ kind: 'delete', id: task.id })));
  row.append(main, actions);
  return row;
}

function addForm(): HTMLFormElement {
  const form = el('form', 'task-add');
  const title = el('input', 'task-input task-title-input');
  title.placeholder = 'Add a task…';
  title.setAttribute('aria-label', 'New task title');
  title.value = draft.title;
  title.addEventListener('input', () => { draft.title = title.value; });
  const notes = el('input', 'task-input task-notes-input');
  notes.placeholder = 'Notes (optional)';
  notes.setAttribute('aria-label', 'New task notes');
  notes.value = draft.notes;
  notes.addEventListener('input', () => { draft.notes = notes.value; });
  const add = el('button', 'flow-button task-add-button', 'Add');
  add.type = 'submit';
  form.append(title, notes, add);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!title.value.trim()) { title.focus(); return; }
    const op: TaskOp = { kind: 'add', title: title.value, notes: notes.value };
    draft.title = '';
    draft.notes = '';
    void change(op).then(() => section.querySelector<HTMLInputElement>('.task-title-input')?.focus());
  });
  return form;
}

function confirmLine(): HTMLElement | null {
  if (!confirm) return null;
  const { taskId, toTabId, text } = confirm;
  const line = el('p', 'board-confirm task-confirm');
  const yes = button('session-link', 'Give it', 'Give it to this session instead', () => void give(taskId, toTabId, true));
  const no = button('session-link', 'Cancel', 'Keep its owner', () => { confirm = null; render(); });
  line.append(el('span', '', text), yes, el('span', 'session-sep', '·'), no);
  return line;
}

export function render(): void {
  shownKey = JSON.stringify([projectTab, view, note]);
  const focused = (document.activeElement as HTMLElement | null)?.closest('.board-tasks') ? (document.activeElement as HTMLElement).className : null;
  const head = el('header', 'tasks-head');
  head.append(el('h3', 'tasks-title', 'Tasks'));
  if (view?.name) head.append(el('span', 'tasks-project', [view.name, view.branch].filter(Boolean).join(' · ')));
  const parts: HTMLElement[] = [head];
  if (!view?.repo) {
    parts.push(el('p', 'tasks-empty', 'Open a Claude session in a git repo to keep tasks for it.'));
  } else {
    if (view.problem) parts.push(el('p', 'board-note tasks-problem', view.problem));
    const list = el('ol', 'task-list');
    list.append(...view.tasks.map((t, i, all) => taskRow(t, i, all.length)));
    if (view.tasks.length) parts.push(list);
    else parts.push(el('p', 'tasks-empty', 'No tasks yet. Add one, then give it to a session with Give task or by dragging it onto a card.'));
    if (!view.problem) parts.push(addForm());
  }
  const asking = confirmLine();
  if (asking) parts.push(asking);
  if (note) parts.push(el('p', 'board-note tasks-note', note));
  section.replaceChildren(...parts);
  if (focused) section.querySelector<HTMLElement>(`[class="${CSS.escape(focused)}"]`)?.focus();
}

coord.onChange(() => { if (view?.repo && section.isConnected) void load(); });
render();

// The Board's PRD pieces: a PRD's heading (edit, delete), the New PRD form, a task's PRD picker and its Split form.
import { el } from './dom';
import type { Prd, Task } from '../shared/tasks';

export function button(className: string, text: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', className, text);
  b.type = 'button';
  b.title = label;
  b.setAttribute('aria-label', label);
  b.addEventListener('click', onClick);
  return b;
}

function input(className: string, value: string, placeholder: string, label: string): HTMLInputElement {
  const i = el('input', `task-input ${className}`);
  i.value = value;
  i.placeholder = placeholder;
  i.setAttribute('aria-label', label);
  return i;
}

function form(className: string, fields: HTMLElement[], submitText: string, onSubmit: () => void, cancel?: () => void): HTMLFormElement {
  const f = el('form', className);
  const submit = el('button', 'flow-button task-save', submitText);
  submit.type = 'submit';
  f.append(...fields, submit);
  if (cancel) f.append(button('session-link task-cancel', 'Cancel', 'Cancel', cancel));
  f.addEventListener('submit', (event) => { event.preventDefault(); onSubmit(); });
  return f;
}

export interface PrdHandlers {
  edit: () => void;
  remove: () => void;
  save: (title: string, notes: string) => void;
  cancel: () => void;
}

export function prdHeading(prd: Prd, count: number, editing: boolean, on: PrdHandlers): HTMLElement {
  const head = el('header', 'prd-head');
  if (editing) {
    const title = input('prd-title-input', prd.title, 'PRD title', 'PRD title');
    const notes = input('task-notes-input', prd.notes, 'Notes (optional)', 'PRD notes');
    head.append(form('task-edit prd-edit', [title, notes], 'Save', () => on.save(title.value, notes.value), on.cancel));
    queueMicrotask(() => title.focus());
    return head;
  }
  const main = el('div', 'task-main');
  const line = el('div', 'task-head');
  line.append(el('span', 'prd-badge', 'PRD'), el('span', 'prd-title', prd.title), el('span', 'prd-count', `${count} task${count === 1 ? '' : 's'}`));
  main.append(line);
  if (prd.notes) main.append(el('span', 'task-notes', prd.notes));
  const actions = el('div', 'task-actions');
  actions.append(
    button('task-action prd-edit-button', 'Edit', `Edit PRD “${prd.title}”`, on.edit),
    button('task-action prd-delete', 'Delete', `Delete PRD “${prd.title}”. Its tasks stay, ungrouped.`, on.remove),
  );
  head.append(main, actions);
  return head;
}

export function prdAddForm(draft: { title: string; notes: string }, add: (title: string, notes: string) => void): HTMLFormElement {
  const title = input('prd-title-input', draft.title, 'New PRD…', 'New PRD title');
  title.addEventListener('input', () => { draft.title = title.value; });
  const notes = input('task-notes-input', draft.notes, 'What it covers (optional)', 'New PRD notes');
  notes.addEventListener('input', () => { draft.notes = notes.value; });
  return form('task-add prd-add', [title, notes], 'Add PRD', () => {
    if (!title.value.trim()) { title.focus(); return; }
    add(title.value, notes.value);
  });
}

// A top-level task's PRD; a subtask follows its task.
export function prdPicker(task: Task, prds: readonly Prd[], pick: (prdId: string | null) => void): HTMLSelectElement {
  const select = el('select', 'task-prd');
  select.setAttribute('aria-label', `PRD for “${task.title}”`);
  select.title = 'Group this task under a PRD';
  select.append(new Option('No PRD', ''), ...prds.map((p) => new Option(p.title, p.id)));
  select.value = task.prdId ?? '';
  select.addEventListener('change', () => pick(select.value || null));
  return select;
}

// One subtask per line; each can then be given to its own session.
export function splitForm(task: Task, split: (titles: string[]) => void, cancel: () => void): HTMLFormElement {
  const titles = el('textarea', 'task-input task-split-input');
  titles.rows = 3;
  titles.placeholder = 'One subtask per line';
  titles.setAttribute('aria-label', `Subtasks for “${task.title}”, one per line`);
  queueMicrotask(() => titles.focus());
  return form('task-edit task-split', [titles], 'Split', () => {
    const lines = titles.value.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) { titles.focus(); return; }
    split(lines);
  }, cancel);
}

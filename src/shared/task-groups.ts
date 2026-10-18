// PRDs and subtasks: a PRD groups related tasks, a task splits into subtasks one level deep. Pure, like tasks.ts.
import { cleanNotes, cleanTitle, findTask, newTask, type Prd, type Task, type TaskData } from './tasks';

export const MAX_SUBTASKS = 12;

function findPrd(prds: readonly Prd[], id: string): Prd {
  const prd = prds.find((p) => p.id === id);
  if (!prd) throw new Error('That PRD is gone. It may have been deleted in another window.');
  return prd;
}

export const addPrd = (prds: readonly Prd[], input: { title: unknown; notes?: unknown }, id: string, now: number): Prd[] =>
  [...prds, { id, title: cleanTitle(input.title, 'A PRD'), notes: cleanNotes(input.notes), createdAt: now }];

export const editPrd = (prds: readonly Prd[], id: string, input: { title: unknown; notes?: unknown }): Prd[] => {
  const prd = findPrd(prds, id);
  return prds.map((p) => (p.id === id ? { ...prd, title: cleanTitle(input.title, 'A PRD'), notes: cleanNotes(input.notes) } : p));
};

// Its tasks stay, ungrouped.
export function removePrd(data: TaskData, id: string): TaskData {
  findPrd(data.prds, id);
  return { prds: data.prds.filter((p) => p.id !== id), tasks: data.tasks.map((t) => (t.prdId === id ? { ...t, prdId: null } : t)) };
}

// A subtask follows its task, so only a top-level task moves between PRDs, taking its subtasks along.
export function setTaskPrd(data: TaskData, id: string, prdId: string | null): Task[] {
  const task = findTask(data.tasks, id);
  if (task.parentId) throw new Error('A subtask stays in its task’s PRD.');
  if (prdId !== null) findPrd(data.prds, prdId);
  return data.tasks.map((t) => (t.id === id || t.parentId === id ? { ...t, prdId } : t));
}

export const subtasksOf = (tasks: readonly Task[], id: string): Task[] => tasks.filter((t) => t.parentId === id);

// Adds subtasks after the task's last one; each starts open with its own owner slot.
export function splitTask(tasks: readonly Task[], id: string, titles: readonly unknown[], ids: readonly string[], now: number): Task[] {
  const parent = findTask(tasks, id);
  if (parent.parentId) throw new Error('A subtask can’t be split again.');
  const named = titles.map((t) => String(t ?? '').trim()).filter(Boolean);
  if (!named.length) throw new Error('Name at least one subtask.');
  if (subtasksOf(tasks, id).length + named.length > MAX_SUBTASKS) throw new Error(`A task holds at most ${MAX_SUBTASKS} subtasks.`);
  const added = named.map((title, i) => newTask(ids[i] ?? `${id}-${i}`, { title }, now, { prdId: parent.prdId, parentId: id }));
  const last = tasks.reduce((at, t, i) => (t.id === id || t.parentId === id ? i : at), -1);
  return [...tasks.slice(0, last + 1), ...added, ...tasks.slice(last + 1)];
}

export interface TaskTree { task: Task; subtasks: Task[] }
export interface TaskGroup { prd: Prd | null; tasks: TaskTree[] }

// Each PRD in order (empty ones too), then the ungrouped tasks; subtasks nest under their task.
export function groupTasks({ tasks, prds }: TaskData): TaskGroup[] {
  const treeOf = (task: Task): TaskTree => ({ task, subtasks: subtasksOf(tasks, task.id) });
  const top = tasks.filter((t) => !t.parentId);
  return [
    ...prds.map((prd) => ({ prd, tasks: top.filter((t) => t.prdId === prd.id).map(treeOf) })),
    { prd: null, tasks: top.filter((t) => !t.prdId || !prds.some((p) => p.id === t.prdId)).map(treeOf) },
  ];
}

// The list index to move a task to so it swaps with its nearest sibling (same PRD, same parent); null at the end.
export function siblingIndex(tasks: readonly Task[], id: string, delta: -1 | 1): number | null {
  const task = findTask(tasks, id);
  const at = tasks.indexOf(task);
  const same = (t: Task) => t.parentId === task.parentId && t.prdId === task.prdId;
  for (let i = at + delta; i >= 0 && i < tasks.length; i += delta) if (same(tasks[i] as Task)) return i;
  return null;
}

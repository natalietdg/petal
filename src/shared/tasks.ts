// A project's tasks, each with at most one owner: the session Petal gave it to. Stored in <repo>/.petal/tasks.json.
// Pure list operations; main/tasks-store.ts reads and writes the file.
import type { TaskLine, TaskLineState } from './task-line';

export type TaskStatus = 'open' | 'claimed' | TaskLineState;
export const TASK_STATUS_WORDS: Record<TaskStatus, string> = { open: 'Open', claimed: 'Given', working: 'Working', blocked: 'Blocked', done: 'Done' };

export interface TaskOwner {
  sessionId: string;
  name: string;
  branch: string | null;
}

export interface Task {
  id: string;
  title: string;
  notes: string;
  status: TaskStatus;
  owner: TaskOwner | null;
  createdAt: number;
  claimedAt: number | null; // when it was given to its owner
  doneAt: number | null;
  doneBy: TaskOwner | null;
}

export interface TaskFile {
  version: 1;
  tasks: Task[];
}

export const MAX_TITLE = 120;
export const MAX_NOTES = 600;
const STATUSES: readonly TaskStatus[] = ['open', 'claimed', 'working', 'blocked', 'done'];

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

export function cleanTitle(raw: unknown): string {
  const title = oneLine(String(raw ?? '')).slice(0, MAX_TITLE);
  if (!title) throw new Error('A task needs a title.');
  return title;
}

export const cleanNotes = (raw: unknown): string => String(raw ?? '').trim().slice(0, MAX_NOTES);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

function toOwner(raw: unknown): TaskOwner | null {
  if (!isRecord(raw) || typeof raw.sessionId !== 'string' || typeof raw.name !== 'string') return null;
  return { sessionId: raw.sessionId, name: raw.name, branch: typeof raw.branch === 'string' ? raw.branch : null };
}

const numberOrNull = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

function toTask(raw: unknown): Task | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.title !== 'string' || !raw.title.trim()) return null;
  const status = STATUSES.includes(raw.status as TaskStatus) ? raw.status as TaskStatus : 'open';
  const owner = toOwner(raw.owner);
  return {
    id: raw.id,
    title: raw.title,
    notes: typeof raw.notes === 'string' ? raw.notes : '',
    status: owner || status === 'done' ? status : 'open', // an owner-less task can only be open or done
    owner,
    createdAt: numberOrNull(raw.createdAt) ?? 0,
    claimedAt: numberOrNull(raw.claimedAt),
    doneAt: numberOrNull(raw.doneAt),
    doneBy: toOwner(raw.doneBy),
  };
}

export type TaskFileCheck = { ok: true; tasks: Task[] } | { ok: false; problem: string };

// The file as written by Petal; one bad task drops out, a file of the wrong shape is refused whole.
export function validateTaskFile(raw: unknown): TaskFileCheck {
  if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.tasks)) return { ok: false, problem: 'it isn’t a Petal task list.' };
  const tasks = raw.tasks.map(toTask).filter((t): t is Task => t !== null);
  const ids = new Set(tasks.map((t) => t.id));
  return ids.size === tasks.length ? { ok: true, tasks } : { ok: false, problem: 'two tasks share an id.' };
}

function find(tasks: readonly Task[], id: string): Task {
  const task = tasks.find((t) => t.id === id);
  if (!task) throw new Error('That task is gone. It may have been deleted in another window.');
  return task;
}

const replace = (tasks: readonly Task[], next: Task): Task[] => tasks.map((t) => (t.id === next.id ? next : t));

export function addTask(tasks: readonly Task[], input: { title: unknown; notes?: unknown }, id: string, now: number): Task[] {
  return [...tasks, { id, title: cleanTitle(input.title), notes: cleanNotes(input.notes), status: 'open', owner: null, createdAt: now, claimedAt: null, doneAt: null, doneBy: null }];
}

export const editTask = (tasks: readonly Task[], id: string, input: { title: unknown; notes?: unknown }): Task[] =>
  replace(tasks, { ...find(tasks, id), title: cleanTitle(input.title), notes: cleanNotes(input.notes) });

// Moves a task to `to` (clamped), the others keeping their order.
export function moveTask(tasks: readonly Task[], id: string, to: number): Task[] {
  const task = find(tasks, id);
  const rest = tasks.filter((t) => t.id !== id);
  if (!Number.isFinite(to)) throw new Error('Move it to which place?');
  const at = Math.max(0, Math.min(rest.length, Math.round(to)));
  return [...rest.slice(0, at), task, ...rest.slice(at)];
}

export const removeTask = (tasks: readonly Task[], id: string): Task[] => { find(tasks, id); return tasks.filter((t) => t.id !== id); };

export type AssignResult = { tasks: Task[]; task: Task } | { confirm: string; owner: TaskOwner };

// One owner per task: a task someone else holds needs reassign: true. Giving a done task opens it again.
export function assignTask(tasks: readonly Task[], id: string, owner: TaskOwner, now: number, { reassign = false } = {}): AssignResult {
  const task = find(tasks, id);
  const held = task.owner && task.owner.sessionId !== owner.sessionId && task.status !== 'done' ? task.owner : null;
  if (held && !reassign) return { confirm: `“${task.title}” is with ${held.name}. Give it to ${owner.name} instead?`, owner: held };
  const next: Task = { ...task, owner, status: 'claimed', claimedAt: now, doneAt: null, doneBy: null };
  return { tasks: replace(tasks, next), task: next };
}

export const releaseTask = (tasks: readonly Task[], id: string): Task[] => {
  const task = find(tasks, id);
  return replace(tasks, { ...task, owner: null, status: task.status === 'done' ? 'done' : 'open', claimedAt: null });
};

const normal = (title: string): string => title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// The session's task a Task line is about: same title, else its only unfinished one.
export function taskForLine(tasks: readonly Task[], sessionId: string, line: TaskLine): Task | null {
  const owned = tasks.filter((t) => t.owner?.sessionId === sessionId);
  const named = owned.find((t) => normal(t.title) === normal(line.title));
  if (named) return named;
  const open = owned.filter((t) => t.status !== 'done');
  return open.length === 1 ? open[0] ?? null : null;
}

export interface LineApplied {
  tasks: Task[];
  task: Task;
  from: TaskStatus;
}

// A Task line written at `at` moves its task's status; lines from before it was given, or saying nothing new, are ignored.
export function applyTaskLine(tasks: readonly Task[], sessionId: string, line: TaskLine, at: number): LineApplied | null {
  const task = taskForLine(tasks, sessionId, line);
  if (!task || task.status === line.state || (task.claimedAt !== null && at < task.claimedAt)) return null;
  const done = line.state === 'done';
  const next: Task = { ...task, status: line.state, doneAt: done ? at : null, doneBy: done ? task.owner : null };
  return { tasks: replace(tasks, next), task: next, from: task.status };
}

const sentence = (text: string): string => {
  const flat = oneLine(text);
  return !flat || /[.!?]$/.test(flat) ? flat : `${flat}.`;
};

// What Petal sends the session when she gives it a task: one paragraph, through the reply box's send path.
export function taskBrief(task: Pick<Task, 'title' | 'notes'>): string {
  const title = oneLine(task.title).replace(/[.!?]+$/, '');
  return [`Task: ${title}.`, sentence(task.notes), `When you start, end your replies with **Task:** ${title} · working|blocked|done.`].filter(Boolean).join(' ');
}

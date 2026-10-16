// Project tasks: the Task line, the list's CRUD and order, one owner per task, the brief, and the repo file.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { removeTempDirs, tempDir, tmpLeftovers } from './helpers';
import { parseTask, parseTaskLine } from '../src/shared/task-line';
import {
  addTask, applyTaskLine, assignTask, editTask, moveTask, releaseTask, removeTask, taskBrief, taskForLine, validateTaskFile, type Task, type TaskOwner,
} from '../src/shared/tasks';
import { sessionTask } from '../src/shared/coord';
import { loadTasks, tasksFile, updateTasks } from '../src/main/tasks-store';

afterEach(removeTempDirs);

describe('parseTaskLine', () => {
  it('reads the three states and the label forms', () => {
    expect(parseTaskLine('**Task:** Fix the login · working')).toEqual({ title: 'Fix the login', state: 'working' });
    expect(parseTaskLine('**Task**: Fix the login · Blocked.')).toEqual({ title: 'Fix the login', state: 'blocked' });
    expect(parseTaskLine('Task: Fix · the login • done')).toEqual({ title: 'Fix · the login', state: 'done' });
    expect(parseTaskLine('- **Task:** `Ship 1.0` · done')).toEqual({ title: 'Ship 1.0', state: 'done' });
  });

  it('rejects the template itself, unknown states, a missing title and other labels', () => {
    expect(parseTaskLine('**Task:** Fix the login · working|blocked|done.')).toBeNull();
    expect(parseTaskLine('**Task:** Fix the login · started')).toBeNull();
    expect(parseTaskLine('**Task:** Fix the login')).toBeNull();
    expect(parseTaskLine('**Task:** · done')).toBeNull();
    expect(parseTaskLine('**Tasks:** Fix · done')).toBeNull();
    expect(parseTaskLine('The task: Fix · done')).toBeNull();
  });

  it('takes the last line outside code fences', () => {
    const reply = '**Done.**\n\n```\n**Task:** Fake · done\n```\n**Task:** Fix the login · working\n\nlater\n**Task:** Fix the login · done';
    expect(parseTask(reply)).toEqual({ title: 'Fix the login', state: 'done' });
    expect(parseTask('```\n**Task:** Fake · done\n```')).toBeNull();
  });
});

const one: TaskOwner = { sessionId: 's1', name: 'Login work', branch: 'login' };
const two: TaskOwner = { sessionId: 's2', name: 'Docs work', branch: 'main' };

function threeTasks(): Task[] {
  let tasks: Task[] = [];
  tasks = addTask(tasks, { title: '  Fix   the login ', notes: ' Users get 401 ' }, 'a', 1);
  tasks = addTask(tasks, { title: 'Write docs' }, 'b', 2);
  tasks = addTask(tasks, { title: 'Ship it' }, 'c', 3);
  return tasks;
}

describe('task list', () => {
  it('adds, edits, reorders and deletes', () => {
    let tasks = threeTasks();
    expect(tasks.map((t) => [t.id, t.title, t.notes, t.status])).toEqual([['a', 'Fix the login', 'Users get 401', 'open'], ['b', 'Write docs', '', 'open'], ['c', 'Ship it', '', 'open']]);
    tasks = editTask(tasks, 'b', { title: 'Write the docs', notes: 'API only' });
    expect(tasks[1]).toMatchObject({ title: 'Write the docs', notes: 'API only' });
    expect(moveTask(tasks, 'c', 0).map((t) => t.id)).toEqual(['c', 'a', 'b']);
    expect(moveTask(tasks, 'a', 99).map((t) => t.id)).toEqual(['b', 'c', 'a']);
    expect(moveTask(tasks, 'b', -3).map((t) => t.id)).toEqual(['b', 'a', 'c']);
    expect(removeTask(tasks, 'a').map((t) => t.id)).toEqual(['b', 'c']);
    expect(() => addTask(tasks, { title: '   ' }, 'd', 4)).toThrow(/title/);
    expect(() => editTask(tasks, 'zz', { title: 'x' })).toThrow(/gone/);
  });

  it('gives a task to one owner; another owner needs a reassign', () => {
    const tasks = threeTasks();
    const given = assignTask(tasks, 'a', one, 10);
    if (!('tasks' in given)) throw new Error('expected the task to be given');
    expect(given.task).toMatchObject({ status: 'claimed', owner: one, claimedAt: 10 });
    const asked = assignTask(given.tasks, 'a', two, 11);
    expect(asked).toMatchObject({ owner: one });
    expect('confirm' in asked && asked.confirm).toContain('is with Login work');
    const again = assignTask(given.tasks, 'a', one, 12);
    expect('tasks' in again).toBe(true); // the same owner never asks
    const moved = assignTask(given.tasks, 'a', two, 13, { reassign: true });
    if (!('tasks' in moved)) throw new Error('expected a reassign');
    expect(moved.tasks.filter((t) => t.owner).map((t) => [t.id, t.owner?.sessionId])).toEqual([['a', 's2']]);
    expect(releaseTask(moved.tasks, 'a')[0]).toMatchObject({ owner: null, status: 'open' });
  });

  it('moves status by Task lines from its owner only, after it was given', () => {
    const given = assignTask(threeTasks(), 'a', one, 100);
    if (!('tasks' in given)) throw new Error('expected the task to be given');
    expect(applyTaskLine(given.tasks, 's2', { title: 'Fix the login', state: 'done' }, 200)).toBeNull(); // not its task
    expect(applyTaskLine(given.tasks, 's1', { title: 'Fix the login', state: 'working' }, 50)).toBeNull(); // from before it was given
    const working = applyTaskLine(given.tasks, 's1', { title: 'fix the LOGIN!', state: 'working' }, 150);
    expect(working?.task).toMatchObject({ status: 'working', doneAt: null });
    expect(applyTaskLine(working?.tasks ?? [], 's1', { title: 'Fix the login', state: 'working' }, 160)).toBeNull(); // nothing new
    const done = applyTaskLine(working?.tasks ?? [], 's1', { title: 'Login fix', state: 'done' }, 300); // its only open task
    expect(done?.task).toMatchObject({ status: 'done', doneAt: 300, doneBy: one });
    expect(sessionTask(done?.tasks ?? [], 's1')).toEqual({ id: 'a', title: 'Fix the login', status: 'done', doneAt: 300, doneBy: 'Login work' });
    expect(taskForLine(done?.tasks ?? [], 's1', { title: 'Unknown', state: 'working' })).toBeNull(); // done, and the title doesn't match
  });

  it('writes the brief in one paragraph with the Task line to use', () => {
    expect(taskBrief({ title: 'Fix the login.', notes: 'Users get 401\non refresh' })).toBe(
      'Task: Fix the login. Users get 401 on refresh. When you start, end your replies with **Task:** Fix the login · working|blocked|done.');
    expect(taskBrief({ title: 'Ship it', notes: '' })).toBe('Task: Ship it. When you start, end your replies with **Task:** Ship it · working|blocked|done.');
  });

  it('validates a stored file: bad tasks drop, a wrong shape is refused', () => {
    expect(validateTaskFile({ version: 1, tasks: [{ id: 'a', title: 'A', status: 'working' }, { id: 'b' }, 'junk'] })).toEqual({
      ok: true, tasks: [{ id: 'a', title: 'A', notes: '', status: 'open', owner: null, createdAt: 0, claimedAt: null, doneAt: null, doneBy: null }],
    });
    expect(validateTaskFile({ tasks: [] }).ok).toBe(false);
    expect(validateTaskFile({ version: 1, tasks: [{ id: 'a', title: 'A' }, { id: 'a', title: 'B' }] }).ok).toBe(false);
  });
});

describe('tasks-store', () => {
  it('saves in .petal/tasks.json with a self-ignoring folder, atomically', () => {
    const repo = tempDir('petal-repo-');
    fs.mkdirSync(path.join(repo, '.git'));
    updateTasks(repo, (tasks) => ({ tasks: addTask(tasks, { title: 'One' }, 'a', 1) }));
    updateTasks(repo, (tasks) => ({ tasks: addTask(tasks, { title: 'Two' }, 'b', 2) }));
    expect(loadTasks(repo).tasks.map((t) => t.title)).toEqual(['One', 'Two']);
    expect(fs.readFileSync(path.join(repo, '.petal', '.gitignore'), 'utf8')).toBe('*\n');
    expect(tmpLeftovers(path.join(repo, '.petal'))).toEqual([]);
    expect(updateTasks(repo, () => null)).toBeNull();
  });

  it('keeps a .gitignore she wrote and never saves over a broken file', () => {
    const repo = tempDir('petal-repo-');
    fs.mkdirSync(path.join(repo, '.petal'));
    fs.writeFileSync(path.join(repo, '.petal', '.gitignore'), 'tasks.json\n');
    fs.writeFileSync(tasksFile(repo), '{oops');
    expect(loadTasks(repo).problem).toMatch(/isn’t valid JSON/);
    expect(() => updateTasks(repo, (tasks) => ({ tasks: addTask(tasks, { title: 'x' }, 'a', 1) }))).toThrow(/won’t replace it/);
    expect(fs.readFileSync(tasksFile(repo), 'utf8')).toBe('{oops');
    expect(fs.readFileSync(path.join(repo, '.petal', '.gitignore'), 'utf8')).toBe('tasks.json\n');
  });

  it('refuses a write that a symlink would carry out of the repo', () => {
    const repo = tempDir('petal-repo-');
    const outside = tempDir('petal-outside-');
    fs.mkdirSync(path.join(repo, '.petal'));
    fs.writeFileSync(path.join(repo, '.petal', '.gitignore'), '*\n');
    fs.symlinkSync(path.join(outside, 'stolen.json'), tasksFile(repo));
    expect(() => updateTasks(repo, (tasks) => ({ tasks: addTask(tasks, { title: 'x' }, 'a', 1) }))).toThrow(/outside/);
    expect(fs.existsSync(path.join(outside, 'stolen.json'))).toBe(false);
  });
});

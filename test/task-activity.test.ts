// The Testing pickers by recent activity: task times, runs and suite files, groups and subtasks, ties and missing times.
import { describe, expect, it } from 'vitest';
import { byRecent, groupsByActivity, latest, taskActivity } from '../src/shared/task-activity';
import { groupTasks } from '../src/shared/task-groups';
import type { Prd, Task, TaskData } from '../src/shared/tasks';
import type { PipelineRun } from '../src/shared/testing';

const task = (id: string, createdAt: number, more: Partial<Task> = {}): Task =>
  ({ id, title: id, notes: '', status: 'open', owner: null, createdAt, claimedAt: null, doneAt: null, doneBy: null, prdId: null, parentId: null, ...more });
const prd = (id: string): Prd => ({ id, title: id, notes: '', createdAt: 1 });
const run = (taskId: string, startedAt: number): PipelineRun => ({ id: `${taskId}-${startedAt}`, taskId, startedAt } as PipelineRun);
const titles = (data: TaskData, at: (t: Task) => number | null) =>
  groupsByActivity(groupTasks(data), at).map((g) => [g.prd?.id ?? 'none', ...g.tasks.flatMap((tree) => [tree.task.id, ...tree.subtasks.map((s) => `↳${s.id}`)])]);

describe('latest and byRecent', () => {
  it('takes the newest set time, null when none', () => {
    expect(latest(3, null, 9, undefined, 5)).toBe(9);
    expect(latest(null, undefined, 0)).toBeNull();
  });

  it('sorts newest first, ties keep the old order, missing times go last', () => {
    const items = [['a', 5], ['b', null], ['c', 9], ['d', 5], ['e', null]] as const;
    expect(byRecent(items, (i) => i[1]).map((i) => i[0])).toEqual(['c', 'a', 'd', 'b', 'e']);
  });
});

describe('taskActivity', () => {
  it('is the newest of made, given, finished, its latest run and its suite file', () => {
    const at = taskActivity([run('a', 40), run('a', 25), run('b', 10)], { b: { suite: null, change: null, problem: null, at: 70 } });
    expect(at(task('a', 1, { claimedAt: 30 }))).toBe(40);
    expect(at(task('b', 1, { doneAt: 50 }))).toBe(70);
    expect(at(task('c', 2))).toBe(2);
  });
});

describe('groupsByActivity', () => {
  const data: TaskData = {
    prds: [prd('p1'), prd('p2'), prd('empty')],
    tasks: [
      task('old', 10, { prdId: 'p1' }),
      task('parent', 20, { prdId: 'p1' }),
      task('sub1', 21, { prdId: 'p1', parentId: 'parent' }),
      task('sub2', 22, { prdId: 'p1', parentId: 'parent' }),
      task('fresh', 30, { prdId: 'p2' }),
      task('loose', 25),
    ],
  };

  it('orders tasks and groups newest first, No PRD placed by its own newest task, empty PRDs last', () => {
    const at = taskActivity([run('sub1', 50)], {});
    expect(titles(data, at)).toEqual([['p1', 'parent', '↳sub1', '↳sub2', 'old'], ['p2', 'fresh'], ['none', 'loose'], ['empty']]);
  });

  it('keeps the stored order on ties', () => {
    expect(titles(data, () => 7)).toEqual([['p1', 'old', 'parent', '↳sub1', '↳sub2'], ['p2', 'fresh'], ['none', 'loose'], ['empty']]);
  });

  it('a newer subtask lifts its parent but stays under it', () => {
    const at = taskActivity([run('sub2', 99)], {});
    expect(titles(data, at)[0]).toEqual(['p1', 'parent', '↳sub2', '↳sub1', 'old']);
  });
});

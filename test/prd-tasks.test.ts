// Project › PRD › Task › Subtask: the v1 to v2 migration, PRD and split ops, tagging runs and criteria with a task.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { removeTempDirs, tempDir, useTempUserData } from './helpers';
import { addTask, assignTask, removeTask, validateTaskFile, type Task, type TaskData, type TaskOwner } from '../src/shared/tasks';
import { addPrd, editPrd, groupTasks, removePrd, setTaskPrd, siblingIndex, splitTask } from '../src/shared/task-groups';
import { prdOf, taskAt } from '../src/shared/test-scope';
import { forTask } from '../src/shared/repo-suite';
import { buildLoopBrief, parseCriteria } from '../src/shared/test-loop';
import { loadTasks, tasksFile, updateTasks } from '../src/main/tasks-store';
import { taskIdAt } from '../src/main/testing-tasks';

afterEach(removeTempDirs);

const me: TaskOwner = { sessionId: 's1', name: 'Cart work', branch: 'cart' };

// PRD "Checkout" holds a and b; b is split into b1 and b2; c is ungrouped.
function board(): TaskData {
  let tasks: Task[] = [];
  tasks = addTask(tasks, { title: 'Fix the cart total' }, 'a', 1);
  tasks = addTask(tasks, { title: 'Coupons' }, 'b', 2);
  tasks = addTask(tasks, { title: 'Docs' }, 'c', 3);
  const prds = addPrd([], { title: ' Checkout ', notes: 'Cart to payment' }, 'p1', 4);
  tasks = setTaskPrd({ tasks, prds }, 'a', 'p1');
  tasks = setTaskPrd({ tasks, prds }, 'b', 'p1');
  tasks = splitTask(tasks, 'b', ['Coupon API', ' ', 'Coupon UI'], ['b1', 'b2'], 5);
  return { tasks, prds };
}

describe('task file migration', () => {
  it('reads a version 1 file as tasks with no PRD and no parent', () => {
    const check = validateTaskFile({ version: 1, tasks: [{ id: 'a', title: 'A', prdId: 'ghost' }] });
    expect(check).toMatchObject({ ok: true, prds: [], tasks: [{ id: 'a', prdId: null, parentId: null }] });
  });

  it('reads version 2, dropping links that point nowhere; a subtask shares its parent’s PRD', () => {
    const check = validateTaskFile({
      version: 2,
      prds: [{ id: 'p1', title: 'Checkout' }, { id: 'p2', title: '' }],
      tasks: [
        { id: 'a', title: 'A', prdId: 'p1' },
        { id: 'a1', title: 'A1', parentId: 'a', prdId: 'p2' },
        { id: 'x', title: 'Orphan', parentId: 'gone', prdId: 'p9' },
        { id: 'deep', title: 'Too deep', parentId: 'a1' },
      ],
    });
    expect(check.ok && check.prds.map((p) => p.id)).toEqual(['p1']);
    expect(check.ok && check.tasks.map((t) => [t.id, t.prdId, t.parentId])).toEqual([['a', 'p1', null], ['a1', 'p1', 'a'], ['x', null, null], ['deep', null, null]]);
    expect(validateTaskFile({ version: 2, prds: [{ id: 'p', title: 'A' }, { id: 'p', title: 'B' }], tasks: [] }).ok).toBe(false);
    expect(validateTaskFile({ version: 3, tasks: [] }).ok).toBe(false);
  });

  it('loads a v1 file in memory and writes it back as v2 on the next change, PRDs kept', () => {
    useTempUserData();
    const repo = tempDir('petal-repo-');
    fs.mkdirSync(path.join(repo, '.git'));
    fs.mkdirSync(path.join(repo, '.petal'));
    const old = JSON.stringify({ version: 1, tasks: [{ id: 'a', title: 'Old task', status: 'open' }] });
    fs.writeFileSync(path.join(repo, '.petal', 'tasks.json'), old); // an older build's file in the repo: copied into Petal once
    expect(loadTasks(repo)).toMatchObject({ problem: null, prds: [], tasks: [{ id: 'a', prdId: null, parentId: null }] });
    updateTasks(repo, (tasks, data) => ({ tasks, prds: addPrd(data.prds, { title: 'Checkout' }, 'p1', 1) }));
    updateTasks(repo, (tasks, data) => ({ tasks: setTaskPrd(data, 'a', 'p1') })); // prds left out: kept
    const stored = JSON.parse(fs.readFileSync(tasksFile(repo), 'utf8'));
    expect(stored.version).toBe(2);
    expect(stored.prds.map((p: { id: string }) => p.id)).toEqual(['p1']);
    expect(stored.tasks[0]).toMatchObject({ id: 'a', prdId: 'p1', parentId: null });
    expect(fs.readFileSync(path.join(repo, '.petal', 'tasks.json'), 'utf8')).toBe(old); // the repo's copy untouched
  });
});

describe('PRDs and subtasks', () => {
  it('groups tasks under their PRD, subtasks nested, the rest ungrouped', () => {
    const groups = groupTasks(board());
    expect(groups.map((g) => [g.prd?.title ?? null, g.tasks.map((t) => [t.task.id, t.subtasks.map((s) => s.id)])])).toEqual([
      ['Checkout', [['a', []], ['b', ['b1', 'b2']]]],
      [null, [['c', []]]],
    ]);
  });

  it('splits only top-level tasks; subtasks start open, in the parent’s PRD, right after it', () => {
    const { tasks } = board();
    expect(tasks.map((t) => t.id)).toEqual(['a', 'b', 'b1', 'b2', 'c']);
    expect(tasks.find((t) => t.id === 'b1')).toMatchObject({ title: 'Coupon API', parentId: 'b', prdId: 'p1', status: 'open', owner: null });
    expect(() => splitTask(tasks, 'b1', ['x'], ['y'], 6)).toThrow(/split again/);
    expect(() => splitTask(tasks, 'c', [' '], ['y'], 6)).toThrow(/at least one/);
    expect(splitTask(tasks, 'b', ['Coupon docs'], ['b3'], 6).map((t) => t.id)).toEqual(['a', 'b', 'b1', 'b2', 'b3', 'c']);
  });

  it('moves a task between PRDs with its subtasks; a subtask can’t move alone', () => {
    const data = board();
    const moved = setTaskPrd(data, 'b', null);
    expect(moved.filter((t) => t.prdId === null).map((t) => t.id)).toEqual(['b', 'b1', 'b2', 'c']);
    expect(() => setTaskPrd(data, 'b1', null)).toThrow(/subtask/);
    expect(() => setTaskPrd(data, 'c', 'nope')).toThrow(/gone/);
  });

  it('edits and deletes a PRD; its tasks stay, ungrouped', () => {
    const data = board();
    expect(editPrd(data.prds, 'p1', { title: 'Checkout v2', notes: '' })[0]).toMatchObject({ title: 'Checkout v2', notes: '' });
    expect(() => addPrd([], { title: '  ' }, 'p', 1)).toThrow(/A PRD needs a title/);
    const after = removePrd(data, 'p1');
    expect(after.prds).toEqual([]);
    expect(after.tasks.every((t) => t.prdId === null)).toBe(true);
    expect(after.tasks).toHaveLength(5);
  });

  it('deleting a task takes its subtasks; each subtask keeps its own single owner', () => {
    const { tasks } = board();
    expect(removeTask(tasks, 'b').map((t) => t.id)).toEqual(['a', 'c']);
    const given = assignTask(tasks, 'b1', me, 10);
    expect('tasks' in given && given.tasks.find((t) => t.id === 'b1')?.owner?.sessionId).toBe('s1');
    const other = { sessionId: 's2', name: 'UI work', branch: null };
    const clash = 'tasks' in given ? assignTask(given.tasks, 'b1', other, 11) : null;
    expect(clash && 'confirm' in clash && clash.confirm).toMatch(/is with Cart work/);
  });

  it('up and down swap with the nearest sibling in the same group', () => {
    const { tasks } = board();
    expect(siblingIndex(tasks, 'a', 1)).toBe(1); // b, past nothing else in Checkout
    expect(siblingIndex(tasks, 'b', -1)).toBe(0);
    expect(siblingIndex(tasks, 'b', 1)).toBeNull(); // c is ungrouped
    expect(siblingIndex(tasks, 'b2', -1)).toBe(2);
    expect(siblingIndex(tasks, 'c', -1)).toBeNull();
  });
});

describe('tagging with the session’s task', () => {
  const held = (): Task[] => {
    const { tasks } = board();
    const one = assignTask(tasks, 'a', me, 100);
    if (!('tasks' in one)) throw new Error('assign failed');
    return one.tasks.map((t) => (t.id === 'a' ? { ...t, status: 'done' as const, doneAt: 200 } : t));
  };

  it('picks the task the session held at that moment', () => {
    const tasks = held();
    expect(taskAt(tasks, 's1', 150)?.id).toBe('a');
    expect(taskAt(tasks, 's1', 50)).toBeNull(); // before it was given
    expect(taskAt(tasks, 's1', 250)).toBeNull(); // after it was done
    expect(taskAt(tasks, 's2', 150)).toBeNull();
    expect(taskAt(tasks, null, 150)).toBeNull();
    const later = assignTask(tasks, 'b1', me, 300);
    expect('tasks' in later && taskAt(later.tasks, 's1', 400)?.id).toBe('b1');
  });

  it('reads the repo’s task file; none there tags nothing', () => {
    useTempUserData();
    const repo = tempDir('petal-repo-');
    fs.mkdirSync(path.join(repo, '.git'));
    expect(taskIdAt(repo, 's1', 150)).toBeNull();
    updateTasks(repo, () => ({ tasks: held(), prds: board().prds }));
    expect(taskIdAt(repo, 's1', 150)).toBe('a');
  });
});

describe('a task’s own records', () => {
  const runs = [{ id: 'r1', taskId: 'a' }, { id: 'r2', taskId: 'b1' }, { id: 'old' }, { id: 'r4', taskId: null }];

  it('a task shows only what is tagged with it; untagged records belong to no task', () => {
    expect(forTask(runs, 'a').map((r) => r.id)).toEqual(['r1']);
    expect(forTask(runs, 'b').map((r) => r.id)).toEqual([]);
    expect(forTask(runs, 'b1').map((r) => r.id)).toEqual(['r2']);
    expect(forTask(runs, null)).toEqual([]);
  });

  it('a subtask’s PRD comes from its task', () => {
    const { tasks } = board();
    expect(prdOf(tasks, tasks.find((t) => t.id === 'b2') ?? null)).toBe('p1');
    expect(prdOf(tasks, tasks.find((t) => t.id === 'c') ?? null)).toBeNull();
  });

  it('filters criteria lines by their task', () => {
    const criteria = parseCriteria('## Scenarios\n- [pass] cart rounds · test: src/cart.test.ts::rounds · round 1 · task: a\n- [fail] coupon stacks · round 2 · task: b1\n- [pass] old line · round 1\n## Bugs\n- [fixed] cent off · test: src/cart.test.ts::cent · round 1 · task: a\n');
    expect(criteria.malformed).toBe(0);
    expect(forTask(criteria.scenarios, 'a').map((s) => s.name)).toEqual(['cart rounds']);
    expect(forTask(criteria.scenarios, 'b1').map((s) => s.name)).toEqual(['coupon stacks']);
    expect(forTask(criteria.bugs, 'a').map((b) => b.name)).toEqual(['cent off']);
  });
});

describe('criteria lines with and without a task', () => {
  it('reads "task: id" in any position and still reads old lines', () => {
    const parsed = parseCriteria('## Scenarios\n- [pass] new line · task: t-1a2b · test: a.test.ts::x · round 3\n- [flaky] old line · test: b.test.ts · round 2\n- [pass] bad task · task: has spaces\n');
    expect(parsed.scenarios.map((s) => [s.name, s.taskId, s.round])).toEqual([['new line', 't-1a2b', 3], ['old line', null, 2]]);
    expect(parsed.malformed).toBe(1);
  });

  it('the loop brief asks for the ticket on every line only when it has one, never the task', () => {
    const base = { focus: 'cart', rounds: 2, stages: [{ id: 'unit', name: 'Unit', command: 'npm test' }], stack: [] };
    const tagged = buildLoopBrief({ ...base, taskId: 't-1a2b', ticket: 'AB#10427' });
    expect(tagged).toContain('- [status] name · test: path::test name · ticket: AB#10427 · level: regression');
    expect(tagged).toContain('Tag every line you add with "ticket: AB#10427"');
    expect(buildLoopBrief(base)).not.toContain('Tag every line');
    expect(tagged).not.toContain('task:');
    expect(tagged).not.toMatch(/[\u2014\u2013]/);
  });
});

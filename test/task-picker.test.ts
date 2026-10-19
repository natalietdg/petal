// The Testing task picker for a tab outside any project: recent projects' tasks grouped by PRD, suites marked.
import { describe, expect, it } from 'vitest';
import { addTask, type Task } from '../src/shared/tasks';
import { addPrd, setTaskPrd, splitTask } from '../src/shared/task-groups';
import { listedRoot, pickGroups, type ProjectTasks } from '../src/shared/task-testing';

// acme: PRD "Checkout" holds a, split into a1; b is ungrouped. a1 has a suite.
function acme(): ProjectTasks {
  let tasks: Task[] = [];
  tasks = addTask(tasks, { title: 'Cart total' }, 'a', 1);
  tasks = addTask(tasks, { title: 'Docs' }, 'b', 2);
  const prds = addPrd([], { title: 'Checkout' }, 'p1', 3);
  tasks = setTaskPrd({ tasks, prds }, 'a', 'p1');
  tasks = splitTask(tasks, 'a', ['Rounding'], ['a1'], 4);
  return { root: '/r/acme', name: 'acme', tasks, prds, suited: ['a1'] };
}

const empty: ProjectTasks = { root: '/r/empty', name: 'empty', tasks: [], prds: addPrd([], { title: 'Someday' }, 'p9', 1), suited: [] };

describe('pickGroups', () => {
  it('lists each PRD then No PRD per project, a subtask after its task, with suite marks', () => {
    expect(pickGroups([acme()])).toEqual([
      { root: '/r/acme', project: 'acme', prd: 'Checkout', tasks: [
        { id: 'a', title: 'Cart total', subtask: false, suite: false },
        { id: 'a1', title: 'Rounding', subtask: true, suite: true },
      ] },
      { root: '/r/acme', project: 'acme', prd: null, tasks: [{ id: 'b', title: 'Docs', subtask: false, suite: false }] },
    ]);
  });

  it('leaves out projects and PRDs with no tasks, keeping project order', () => {
    const second = { ...acme(), root: '/r/second', name: 'second' };
    const groups = pickGroups([empty, acme(), second]);
    expect(groups.map((g) => `${g.project}:${g.prd ?? '-'}`)).toEqual(['acme:Checkout', 'acme:-', 'second:Checkout', 'second:-']);
    expect(pickGroups([empty])).toEqual([]);
  });
});

describe('listedRoot', () => {
  const projects = [{ root: '/r/acme', name: 'acme' }, { root: '/r/notes', name: 'notes' }];

  it('keeps a root that is exactly one of the listed projects', () => {
    expect(listedRoot('/r/notes', projects)).toBe('/r/notes');
  });

  it('refuses anything else the renderer sends', () => {
    for (const root of ['/r/other', '/r/acme/', '/r/acme/src', '/r/../r/acme', '', null, undefined, 42, { root: '/r/acme' }]) expect(listedRoot(root, projects)).toBeNull();
    expect(listedRoot('/r/acme', [])).toBeNull();
  });
});

// The Testing tab's scope switch: This task · PRD · Whole project, with a line saying what is shown.
import { el } from './dom';
import { prdOf, SCOPE_WORDS, type TestScope } from '../shared/test-scope';
import type { Prd, Task } from '../shared/tasks';

export interface ScopeModel {
  scope: TestScope;
  taskId: string | null; // the task the session holds
  tasks: Task[];
  prds: Prd[];
  project: string;
}

const SCOPES: TestScope[] = ['task', 'prd', 'project'];

// What each scope shows, or why it can't be picked.
function scopeFacts({ taskId, tasks, prds, project }: ScopeModel): Record<TestScope, { label: string | null; why: string }> {
  const task = tasks.find((t) => t.id === taskId) ?? null;
  const prd = prds.find((p) => p.id === prdOf(tasks, task)) ?? null;
  return {
    task: { label: task?.title ?? null, why: 'This session holds no task. Give it one on the Board.' },
    prd: { label: prd?.title ?? null, why: task ? 'This task has no PRD. Add it to one on the Board.' : 'This session holds no task, so it has no PRD.' },
    project: { label: `${project} · every run, older untagged ones too`, why: '' },
  };
}

export function scopeBar(model: ScopeModel, pick: (scope: TestScope) => void): HTMLElement {
  const facts = scopeFacts(model);
  const bar = el('div', 'tst-scope');
  const group = el('div', 'tst-scope-group');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Show testing for');
  for (const scope of SCOPES) {
    const b = el('button', 'tst-scope-option', SCOPE_WORDS[scope]);
    b.type = 'button';
    b.dataset.scope = scope;
    b.setAttribute('aria-pressed', String(model.scope === scope));
    b.disabled = facts[scope].label === null;
    b.title = facts[scope].label ?? facts[scope].why;
    b.addEventListener('click', () => pick(scope));
    group.append(b);
  }
  bar.append(group, el('span', 'tst-scope-label', facts[model.scope].label ?? facts[model.scope].why));
  return bar;
}

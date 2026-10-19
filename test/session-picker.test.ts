// The Testing session picker for a tab outside any project: which sessions it lists, which one a pick may name, and each session's task.
import { describe, expect, it } from 'vitest';
import { addTask, assignTask, releaseTask, type Task } from '../src/shared/tasks';
import { listedSession, listedSessions, ownedTask, type SessionCandidate } from '../src/shared/task-testing';

const live = (sessionId: string, root: string | null, status: 'busy' | 'idle' = 'idle'): SessionCandidate => ({ sessionId, root, status });
const recent = (sessionId: string, root: string | null): SessionCandidate => ({ sessionId, root, status: 'closed' });

describe('listedSessions', () => {
  it('lists live sessions first, then recent ones, each in its given order', () => {
    const rows = listedSessions([live('a', '/r/acme', 'busy'), live('b', '/r/notes')], [recent('c', '/r/acme'), recent('d', '/r/notes')], 10);
    expect(rows.map((s) => `${s.sessionId}:${s.status}`)).toEqual(['a:busy', 'b:idle', 'c:closed', 'd:closed']);
  });

  it('leaves out sessions outside a repo and a recent one that is also live', () => {
    const rows = listedSessions([live('a', '/r/acme'), live('home', null)], [recent('a', '/r/acme'), recent('loose', null), recent('c', '/r/acme')], 10);
    expect(rows.map((s) => s.sessionId)).toEqual(['a', 'c']);
    expect(rows[0]?.status).toBe('idle');
  });

  it('stops at the cap, keeping live ones first', () => {
    expect(listedSessions([live('a', '/r'), live('b', '/r')], [recent('c', '/r')], 2).map((s) => s.sessionId)).toEqual(['a', 'b']);
    expect(listedSessions([], [], 5)).toEqual([]);
  });
});

describe('listedSession', () => {
  const listed = listedSessions([live('a', '/r/acme')], [recent('c', '/r/notes')], 10);

  it('takes only a session id the picker listed', () => {
    expect(listedSession(listed, 'c')?.root).toBe('/r/notes');
    expect(listedSession(listed, 'home')).toBeNull();
    expect(listedSession(listed, '')).toBeNull();
  });

  it('refuses anything that is not a session id string', () => {
    for (const bad of [null, undefined, 42, { sessionId: 'a' }, ['a'], '/r/acme']) expect(listedSession(listed, bad)).toBeNull();
  });
});

describe('ownedTask', () => {
  const owner = (sessionId: string) => ({ sessionId, name: sessionId, branch: null });
  const give = (tasks: Task[], id: string, sessionId: string, at: number): Task[] => {
    const result = assignTask(tasks, id, owner(sessionId), at);
    if (!('tasks' in result)) throw new Error('not given');
    return result.tasks;
  };
  const done = (tasks: Task[], id: string): Task[] => tasks.map((t) => (t.id === id ? { ...t, status: 'done', doneAt: 99 } : t));

  it('is null for a session that owns nothing', () => {
    const tasks = give(addTask([], { title: 'Cart' }, 't1', 1), 't1', 's1', 2);
    expect(ownedTask(tasks, 's2')).toBeNull();
    expect(ownedTask(releaseTask(tasks, 't1'), 's1')).toBeNull();
  });

  it('prefers the unfinished task given most recently', () => {
    let tasks = addTask(addTask(addTask([], { title: 'Old' }, 't1', 1), { title: 'New' }, 't2', 1), { title: 'Newest, done' }, 't3', 1);
    tasks = give(give(give(tasks, 't1', 's1', 2), 't2', 's1', 3), 't3', 's1', 4);
    expect(ownedTask(done(tasks, 't3'), 's1')?.id).toBe('t2');
  });

  it('falls back to its newest finished task rather than none', () => {
    let tasks = addTask(addTask([], { title: 'A' }, 't1', 1), { title: 'B' }, 't2', 1);
    tasks = done(done(give(give(tasks, 't1', 's1', 2), 't2', 's1', 5), 't1'), 't2');
    expect(ownedTask(tasks, 's1')?.id).toBe('t2');
  });
});

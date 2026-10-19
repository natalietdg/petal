// The Testing session picker for a tab outside any project: which sessions it lists, which one a pick may name, and each session's task.
import { describe, expect, it } from 'vitest';
import { addTask, assignTask, releaseTask, type Task } from '../src/shared/tasks';
import { foldAgents, listedSession, listedSessions, ownedTask, type AgentSession, type PickStatus, type SessionCandidate } from '../src/shared/task-testing';

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

  it('sorts by newest activity, live and recent mixed, a session listed twice keeping its newest time', () => {
    const at = (s: SessionCandidate, time: number | null): SessionCandidate => ({ ...s, at: time });
    const rows = listedSessions([at(live('a', '/r'), 10), at(live('b', '/r'), null)], [at(recent('c', '/r'), 30), at(recent('a', '/r'), 50), at(recent('d', '/r'), 20)], 10);
    expect(rows.map((s) => `${s.sessionId}:${s.status}`)).toEqual(['a:idle', 'c:closed', 'd:closed', 'b:idle']);
    expect(listedSessions([at(live('a', '/r'), 1)], [at(recent('c', '/r'), 2), at(recent('d', '/r'), 3)], 2).map((s) => s.sessionId)).toEqual(['d', 'c']);
  });
});

describe('foldAgents', () => {
  const row = (sessionId: string, taskId: string | null, status: PickStatus, at: number | null, root = '/r') => ({ sessionId, root, taskId, status, at });
  const agent = (sessionId: string, taskId: string, name = 'Testing agent', root = '/r'): AgentSession => ({ root, sessionId, taskId, name });

  it('leaves out every agent session and shows each one on its task owner with its status', () => {
    const rows = [row('owner', 't1', 'closed', 10), row('a1', null, 'busy', 5), row('a2', null, 'idle', 4), row('other', 't2', 'idle', 8)];
    const out = foldAgents(rows, [agent('a1', 't1'), agent('a2', 't1', 'Bug fix agent')], 20);
    expect(out.map((r) => r.sessionId)).toEqual(['owner', 'other']);
    expect(out[0]?.agents).toEqual([{ name: 'Testing agent', status: 'busy', count: 1 }, { name: 'Bug fix agent', status: 'idle', count: 1 }]);
    expect(out[1]?.agents).toEqual([]);
  });

  it('folds alike agents into a count, an unlisted one as closed', () => {
    const rows = [row('owner', 't1', 'closed', 10), row('a1', null, 'idle', 3), row('a2', null, 'idle', 2)];
    const out = foldAgents(rows, [agent('a1', 't1'), agent('a2', 't1'), agent('gone', 't1')], 20);
    expect(out).toHaveLength(1);
    expect(out[0]?.agents).toEqual([{ name: 'Testing agent', status: 'idle', count: 2 }, { name: 'Testing agent', status: 'closed', count: 1 }]);
  });

  it('moves an owner up to its newest agent activity', () => {
    const rows = [row('fresh', 't2', 'busy', 50), row('owner', 't1', 'closed', 10), row('a1', null, 'busy', 90)];
    const out = foldAgents(rows, [agent('a1', 't1')], 20);
    expect(out.map((r) => `${r.sessionId}:${r.at}`)).toEqual(['owner:90', 'fresh:50']);
  });

  it('caps after leaving agents out, and matches agents by repo', () => {
    const rows = [row('a1', null, 'busy', 9), row('a2', null, 'busy', 8), row('b', null, 'idle', 7), row('c', 't1', 'idle', 6, '/other'), row('d', null, 'idle', 5)];
    const out = foldAgents(rows, [agent('a1', 't1'), agent('a2', 't1')], 2);
    expect(out.map((r) => r.sessionId)).toEqual(['b', 'c']);
    expect(out[1]?.agents).toEqual([]);
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

// The Testing screen's agent registry: one open agent per role per task, agents found by session id only (a reused tab
// id never matches), the migration of records saved before main owned agents, and when an agent with no claude resumes.
import { BrowserWindow } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { removeTempDirs, tempDir, useTempUserData } from './helpers';
import {
  CLOSED_EVENT, agentBySession, agentState, claimRole, closeAgents, inFlightAgain, loopForFixer, migrateTesting, noEvents, openAgent, resumeWhen, terminalOf, withEvent,
} from '../src/shared/agent-loop';
import { agentOf, allAgents, loopsOf, testAgentsOf } from '../src/main/task-suites';
import { claimAgent } from '../src/main/test-agents';
import * as store from '../src/main/testing-store';
import type { QueuedBug } from '../src/shared/bug-queue';
import type { ProjectTesting, StoredLoop, TestAgent } from '../src/shared/testing';

vi.mock('../src/main/claude-launch', () => ({ claudeLaunch: async () => ({ command: 'claude', tip: null }) }));

afterEach(() => { removeTempDirs(); vi.restoreAllMocks(); });

const agent = (over: Partial<TestAgent> = {}): TestAgent => ({ sessionId: 's-1', taskId: 't1', role: 'tester', cwd: '/repo', startedAt: 1, closedAt: null, ...over });
const loop = (over: Partial<StoredLoop> = {}): StoredLoop => ({ kind: 'loop', testerSessionId: 's-t', fixerSessionId: 's-f', startedAt: 10, stoppedAt: null, queue: [], events: noEvents(), ...over });
const bug = (key: string, state: QueuedBug['state'], asked = false): QueuedBug => ({ key, name: key, test: null, state, since: 1, asked, testerRound: 1, rechecked: false });

describe('one open agent per role per task', () => {
  it('keeps the open agent and refuses a second', () => {
    const first = claimRole([], agent());
    expect(first.created).toBe(true);
    const second = claimRole(first.agents, agent({ sessionId: 's-2' }));
    expect(second.created).toBe(false);
    expect(second.agent.sessionId).toBe('s-1');
    expect(second.agents).toHaveLength(1);
  });

  it('lets the other role, another task, or a new one after Close agents join', () => {
    const one = claimRole([], agent()).agents;
    expect(claimRole(one, agent({ sessionId: 's-f', role: 'fixer' })).created).toBe(true);
    expect(claimRole(one, agent({ sessionId: 's-other', taskId: 't2' })).created).toBe(true);
    const closed = closeAgents(one, ['s-1'], 50);
    expect(openAgent(closed, 't1', 'tester')).toBeNull();
    expect(claimRole(closed, agent({ sessionId: 's-2' }))).toMatchObject({ created: true, agent: { sessionId: 's-2' } });
  });

  it('keeps only the newest closed agents, never an open one', () => {
    const many = Array.from({ length: 50 }, (_, i) => agent({ sessionId: `old-${i}`, closedAt: i + 1 }));
    const kept = closeAgents([...many, agent({ sessionId: 'open' })], [], 100);
    expect(kept.filter((a) => a.closedAt !== null)).toHaveLength(40);
    expect(kept.some((a) => a.sessionId === 'open')).toBe(true);
    expect(kept.some((a) => a.sessionId === 'old-0')).toBe(false);
  });

  it('is enforced in claimAgent: a second start for the role returns the open agent and writes nothing', async () => {
    useTempUserData();
    const root = tempDir();
    const fakeWindow = { isDestroyed: () => false, webContents: { id: 7, isDestroyed: () => false } };
    vi.spyOn(BrowserWindow, 'getAllWindows').mockReturnValue([fakeWindow] as unknown as BrowserWindow[]);
    const request = { taskId: 't1', taskTitle: 'Cart', role: 'tester' as const, brief: 'Draw up the suite.', preferred: null };
    const [a, b] = await Promise.all([claimAgent(root, request), claimAgent(root, request)]); // a double click
    expect([a, b].filter((c) => 'created' in c && c.created)).toHaveLength(1);
    const created = 'agent' in a ? a.agent.sessionId : '';
    expect('agent' in b && b.agent.sessionId).toBe(created);
    const again = await claimAgent(root, { ...request, brief: 'Another.' });
    expect(again).toMatchObject({ created: false, agent: { sessionId: created } });
    expect(testAgentsOf(root)).toHaveLength(1);
    expect(agentOf(root, created)).toEqual({ taskId: 't1', role: 'tester' }); // the lock and suite reader know it
  });

  it('needs a window only to start one, never to hand back the open one', async () => {
    useTempUserData();
    const root = tempDir();
    vi.spyOn(BrowserWindow, 'getAllWindows').mockReturnValue([]);
    const request = { taskId: 't1', taskTitle: 'Cart', role: 'fixer' as const, brief: 'Fix bugs.', preferred: null };
    expect(await claimAgent(root, request)).toEqual({ note: 'Open a Petal window first.' });
    expect(testAgentsOf(root)).toEqual([]);
  });

  it('a bug sent during a draft keeps the drafting agent as the loop’s testing agent', () => {
    const events = withEvent(noEvents(), 'tester', 'Started Quinn to draw up the suite', 5);
    const draft = loop({ kind: 'draft', testerSessionId: 's-t', fixerSessionId: null, events, approvedScenarios: ['adds an item'] });
    const agents = [agent({ sessionId: 's-t' })];
    expect(loopForFixer(draft, agents, 't1', 's-f', 20)).toEqual({ ...draft, kind: 'loop', fixerSessionId: 's-f', startedAt: 20 });
  });

  it('a bug sent with no open drafting agent starts a loop with the bug fix agent alone', () => {
    const draft = loop({ kind: 'draft', testerSessionId: 's-t', fixerSessionId: null });
    expect(loopForFixer(draft, [agent({ sessionId: 's-t', closedAt: 9 })], 't1', 's-f', 20).testerSessionId).toBeNull();
    expect(loopForFixer(loop({ stoppedAt: 15 }), [agent({ sessionId: 's-t' })], 't1', 's-f', 20).testerSessionId).toBeNull(); // a stopped loop isn't a draft
    expect(loopForFixer(undefined, [], 't1', 's-f', 20)).toMatchObject({ kind: 'loop', testerSessionId: null, fixerSessionId: 's-f', events: noEvents() });
  });
});

describe('found by session id only', () => {
  const terminals = [
    { contentsId: 1, tabId: 'm3', sessionId: 'her-main-session', busy: false }, // the id the agent's old terminal had before a restart
    { contentsId: 2, tabId: 'm9', sessionId: 's-t', busy: true },
  ];

  it('never takes a tab for the agent because its id matches an old one', () => {
    expect(terminalOf(terminals, 's-f')).toBeNull();
    expect(terminalOf(terminals.slice(0, 1), 's-t')).toBeNull();
  });

  it('finds the terminal whose claude reports its session, in any window', () => {
    expect(terminalOf(terminals, 's-t')).toMatchObject({ contentsId: 2, tabId: 'm9' });
  });

  it('looks records up by session, never by anything else', () => {
    const agents = [agent({ sessionId: 's-t' }), agent({ sessionId: 's-f', role: 'fixer' })];
    expect(agentBySession(agents, 's-f')?.role).toBe('fixer');
    expect(agentBySession(agents, 'm3')).toBeNull();
    expect(agentBySession(agents, null)).toBeNull();
  });

  it('reads its state from the record and its terminal', () => {
    expect(agentState(agent({ closedAt: 5 }), { running: { busy: true }, asking: false, starting: false })).toBe('closed');
    expect(agentState(agent(), { running: { busy: true }, asking: true, starting: false })).toBe('asking');
    expect(agentState(agent(), { running: { busy: true }, asking: false, starting: false })).toBe('working');
    expect(agentState(agent(), { running: { busy: false }, asking: false, starting: false })).toBe('idle');
    expect(agentState(agent(), { running: null, asking: false, starting: true })).toBe('starting');
    expect(agentState(agent(), { running: null, asking: false, starting: false })).toBe('ended');
  });
});

describe('migration of records from before main owned agents', () => {
  const legacy = (over: Partial<ProjectTesting> = {}): ProjectTesting => ({
    version: 1, root: '/repo', pipeline: null, runs: [],
    agents: { t1: [{ sessionId: 'old-1', role: 'tester' }, { sessionId: 's-t', role: 'tester' }, { sessionId: 's-f', role: 'fixer' }], t2: [{ sessionId: 's-d', role: 'tester' }], t3: [{ sessionId: 's-c', role: 'tester' }] },
    loops: {
      t1: { kind: 'loop', tester: { tabId: 'm3', sessionId: 's-t' }, fixer: { tabId: 'm4', sessionId: 's-f' }, startedAt: 10, stoppedAt: null, queue: [], events: noEvents() },
      t3: { kind: 'draft', tester: { tabId: 'm7', sessionId: 's-c' }, fixer: null, startedAt: 20, stoppedAt: 30, queue: [], events: withEvent(noEvents(), 'tester', CLOSED_EVENT, 30) },
    } as unknown as Record<string, StoredLoop>,
    ...over,
  });

  it('makes each loop’s agents ended agents, closed ones closed, and keeps loops by session id only', () => {
    const out = migrateTesting(legacy(), 99) as ProjectTesting;
    const bySession = Object.fromEntries((out.testAgents ?? []).map((a) => [a.sessionId, a]));
    expect(Object.keys(bySession).sort()).toEqual(['s-c', 's-d', 's-f', 's-t']);
    expect(bySession['s-t']).toEqual({ sessionId: 's-t', taskId: 't1', role: 'tester', cwd: '/repo', startedAt: 10, closedAt: null });
    expect(bySession['s-d']).toMatchObject({ taskId: 't2', closedAt: null }); // a draft rebuilt from its record
    expect(bySession['s-c']).toMatchObject({ closedAt: 30 }); // Close agents had ended it
    expect(out.loops?.t1).toEqual(loop());
    expect(JSON.stringify(out.loops)).not.toMatch(/tabId|"m\d"/);
    expect(out.agents).toEqual(legacy().agents); // retired sessions stay for the lock
  });

  it('runs once', () => {
    const out = migrateTesting(legacy(), 99) as ProjectTesting;
    expect(migrateTesting(out, 100)).toBeNull();
    expect(migrateTesting({ version: 1, root: '/repo', pipeline: null, runs: [] }, 1)).toBeNull(); // nothing to migrate, nothing written
  });

  it('folds in a loop an older Petal saved afterwards; its session wins over an older open agent', () => {
    const out = migrateTesting(legacy(), 99) as ProjectTesting;
    const later = { ...out, loops: { ...out.loops, t2: { kind: 'draft', tester: { tabId: 'm1', sessionId: 's-new' }, fixer: null, startedAt: 50, stoppedAt: null, queue: [], events: noEvents() } } } as unknown as ProjectTesting;
    const again = migrateTesting(later, 120) as ProjectTesting;
    expect(openAgent(again.testAgents ?? [], 't2', 'tester')?.sessionId).toBe('s-new');
    expect(agentBySession(again.testAgents ?? [], 's-d')?.closedAt).toBe(120);
  });

  it('happens on first read of the store, and the lock still recognises retired sessions', () => {
    useTempUserData();
    const root = tempDir();
    store.save(legacy({ root }));
    expect(loopsOf(root).t1).toEqual(loop());
    expect(store.load(root).testAgents?.length).toBe(4); // saved, so it runs once
    expect(agentOf(root, 'old-1')).toEqual({ taskId: 't1', role: 'tester' });
    expect(allAgents(root).map((a) => a.sessionId).sort()).toEqual(['old-1', 's-c', 's-d', 's-f', 's-t']);
    expect(testAgentsOf(root).find((a) => a.sessionId === 's-t')?.cwd).toBe(root);
  });
});

describe('when an agent with no claude comes back', () => {
  it('a running loop’s agents resume at launch; a draft or stopped loop’s on her message; a closed one never', () => {
    expect(resumeWhen(agent({ sessionId: 's-t' }), loop())).toBe('at-launch');
    expect(resumeWhen(agent({ sessionId: 's-f', role: 'fixer' }), loop())).toBe('at-launch');
    expect(resumeWhen(agent({ sessionId: 's-t' }), loop({ stoppedAt: 40 }))).toBe('on-message');
    expect(resumeWhen(agent({ sessionId: 's-t' }), loop({ kind: 'draft', fixerSessionId: null }))).toBe('on-message');
    expect(resumeWhen(agent({ sessionId: 's-other' }), loop())).toBe('on-message'); // not this loop's agent
    expect(resumeWhen(agent({ sessionId: 's-t' }), null)).toBe('on-message');
    expect(resumeWhen(agent({ sessionId: 's-t', closedAt: 5 }), loop())).toBe('never');
  });

  it('what was in flight to it when its claude died is sent again', () => {
    const queue = [bug('a', 'fixing'), bug('b', 'verify', true), bug('c', 'open'), bug('d', 'verified')];
    expect(inFlightAgain(queue, 'fixer').map((b) => [b.key, b.state, b.asked])).toEqual([['a', 'open', false], ['b', 'verify', true], ['c', 'open', false], ['d', 'verified', false]]);
    expect(inFlightAgain(queue, 'tester').map((b) => [b.key, b.state, b.asked])).toEqual([['a', 'fixing', false], ['b', 'verify', false], ['c', 'open', false], ['d', 'verified', false]]);
  });
});

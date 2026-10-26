// The testing agents' ledger and loops, per task: the agents' session ids, their saved loops and lanes. Kept in the
// testing store, outside the repo. The suite itself is the repo's (repo-suite-store.ts).
import * as store from './testing-store';
import type { AgentRecord, ProjectTesting, StoredLoop, TestAgent } from '../shared/testing';
import type { AgentRole } from '../shared/agent-names';
import { agentBySession, migrateTesting, sessionOf } from '../shared/agent-loop';

const MAX_AGENTS = 20; // per task, newest kept

// The project's testing store, with records from before main owned agents migrated once and saved.
export function testingData(root: string): ProjectTesting {
  const data = store.load(root);
  const migrated = migrateTesting(data, Date.now());
  if (!migrated) return data;
  store.save(migrated);
  return migrated;
}

const agentMap = (root: string): Record<string, AgentRecord[]> => store.load(root).agents ?? {};

// The ledger: every session Petal launched as this task's agent, oldest first. Retired ones stay for the lock.
export const agentsOf = (root: string, taskId: string): AgentRecord[] => agentMap(root)[taskId] ?? [];

// The Testing screen's agents for the project, open and closed.
export const testAgentsOf = (root: string): TestAgent[] => testingData(root).testAgents ?? [];

export function saveTestAgents(root: string, agents: TestAgent[]): void {
  store.save({ ...testingData(root), testAgents: agents });
}

// Every agent session of the project with its task and role: the ledger and the registry, each session once.
export function allAgents(root: string): { sessionId: string; role: AgentRole; taskId: string }[] {
  const data = testingData(root);
  const ledger = Object.entries(data.agents ?? {}).flatMap(([taskId, list]) => list.map((a) => ({ sessionId: a.sessionId, role: a.role, taskId })));
  const seen = new Set(ledger.map((a) => a.sessionId));
  const registry = (data.testAgents ?? []).filter((a) => !seen.has(a.sessionId)).map(({ sessionId, role, taskId }) => ({ sessionId, role, taskId }));
  return [...ledger, ...registry];
}

// The task and role of one of Petal's agent sessions; null for any other session.
export function agentOf(root: string, sessionId: string | null | undefined): { taskId: string; role: AgentRole } | null {
  if (!sessionId) return null;
  const found = allAgents(root).find((a) => a.sessionId === sessionId);
  return found ? { taskId: found.taskId, role: found.role } : null;
}

export const agentTaskOf = (root: string, sessionId: string | null | undefined): string | null => agentOf(root, sessionId)?.taskId ?? null;

export function rememberAgent(root: string, taskId: string, sessionId: string, role: AgentRole = 'tester'): void {
  const data = testingData(root);
  const kept = [...agentsOf(root, taskId).filter((a) => a.sessionId !== sessionId), { sessionId, role }].slice(-MAX_AGENTS);
  store.save({ ...data, agents: { ...(data.agents ?? {}), [taskId]: kept } });
}

// Each task's loop or draft.
export const loopsOf = (root: string): Record<string, StoredLoop> => testingData(root).loops ?? {};

// Saved only when its sessions are this task's registered agents in those roles; false otherwise.
export function saveLoop(root: string, taskId: string, loop: StoredLoop): boolean {
  const data = testingData(root);
  const fits = (role: AgentRole) => {
    const sessionId = sessionOf(loop, role);
    const agent = agentBySession(data.testAgents ?? [], sessionId);
    return !sessionId || (agent?.taskId === taskId && agent.role === role);
  };
  if (!fits('tester') || !fits('fixer')) return false;
  store.save({ ...data, loops: { ...(data.loops ?? {}), [taskId]: loop } });
  return true;
}

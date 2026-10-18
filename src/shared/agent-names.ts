// A task's two agents: the testing agent owns its tests and suite, the bug fix agent fixes app code. Names are hers to
// change per project and only cosmetic; what an agent may do always follows its role.
export type AgentRole = 'tester' | 'fixer';
export type AgentNames = Partial<Record<AgentRole, string>>;

export const DEFAULT_AGENT_NAMES: Record<AgentRole, string> = { tester: 'Testing agent', fixer: 'Bug fix agent' };
export const AGENT_NAME_MAX = 32;

// Trimmed, 1 to 32 characters, one line; empty resets to the default (null). Anything else is refused (undefined).
export function cleanAgentName(raw: unknown): string | null | undefined {
  if (typeof raw !== 'string') return undefined;
  const name = raw.trim();
  if (!name) return null;
  return name.length <= AGENT_NAME_MAX && !/[\r\n\0]/.test(name) ? name : undefined;
}

export const agentName = (names: AgentNames | undefined, role: AgentRole): string => {
  const name = cleanAgentName(names?.[role]);
  return name ?? DEFAULT_AGENT_NAMES[role];
};

// What its tab is called: "Testing agent · Fix the cart total".
export const agentTabTitle = (names: AgentNames | undefined, role: AgentRole, taskTitle: string): string => `${agentName(names, role)} · ${taskTitle}`;

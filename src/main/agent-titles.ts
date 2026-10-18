// Tab titles for the agents Petal starts for a task: "Testing agent · Fix the cart total", with her names for the roles.
// Kept in memory; Testing sets them again whenever it reads the project, so a rename or a restart catches up.
const titles = new Map<string, string>(); // session id -> title

export const setAgentTitle = (sessionId: string, title: string): void => { titles.set(sessionId, title); };
export const agentTitle = (sessionId: string): string | null => titles.get(sessionId) ?? null;

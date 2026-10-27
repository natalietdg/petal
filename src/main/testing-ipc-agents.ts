// Testing IPC for one agent: messaging it, opening its terminal, reading its log, naming its role, its notifications.
import { handle } from './ipc';
import { claudeFolderAllowed } from './claude-folder';
import { agentOf } from './task-suites';
import { readAgentLog } from './agent-log';
import * as history from './history';
import * as store from './testing-store';
import { agentView, herEvent, openAgentTerminal, repliesOf, sendToAgent } from './test-agents';
import { AGENT_NAME_MAX, agentName, cleanAgentName, type AgentRole } from '../shared/agent-names';
import { NO_TOKENS } from '../shared/token-usage';
import { agentAt, BRIEF_CAP, FOLDERS_OFF, NOT_AN_AGENT, type TestingIpcContext } from './testing-ipc-context';

const EVENT_MAX = 200; // a lane line Petal writes for a follow-up

export function registerAgentIpc({ sessions, rootOf, rootTarget, notify }: TestingIpcContext): void {
  // Her message to one agent from its lane, or Petal's follow-up with its own lane line.
  handle('testing:agent-send', async (event, { root: asked, sessionId, text, event: line }) => {
    const found = agentAt(asked, sessionId);
    if ('note' in found) return found;
    if (typeof text !== 'string' || !text.trim() || text.length > BRIEF_CAP) return { note: 'Type a message first.' };
    const name = agentName(store.load(found.root).agentNames ?? {}, found.agent.role);
    const words = typeof line === 'string' && line.trim() ? line.trim().slice(0, EVENT_MAX) : herEvent(name, text);
    return sendToAgent(found.root, found.agent, text.trim(), words, event.sender.id);
  });

  // Open terminal: an ended agent resumes into this window with no message. Also Back to lane for a popped-out one.
  handle('testing:agent-open', async (event, { root: asked, sessionId }) => {
    const found = agentAt(asked, sessionId);
    if ('note' in found) return found;
    const problem = await openAgentTerminal(found.root, found.agent, event.sender.id);
    return problem ? { note: problem } : { agent: agentView(found.root, found.agent, event.sender.id) };
  });

  // A loop notification from the renderer: only while no Petal window is focused.
  handle('testing:notify', (event, { title, body, tabId }) => {
    if (typeof title !== 'string' || typeof body !== 'string') return { shown: false };
    return { shown: notify({ title, body, tabId: typeof tabId === 'string' ? tabId : null }, event.sender.id) };
  });

  // An agent's action log, tokens and replies, from its transcript: the open terminal's log, else History's copy.
  handle('testing:agent-log', async (event, { tabId, root: picked, sessionId }) => {
    if (!claudeFolderAllowed()) return { note: FOLDERS_OFF };
    const root = await rootOf(event.sender.id, tabId, picked);
    if (!root || typeof sessionId !== 'string' || !agentOf(root, sessionId)) return { note: NOT_AN_AGENT };
    const open = [...sessions.values()].find((s) => s.feed.session?.sessionId === sessionId)?.feed.session?.transcript;
    const file = open ?? history.findRecord(sessionId)?.file;
    const replies = [...repliesOf(sessionId)];
    return file ? { ...(await readAgentLog(file, root)), replies } : { actions: [], tokens: NO_TOKENS, replies };
  });

  // Her name for an agent role, for every task in the project; empty puts the default back.
  handle('testing:agent-name', async (event, { tabId, root: picked, role, name }) => {
    const target = await rootTarget(event.sender.id, tabId, picked);
    if ('note' in target) return target;
    const clean = cleanAgentName(name);
    if (clean === undefined || (role !== 'tester' && role !== 'fixer')) return { note: `A name is 1 to ${AGENT_NAME_MAX} characters on one line.` };
    const data = store.load(target.root);
    const names = { ...(data.agentNames ?? {}) };
    if (clean === null) delete names[role as AgentRole]; else names[role as AgentRole] = clean;
    store.save({ ...data, agentNames: names });
    return { ok: true };
  });
}

// IPC for the Agents dropdown and panel: a session's subagents, and one followed live per window. Read only, never ~/.claude writes.
import path from 'node:path';
import type { WebContents } from 'electron';
import { handle, send } from './ipc';
import { AgentTimeline, agentFile, isAgentId, listAgents, type AgentsList } from './agents';
import * as sessionsMonitor from './sessions-monitor';
import { sessionTitleFor } from './session-title';
import { isSnapshotRun, panelFixture } from './snapshot-mode';
import { claudeFolderAllowed } from './claude-folder';
import type { SessionFile } from './claude-session';
import type { ActiveSession } from './tab-session';
import type { FollowedSession } from './reader-feed';

// A live session's subagents folder; snapshot runs swap in their scratch folder.
export const subagentsDirOf = (session: SessionFile): string => {
  const fixtureRoot = isSnapshotRun() ? panelFixture.subagentsRoot : null;
  return fixtureRoot ? path.join(fixtureRoot, session.sessionId) : sessionsMonitor.subagentsDir(session);
};

// Live sessions for the Sessions panel, her open limit and agents. A snapshot run sees only the harness's fixture sessions, never her real ones.
export const panelSessions = (): SessionFile[] => (isSnapshotRun() ? panelFixture.sessions ?? [] : sessionsMonitor.liveSessions());

// The reader's own session from its transcript path; any other from the live session files. None while reading is off.
export function agentsDir(sessionId: string, own: FollowedSession | null | undefined): string | null {
  if (!claudeFolderAllowed()) return null;
  if (own?.sessionId === sessionId) return path.join(path.dirname(own.transcript), sessionId, 'subagents');
  const session = panelSessions().find((s) => s.sessionId === sessionId);
  return session ? subagentsDirOf(session) : null;
}

const NONE: AgentsList = { agents: [], running: 0 };

// The reader's session agents, for the header chip and the list.
export async function ownAgents(own: FollowedSession | null | undefined): Promise<AgentsList> {
  const dir = own ? agentsDir(own.sessionId, own) : null;
  return dir ? listAgents(dir) : NONE;
}

const timelines = new Map<number, AgentTimeline>(); // by webContents id: only the agent on screen is followed

function stopTimeline(contents: WebContents): void {
  timelines.get(contents.id)?.stop();
  timelines.delete(contents.id);
}

export function registerAgentsIpc({ activeSession }: { activeSession: ActiveSession }): void {
  handle('agents:list', async (event, { sessionId }) => {
    const own = activeSession(event.sender.id)?.feed.session;
    const id = typeof sessionId === 'string' && sessionId ? sessionId : own?.sessionId ?? null;
    const dir = id ? agentsDir(id, own) : null;
    const sessionLabel = id ? sessionTitleFor(id, { cwd: id === own?.sessionId ? own.cwd : null }) : null;
    return { sessionId: id, sessionLabel, ...(dir ? await listAgents(dir) : NONE) };
  });

  handle('agents:open', async (event, { sessionId, agentId }) => {
    const contents = event.sender;
    stopTimeline(contents);
    const dir = typeof sessionId === 'string' ? agentsDir(sessionId, activeSession(contents.id)?.feed.session) : null;
    if (!dir || !isAgentId(agentId)) return { missing: true as const };
    const timeline = new AgentTimeline(agentFile(dir, agentId), (update) => {
      if (!contents.isDestroyed()) send(contents, 'agents:timeline', { agentId, ...update });
    });
    timelines.set(contents.id, timeline);
    contents.once('destroyed', () => stopTimeline(contents));
    return { agentId, ...(await timeline.start()) };
  });

  // The sessions tick's fallback, like TranscriptTail.poll: re-attaches a watcher a rename dropped.
  handle('agents:poll', (event) => {
    void timelines.get(event.sender.id)?.poll();
    return { ok: true as const };
  });

  handle('agents:close', (event) => {
    stopTimeline(event.sender);
    return { ok: true as const };
  });
}

// IPC for the Agents dropdown and panel: a session's subagents, and one followed live per window. Read only, never ~/.claude writes.
import path from 'node:path';
import type { WebContents } from 'electron';
import { handle, send } from './ipc';
import { AgentTimeline, agentFile, isAgentId, listAgents, type AgentsList } from './agents';
import * as sessionsMonitor from './sessions-monitor';
import { isSnapshotRun, panelFixture } from './snapshot-mode';
import type { SessionFile } from './claude-session';
import type { ActiveSession } from './tab-session';
import type { FollowedSession } from './reader-feed';

// A live session's subagents folder; snapshot runs swap in their scratch folder.
export const subagentsDirOf = (session: SessionFile): string => {
  const fixtureRoot = isSnapshotRun() ? panelFixture.subagentsRoot : null;
  return fixtureRoot ? path.join(fixtureRoot, session.sessionId) : sessionsMonitor.subagentsDir(session);
};

// The reader's own session from its transcript path; any other from the live session files.
export function agentsDir(sessionId: string, own: FollowedSession | null | undefined): string | null {
  if (own?.sessionId === sessionId) return path.join(path.dirname(own.transcript), sessionId, 'subagents');
  const live = (isSnapshotRun() && panelFixture.sessions) || sessionsMonitor.liveSessions();
  const session = live.find((s) => s.sessionId === sessionId);
  return session ? subagentsDirOf(session) : null;
}

const NONE: AgentsList = { agents: [], running: 0 };

// The reader's session agents, for the header chip and the list.
export function ownAgents(own: FollowedSession | null | undefined): AgentsList {
  const dir = own ? agentsDir(own.sessionId, own) : null;
  return dir ? listAgents(dir) : NONE;
}

const timelines = new Map<number, AgentTimeline>(); // by webContents id: only the agent on screen is followed

function stopTimeline(contents: WebContents): void {
  timelines.get(contents.id)?.stop();
  timelines.delete(contents.id);
}

export function registerAgentsIpc({ activeSession }: { activeSession: ActiveSession }): void {
  handle('agents:list', (event, { sessionId }) => {
    const own = activeSession(event.sender.id)?.feed.session;
    const id = typeof sessionId === 'string' && sessionId ? sessionId : own?.sessionId ?? null;
    const dir = id ? agentsDir(id, own) : null;
    return { sessionId: id, ...(dir ? listAgents(dir) : NONE) };
  });

  handle('agents:open', (event, { sessionId, agentId }) => {
    const contents = event.sender;
    stopTimeline(contents);
    const dir = typeof sessionId === 'string' ? agentsDir(sessionId, activeSession(contents.id)?.feed.session) : null;
    if (!dir || !isAgentId(agentId)) return { missing: true as const };
    const timeline = new AgentTimeline(agentFile(dir, agentId), (update) => {
      if (!contents.isDestroyed()) send(contents, 'agents:timeline', { agentId, ...update });
    });
    timelines.set(contents.id, timeline);
    contents.once('destroyed', () => stopTimeline(contents));
    return { agentId, ...timeline.start() };
  });

  // The sessions tick's fallback, like TranscriptTail.poll: re-attaches a watcher a rename dropped.
  handle('agents:poll', (event) => {
    timelines.get(event.sender.id)?.poll();
    return { ok: true as const };
  });

  handle('agents:close', (event) => {
    stopTimeline(event.sender);
    return { ok: true as const };
  });
}

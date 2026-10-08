// IPC for the Sessions panel: the live overview with her limit and recently closed list, and closing one session.
// Reopening goes through history:resume, so it opens or focuses a tab exactly like History does.
import path from 'node:path';
import * as sessionsMonitor from './sessions-monitor';
import * as closedStore from './closed-store';
import * as configStore from './config-store';
import * as history from './history';
import * as organizer from './session-organizer';
import { closeSession } from './session-close';
import { handle } from './ipc';
import { ownAgents, subagentsDirOf } from './agents-ipc';
import { isSnapshotRun, panelFixture } from './snapshot-mode';
import type { ActiveSession } from './tab-session';

// Organizer title, then the transcript's title, then the folder name.
export const closedTitle = (sessionId: string, cwd: string): string =>
  organizer.loadCached()[sessionId]?.title || history.findRecord(sessionId)?.title || path.basename(cwd) || cwd;

// Snapshot runs never signal anything: the close path runs up to the signal, then stops.
const snapshotTerminate = (): never => { throw new Error('Snapshot run: no signal sent.'); };

export function registerSessionsIpc({ activeSession }: { activeSession: ActiveSession }): void {
  handle('sessions:snapshot', (event, { detailed, expandedIds }) => {
    const live = (isSnapshotRun() && panelFixture.sessions) || sessionsMonitor.liveSessions();
    const own = activeSession(event.sender.id)?.feed.session;
    const base = sessionsMonitor.snapshot({ detailed, expandedIds, ownSessionId: own?.sessionId }, live, subagentsDirOf);
    const { maxOpen } = configStore.load().sessions;
    const { running, agents } = ownAgents(own);
    const here = { running, total: agents.length };
    if (!detailed) return { ...base, maxOpen, here };
    return {
      ...base,
      maxOpen,
      here,
      closed: closedStore.reopenable(live.map((s) => s.sessionId)).map((c) => ({ ...c, cwd: sessionsMonitor.shortCwd(c.cwd) })),
      oldestIdleId: sessionsMonitor.oldestIdle(live)?.sessionId ?? null,
    };
  });

  handle('sessions:close', async (_event, sessionId) => {
    const outcome = await closeSession(String(sessionId), isSnapshotRun() ? { terminate: snapshotTerminate } : {});
    if (!outcome.closed) return outcome;
    const { session } = outcome;
    try {
      closedStore.add({ sessionId: session.sessionId, title: closedTitle(session.sessionId, session.cwd), cwd: session.cwd, closedAt: Date.now() });
    } catch (error) {
      console.error('[petal] closed list not updated:', (error as Error).message); // it did close; say so
    }
    return { closed: true };
  });
}

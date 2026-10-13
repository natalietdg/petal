// IPC for the Sessions panel: the live overview with her limit and recently closed list, and closing one session.
// Reopening goes through history:resume, so it opens or focuses a tab exactly like History does.
import * as sessionsMonitor from './sessions-monitor';
import * as closedStore from './closed-store';
import * as configStore from './config-store';
import { sessionTitleFor } from './session-title';
import { closeSession } from './session-close';
import { handle } from './ipc';
import { ownAgents, panelSessions, subagentsDirOf } from './agents-ipc';
import { concludeCloses, isSnapshotRun } from './snapshot-mode';
import { boardDetails } from './sessions-board';
import type { ActiveSession } from './tab-session';

// Every row, open or recently closed, is named by the shared rule at list time, so a later title shows at once.
const nameOf = (s: { sessionId: string; cwd: string }): string => sessionTitleFor(s.sessionId, { cwd: s.cwd });

// Snapshot runs never signal anything: the close path runs up to the signal, then stops.
const snapshotTerminate = (): never => { throw new Error('Snapshot run: no signal sent.'); };

export function registerSessionsIpc({ activeSession }: { activeSession: ActiveSession }): void {
  handle('sessions:snapshot', async (event, { detailed, expandedIds, board }) => {
    const live = panelSessions();
    const own = activeSession(event.sender.id)?.feed.session;
    const base = sessionsMonitor.snapshot({ detailed, expandedIds, ownSessionId: own?.sessionId, nameOf }, live, subagentsDirOf);
    const { maxOpen } = configStore.load().sessions;
    const { running, agents } = ownAgents(own);
    const here = { running, total: agents.length };
    if (!detailed) return { ...base, maxOpen, here };
    const details = board ? await boardDetails(live) : null;
    return {
      ...base,
      rows: details ? base.rows?.map((row) => ({ ...row, board: details.get(row.sessionId) })) : base.rows,
      maxOpen,
      here,
      closed: closedStore.reopenable(live.map((s) => s.sessionId)).map((c) => ({ ...c, title: nameOf(c), cwd: sessionsMonitor.shortCwd(c.cwd) })),
      oldestIdleId: sessionsMonitor.oldestIdle(live)?.sessionId ?? null,
    };
  });

  handle('sessions:close', (_event, sessionId) => closeAndRemember(String(sessionId)));
}

// The Sessions panel's Close: stop that claude, then list it under Recently closed.
async function closeAndRemember(sessionId: string): Promise<{ closed: true } | { closed: false; note: string }> {
  const outcome = await closeSession(sessionId, isSnapshotRun() ? { terminate: snapshotTerminate } : {});
  if (!outcome.closed) return outcome;
  const { session } = outcome;
  try {
    closedStore.add({ sessionId: session.sessionId, title: nameOf(session), cwd: session.cwd, closedAt: Date.now() });
  } catch (error) {
    console.error('[petal] closed list not updated:', (error as Error).message); // it did close; say so
  }
  return { closed: true };
}

// Her answered "conclude" means she is done: the same Close, no confirm. The tab stays, showing the ended reader.
export async function closeConcluded(sessionId: string): Promise<void> {
  const record = isSnapshotRun() ? { sessionId, outcome: 'started' } : null;
  if (record) concludeCloses.push(record);
  try {
    const result = await closeAndRemember(sessionId);
    if (record) record.outcome = result.closed ? 'closed' : result.note;
  } catch (error) {
    if (record) record.outcome = (error as Error).message;
    console.error('[petal] closing the concluded session failed:', (error as Error).message);
  }
}

// IPC for the reader's PRs tab. The renderer names a session and a repo; main finds the repo's folder in that
// session's own log, so no folder or command ever comes from the renderer.
import { handle } from './ipc';
import { findSessionPrs, sessionPrsView } from './session-prs';
import { checkMainSafe } from './main-safe-run';
import { proposeDeployOrder } from './deploy-order-run';
import * as prNotes from './pr-notes-store';
import type { TabSessions } from './tab-session';

const VALID_ID = /^[\w-]{1,128}$/;
const NO_LOG = 'Petal can’t read this session’s log, so its PRs aren’t known.';

export function registerSessionPrsIpc({ sessions }: { sessions: TabSessions }): void {
  const found = async (sessionId: unknown) => {
    const prs = typeof sessionId === 'string' && VALID_ID.test(sessionId) ? await findSessionPrs(sessionId, sessions) : null;
    if (!prs) throw new Error(NO_LOG);
    return prs;
  };

  handle('prs:list', (_event, { sessionId }) => (typeof sessionId === 'string' && VALID_ID.test(sessionId) ? sessionPrsView(sessionId, sessions) : null));
  handle('prs:main-safe', async (_event, { sessionId, service }) => {
    const target = (await found(sessionId)).services.find((s) => s.key === service);
    if (!target) throw new Error('That repo has no PRs in this session.');
    return checkMainSafe(target);
  });
  handle('prs:deploy-order', async (_event, { sessionId }) => {
    const { prs, services } = await found(sessionId);
    return proposeDeployOrder(sessionId, prs, services);
  });
  handle('prs:notes-save', (_event, { sessionId, url, notes }) => prNotes.save(sessionId, url, notes));
}

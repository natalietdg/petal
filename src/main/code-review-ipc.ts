// IPC for Code review: the renderer names a tab or a session id, main finds the log (after the Claude folder gate) and runs the reviewer.
import { BrowserWindow } from 'electron';
import { handle, send } from './ipc';
import { claudeFolderAllowed } from './claude-folder';
import * as history from './history';
import { cancelRun, explain, sessionSummary, turnReview, type ReviewSession } from './code-review';
import { taskReview } from './code-review-task';
import type { ReviewSource } from '../shared/code-review';
import type { TabSessions } from './tab-session';

const FOLDER_OFF = 'Petal isn’t reading your Claude folder, so it can’t see what Claude changed.';

export function registerCodeReviewIpc({ sessions }: { sessions: TabSessions }): void {
  // A tab here first (its log may be a snapshot fixture), then History's record of the session.
  const bySessionId = (sessionId: string): ReviewSession | null => {
    for (const { feed } of sessions.values()) {
      const s = feed.session;
      if (s?.sessionId === sessionId) return { sessionId, transcript: s.transcript, cwd: s.cwd ?? null };
    }
    const record = history.findRecord(sessionId);
    return record ? { sessionId, transcript: record.file, cwd: record.cwd } : null;
  };
  const resolver = (contentsId: number) => (source: ReviewSource): ReviewSession | null => {
    if (!claudeFolderAllowed()) return null;
    if ('sessionId' in source) return typeof source.sessionId === 'string' ? bySessionId(source.sessionId) : null;
    const s = sessions.get(`${contentsId}:${String(source.tabId)}`)?.feed.session;
    return s ? { sessionId: s.sessionId, transcript: s.transcript, cwd: s.cwd ?? null } : null;
  };
  const found = (contentsId: number, source: ReviewSource): ReviewSession => {
    if (!claudeFolderAllowed()) throw new Error(FOLDER_OFF);
    const session = resolver(contentsId)(source);
    if (!session) throw new Error('No Claude session log for that yet.');
    return session;
  };
  const changed = (sessionId: string): void => { for (const win of BrowserWindow.getAllWindows()) send(win.webContents, 'code-review:changed', { sessionId }); };

  handle('code-review:summary', (event, { source }) => sessionSummary(found(event.sender.id, source)));
  handle('code-review:turn', (event, { source, turnId }) => turnReview(found(event.sender.id, source), String(turnId)));
  handle('code-review:task', (_event, { sessionId, taskId }) => {
    if (!claudeFolderAllowed()) throw new Error(FOLDER_OFF);
    return taskReview(String(sessionId), String(taskId), bySessionId);
  });
  handle('code-review:explain', (event, { targets }) => explain(Array.isArray(targets) ? targets : [], resolver(event.sender.id), changed));
  handle('code-review:cancel', () => { cancelRun(); return { ok: true as const }; });
}

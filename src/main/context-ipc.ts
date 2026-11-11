// The Related view's one read: what other sessions decided, left open and edited around this one.
import { handle } from './ipc';
import { claudeFolderAllowed } from './claude-folder';
import * as contextStore from './context-store';

export function registerContextIpc(): void {
  handle('context:related', (_event, { sessionId }) => {
    if (!claudeFolderAllowed()) return { error: 'Petal isn’t reading your Claude folder.' };
    return { related: contextStore.related(sessionId) };
  });
}

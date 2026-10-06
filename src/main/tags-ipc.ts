// IPC for her tag edits in History; each returns only { ok } and the view re-reads the list.
import * as tagsStore from './tags-store';
import { handle } from './ipc';

export function registerTagsIpc(): void {
  handle('history:tag-add', (_event, { sessionId, name }) => { tagsStore.addTag(sessionId, name); return { ok: true }; });
  handle('history:tag-remove', (_event, { sessionId, name }) => { tagsStore.removeTag(sessionId, name); return { ok: true }; });
  handle('history:tag-delete', (_event, { name }) => { tagsStore.deleteTag(name); return { ok: true }; });
  handle('history:tag-rename', (_event, { from, to }) => { tagsStore.renameTag(from, to); return { ok: true }; });
}

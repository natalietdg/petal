// IPC for the Library: list and read its notes (Petal's own folder), and gather from the active tab's session now.
// Gathering reads that session's log, so it asks the Claude folder gate first; listing and reading never touch ~/.claude.
import { BrowserWindow } from 'electron';
import { handle, send } from './ipc';
import { claudeFolderAllowed } from './claude-folder';
import * as configStore from './config-store';
import { listEntries, readDoc } from './library-store';
import { isRunning, onChange, queueSession } from './library-extract';
import type { TabSessions } from './tab-session';

export function registerLibraryIpc({ sessions }: { sessions: TabSessions }): void {
  handle('library:list', () => ({
    allowed: claudeFolderAllowed(),
    autoBuild: configStore.load().library.autoBuild,
    running: isRunning(),
    entries: listEntries(),
  }));

  handle('library:read', (_event, { slug }) => readDoc(slug));

  // The tab is looked up here; the renderer never names a log file.
  handle('library:add-session', async (event, { tabId }) => {
    if (!claudeFolderAllowed()) return { added: 0, updated: 0, skipped: 'Petal isn’t reading your Claude folder' };
    const session = [...sessions.values()].find((s) => s.contentsId === event.sender.id && s.tabId === tabId)?.feed.session;
    if (!session) return { added: 0, updated: 0, skipped: 'no Claude session in this tab' };
    return queueSession({ sessionId: session.sessionId, transcript: session.transcript }, { force: true });
  });

  onChange(() => { for (const win of BrowserWindow.getAllWindows()) send(win.webContents, 'library:changed'); });
}

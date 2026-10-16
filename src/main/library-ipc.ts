// IPC for the Library: list and read its notes (Petal's own folder), gather from a tab's session now, and read past sessions.
// Gathering reads that session's log, so it asks the Claude folder gate first; listing and reading never touch ~/.claude.
import fs from 'node:fs';
import { BrowserWindow } from 'electron';
import { handle, send } from './ipc';
import { claudeFolderAllowed } from './claude-folder';
import * as configStore from './config-store';
import { deleteNote, duplicates, keepBoth, listEntries, mergeNotes, readDoc, renameNote, restoreNote, setCategory } from './library-store';
import { isRunning, onChange, queueSession } from './library-extract';
import { backfillState, onBackfill, planBackfill, startBackfill, stopBackfill } from './library-backfill';
import { isBackfillDays } from '../shared/library';
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
    // Claude Code writes the log only after the first message, so a fresh session has none yet.
    if (!fs.existsSync(session.transcript)) return { added: 0, updated: 0, skipped: 'nothing said in this session yet' };
    return queueSession({ sessionId: session.sessionId, transcript: session.transcript }, { force: true });
  });

  // Reading past sessions: the range is checked here; the logs are found in main, never named by the page.
  handle('library:backfill-plan', (_event, { days }) => (isBackfillDays(days) ? planBackfill(days) : { skipped: 'unknown range' }));
  handle('library:backfill-start', (_event, { days }) => (isBackfillDays(days) ? startBackfill(days) : { skipped: 'unknown range' }));
  handle('library:backfill-stop', () => stopBackfill());
  handle('library:backfill-state', () => backfillState());
  // Her edits: every one tells the windows, so the dial redraws.
  const changed = <T>(result: T): T => { for (const win of BrowserWindow.getAllWindows()) send(win.webContents, 'library:changed'); return result; };
  handle('library:rename', (_event, { slug, title }) => changed(renameNote(slug, title)));
  handle('library:recategorize', (_event, { slug, category }) => changed(setCategory(slug, category)));
  handle('library:delete', (_event, { slug }) => changed(deleteNote(slug)));
  handle('library:restore', (_event, { trashId }) => changed(restoreNote(trashId)));
  handle('library:merge', (_event, { from, into }) => changed(mergeNotes(from, into)));
  handle('library:duplicates', () => duplicates());
  handle('library:keep-both', (_event, { a, b }) => keepBoth(a, b));

  onBackfill((state) => { for (const win of BrowserWindow.getAllWindows()) send(win.webContents, 'library:backfill', state); });

  onChange(() => { for (const win of BrowserWindow.getAllWindows()) send(win.webContents, 'library:changed'); });
}

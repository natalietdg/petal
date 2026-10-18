// IPC for the Library: list and read its notes (Petal's own folder), gather from a tab's session now, and read past sessions.
// Gathering reads that session's log, so it asks the Claude folder gate first; listing and reading never touch ~/.claude.
import fs from 'node:fs';
import { BrowserWindow } from 'electron';
import { handle, send } from './ipc';
import { claudeFolderAllowed } from './claude-folder';
import * as configStore from './config-store';
import { deleteNote, duplicates, keepBoth, listEntries, mergeNotes, readDoc, renameNote, restoreNote, setCategory } from './library-store';
import { isRunning, onChange, onLessons, queueSession } from './library-extract';
import { confirmAdd, dismissLesson, listLessons, mergeLessons, previewAdd } from './lessons-store';
import { isLessonScope } from '../shared/lessons';
import { backfillState, onBackfill, planBackfill, startBackfill, stopBackfill } from './library-backfill';
import { isBackfillDays } from '../shared/library';
import { lastRun, recordRun } from './library-cost-store';
import { estimateSessions } from './library-estimate';
import type { TabSessions } from './tab-session';

export function registerLibraryIpc({ sessions }: { sessions: TabSessions }): void {
  handle('library:list', () => ({
    allowed: claudeFolderAllowed(),
    autoBuild: configStore.load().library.autoBuild,
    running: isRunning(),
    entries: listEntries(),
    lastRun: lastRun(),
  }));

  handle('library:read', (_event, { slug }) => readDoc(slug));

  // A change (an edit, a new token count) tells the windows, so the page redraws.
  const changed = <T>(result: T): T => { for (const win of BrowserWindow.getAllWindows()) send(win.webContents, 'library:changed'); return result; };

  // The tab is looked up here; the renderer never names a log file.
  const tabLog = (contentsId: number, tabId: string): { session: { sessionId: string; transcript: string } } | { skipped: string } => {
    if (!claudeFolderAllowed()) return { skipped: 'Petal isn’t reading your Claude folder' };
    const session = [...sessions.values()].find((s) => s.contentsId === contentsId && s.tabId === tabId)?.feed.session;
    if (!session) return { skipped: 'no Claude session in this tab' };
    // Claude Code writes the log only after the first message, so a fresh session has none yet.
    if (!fs.existsSync(session.transcript)) return { skipped: 'nothing said in this session yet' };
    return { session: { sessionId: session.sessionId, transcript: session.transcript } };
  };
  handle('library:add-session', async (event, { tabId }) => {
    const found = tabLog(event.sender.id, tabId);
    if ('skipped' in found) return { added: 0, updated: 0, skipped: found.skipped };
    const result = await queueSession(found.session, { force: true });
    if (result.usage) changed(recordRun('add', 1, result.usage));
    return result;
  });
  // Add to Library's estimate, counted locally before she clicks; no Claude call.
  handle('library:add-estimate', (event, { tabId }) => {
    const found = tabLog(event.sender.id, tabId);
    return 'skipped' in found ? found : estimateSessions([found.session]);
  });

  // Reading past sessions: the range is checked here; the logs are found in main, never named by the page.
  handle('library:backfill-plan', (_event, { days }) => (isBackfillDays(days) ? planBackfill(days) : { skipped: 'unknown range' }));
  handle('library:backfill-start', (_event, { days }) => (isBackfillDays(days) ? startBackfill(days) : { skipped: 'unknown range' }));
  handle('library:backfill-stop', () => stopBackfill());
  handle('library:backfill-state', () => backfillState());
  // Her edits: every one tells the windows, so the dial redraws.
  handle('library:rename', (_event, { slug, title }) => changed(renameNote(slug, title)));
  handle('library:recategorize', (_event, { slug, category }) => changed(setCategory(slug, category)));
  handle('library:delete', (_event, { slug }) => changed(deleteNote(slug)));
  handle('library:restore', (_event, { trashId }) => changed(restoreNote(trashId)));
  handle('library:merge', (_event, { from, into }) => changed(mergeNotes(from, into)));
  handle('library:duplicates', () => duplicates());
  handle('library:keep-both', (_event, { a, b }) => keepBoth(a, b));

  // Lessons: every edit tells the windows; the CLAUDE.md write needs the preview's token (lessons-store.ts).
  const lessonsChanged = <T>(result: T): T => { for (const win of BrowserWindow.getAllWindows()) send(win.webContents, 'lessons:changed'); return result; };
  handle('lessons:list', () => listLessons());
  handle('lessons:dismiss', (_event, { id }) => lessonsChanged(dismissLesson(String(id))));
  handle('lessons:merge', (_event, { keep, fold }) => lessonsChanged(mergeLessons(String(keep), String(fold))));
  handle('lessons:preview', (_event, { id, target }) => (isLessonScope(target) ? previewAdd(String(id), target) : { error: 'unknown CLAUDE.md' }));
  handle('lessons:add', (_event, { token }) => lessonsChanged(confirmAdd(String(token))));
  onLessons(() => { for (const win of BrowserWindow.getAllWindows()) send(win.webContents, 'lessons:changed'); });

  onBackfill((state) => { for (const win of BrowserWindow.getAllWindows()) send(win.webContents, 'library:backfill', state); });

  onChange(() => { for (const win of BrowserWindow.getAllWindows()) send(win.webContents, 'library:changed'); });
}

// IPC for the History view: the session list, tidying, a past conversation, and opening a past session.
// Tags, flow and handoff have their own *-ipc.ts files; the resume command is built in resume-command.ts.
import { BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import * as history from './history';
import * as flowStore from './flow-store';
import * as organizer from './session-organizer';
import * as links from './links-store';
import * as tagsStore from './tags-store';
import * as notesStore from './notes-store';
import * as conclusions from './conclusions-store';
import { load as loadConfig } from './config-store';
import { handle, send } from './ipc';
import { buildResumeCommand } from './resume-command';
import { claudeLaunch } from './claude-launch';
import { historyFixture, isSnapshotRun } from './snapshot-mode';
import { guardsShell, harnessLine } from './snapshot-shell';
import { pageOfTurns, turnsFor } from './history-turns';
import { registerTagsIpc } from './tags-ipc';
import { registerFlowIpc } from './flow-ipc';
import { registerHandoffIpc } from './handoff-ipc';
import type { ActiveSession, OpenTab, TabSessions } from './tab-session';
import type { Theme } from '../shared/types';

interface HistoryIpcDeps {
  sessions: TabSessions;
  activeSession: ActiveSession;
  openTab: OpenTab;
  currentTheme: () => Theme;
}

// Every window's History re-lists, so a new conclusion shows without reopening it.
const announceConclusions = (): void => {
  for (const win of BrowserWindow.getAllWindows()) send(win.webContents, 'history:conclusions');
};

export function registerHistoryIpc({ sessions, activeSession, openTab, currentTheme }: HistoryIpcDeps): void {
  const own = (event: IpcMainInvokeEvent) => activeSession(event.sender.id); // the tab shown in the asking window

  handle('history:list', () => {
    const labels = organizer.load();
    const tags = tagsStore.load();
    const notes = notesStore.searchable();
    const listed = history.listSessions(new Set(loadConfig().history.favorites));
    void conclusions.refreshAll(listed, announceConclusions); // logs that grew are read in the background
    return {
      sessions: listed.map((s) => ({
        ...s,
        hasFlow: flowStore.has(s.sessionId),
        organizer: labels[s.sessionId] ?? null,
        tags: tags.sessions[s.sessionId]?.tags ?? [],
        notes: notes[s.sessionId] ?? '',
        conclusion: conclusions.stored(s.sessionId),
      })),
      tags: tags.tags, // { [name]: { color } }, for the filter bar and suggestions
      organizing: organizer.isRunning(),
    };
  });

  handle('history:past-summary', () => history.pastSessionsSummary());

  // Joins the pass already running, if any, and resolves when it ends.
  handle('history:tidy', () => organizer.runNow());

  handle('history:conversation', async (_event, { sessionId, before }) => {
    const record = history.findRecord(sessionId);
    if (!record) return { missing: true, turns: [], start: 0, total: 0 };
    return pageOfTurns(await turnsFor(record.file), before);
  });

  // The Petal tab already showing this session, in any window, if any.
  function tabShowing(sessionId: string): { win: BrowserWindow; tabId: string } | null {
    for (const { contentsId, tabId, feed } of sessions.values()) {
      if (feed.session?.sessionId !== sessionId) continue;
      const win = BrowserWindow.getAllWindows().find((w) => w.webContents.id === contentsId);
      if (win) return { win, tabId };
    }
    return null;
  }

  // Opening a past session: jump to its tab if open, resume here if this tab is free,
  // otherwise resume it in a new tab. Only ever types one `claude --resume` command.
  // A background resume (a reply from History) never switches tabs: it names the tab showing it, or opens one unshown.
  handle('history:resume', async (event, { sessionId, confirmFork, background = false }) => {
    const session = own(event);
    const record = history.findRecord(sessionId);
    if (!session || !record) return { note: 'That session is no longer on disk.' };
    if (!record.cwd) return { note: 'This session has no folder recorded, so it can’t be resumed here.' };

    const existing = tabShowing(sessionId);
    if (existing && background) {
      if (existing.win.webContents.id !== event.sender.id) return { note: 'This session is open in another Petal window. Reply there.' };
      return { ok: true, tabId: existing.tabId };
    }
    if (existing) {
      if (!isSnapshotRun()) {
        existing.win.show();
        existing.win.focus();
      }
      send(existing.win.webContents, 'tabs:activate', { tabId: existing.tabId });
      return { ok: true, focused: existing.win.webContents.id !== event.sender.id };
    }
    if (history.isLive(sessionId) && !confirmFork) {
      return { confirm: 'This session is still running in another terminal. Opening it here as well forks it.' };
    }
    links.addLink({ from: session.feed.session?.sessionId ?? null, to: sessionId, kind: confirmFork ? 'fork' : 'resume' });
    // Snapshot runs type a no-op instead, so no real session is ever resumed; only the live-Claude runs resume for real.
    const standIn = isSnapshotRun() && (background || guardsShell());
    const command = standIn ? harnessLine(': petal-resume') : buildResumeCommand(record.cwd, record.sessionId, (await claudeLaunch()).command); // the id from disk, not the renderer's string
    if (standIn) (background ? historyFixture.resumes : historyFixture.resumedHere).push(record.sessionId);
    if (background) {
      openTab(event.sender, { command, background: true });
      return { ok: true, newTab: true, command };
    }
    if (session.feed.claudePid) {
      openTab(event.sender, { command });
      return { ok: true, newTab: true, command };
    }
    session.pty.write(command);
    return { ok: true, command };
  });

  handle('notes:get', (_event, { sessionId }) => ({ text: notesStore.read(sessionId) }));
  handle('notes:save', (_event, { sessionId, text }) => notesStore.save(sessionId, text));

  registerTagsIpc();
  registerFlowIpc({ activeSession, currentTheme });
  registerHandoffIpc({ activeSession });
}

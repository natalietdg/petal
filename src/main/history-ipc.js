// IPC for the History view, the Outcome Flow and its Mermaid export.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { BrowserWindow, clipboard, dialog, ipcMain } = require('electron');
const history = require('./history');
const flowStore = require('./flow-store');
const organizer = require('./session-organizer');
const { writeHandoff } = require('./handoff');
const links = require('./links-store');
const tagsStore = require('./tags-store');

// POSIX single-quote escaping: the cwd can never break out of the quotes.
const shellQuote = (text) => `'${String(text).replace(/'/g, `'\\''`)}'`;
const slug = (text) => String(text || 'session').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'session';

function registerHistoryIpc({ sessions, activeSession, openTab, currentTheme }) {
  const own = (event) => activeSession(event.sender.id); // the tab shown in the asking window

  // target: { kind: 'current' } or { kind: 'history', sessionId }
  function resolveTarget(event, target) {
    if (target?.kind === 'history') {
      const record = history.findRecord(target.sessionId);
      return record ? { sessionId: record.sessionId, file: record.file, title: record.title, cwd: record.cwd } : null;
    }
    const session = own(event)?.feed.session;
    const file = session?.transcript;
    if (!file || !fs.existsSync(file)) return null;
    const sessionId = path.basename(file, '.jsonl');
    const record = history.findRecord(sessionId);
    return { sessionId, file, title: record?.title ?? 'current session', cwd: session.cwd ?? record?.cwd ?? null };
  }

  // Export always uses the stored chart source; nothing is re-parsed here.
  function mermaidFor(event, { target, all }) {
    const resolved = resolveTarget(event, target);
    const stored = resolved && flowStore.load(resolved.sessionId);
    if (!stored) return null;
    return { ...stored.mermaid[all ? 'all' : 'latest'], title: stored.title };
  }

  ipcMain.handle('history:list', () => {
    const labels = organizer.load();
    const tags = tagsStore.load();
    return {
      sessions: history.listSessions().map((s) => ({
        ...s,
        hasFlow: flowStore.has(s.sessionId),
        organizer: labels[s.sessionId] ?? null,
        tags: tags.sessions[s.sessionId]?.tags ?? [],
      })),
      tags: tags.tags, // { [name]: { color } }, for the filter bar and suggestions
      windowDays: history.WINDOW_DAYS,
      organizing: organizer.isRunning(),
    };
  });
  // One bad session must never blank the pane: failures come back as an inline message.
  const guarded = (name, handler) => ipcMain.handle(name, async (...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      console.error(`[petal] ${name} failed:`, error);
      return { error: error.message || String(error) };
    }
  });

  // Joins the pass already running, if any, and resolves when it ends.
  guarded('history:tidy', () => organizer.runNow());

  // Her tag edits; each returns only { ok } and the view re-reads the list.
  guarded('history:tag-add', (_event, { sessionId, name }) => { tagsStore.addTag(sessionId, name); return { ok: true }; });
  guarded('history:tag-remove', (_event, { sessionId, name }) => { tagsStore.removeTag(sessionId, name); return { ok: true }; });
  guarded('history:tag-delete', (_event, { name }) => { tagsStore.deleteTag(name); return { ok: true }; });
  guarded('history:tag-rename', (_event, { from, to }) => { tagsStore.renameTag(from, to); return { ok: true }; });

  guarded('history:preview', (_event, { sessionId }) => history.preview(sessionId));

  // Another session reads this one: write a clean copy, then type a "read this" line for her to finish.
  guarded('history:send', async (event, { sessionId }) => {
    const session = own(event);
    const record = history.findRecord(sessionId);
    if (!session || !record) return { note: 'That session is no longer on disk.' };
    if (!session.feed.claudePid) return { note: 'Start Claude in this tab first, then send.' };
    if (session.feed.session?.sessionId === sessionId) return { note: 'That is the session running here already.' };
    const { file, turns } = await writeHandoff(record);
    clipboard.writeText(file);
    session.pty.write(`Read "${file}", my earlier session "${record.title || 'Untitled'}" (${turns} turns). `);
    links.addLink({ from: sessionId, to: session.feed.session?.sessionId ?? null, kind: 'send' });
    return { ok: true, file };
  });

  // Never parses the jsonl: returns the stored flow, or { empty } so the view can offer "Create flow".
  guarded('flow:get', (event, { target }) => {
    const resolved = resolveTarget(event, target);
    if (!resolved) return null;
    const stored = flowStore.load(resolved.sessionId);
    if (!stored) return { empty: true, creating: flowStore.isCreating(resolved.sessionId) };
    return { ...stored, stale: flowStore.isStale(stored, resolved.file) };
  });

  guarded('flow:create', async (event, { target }) => {
    const resolved = resolveTarget(event, target);
    if (!resolved) return null;
    const stored = await flowStore.create({ ...resolved, transcriptFile: resolved.file, theme: currentTheme() });
    return { ...stored, stale: false };
  });

  ipcMain.handle('flow:mermaid', (event, options) => mermaidFor(event, options));

  ipcMain.handle('flow:copy-mermaid', async (event, options) => {
    const result = await mermaidFor(event, options);
    if (!result) return { ok: false };
    clipboard.writeText(result.source);
    return { ok: true };
  });

  ipcMain.handle('flow:save-mermaid', async (event, options) => {
    const result = await mermaidFor(event, options);
    if (!result) return { ok: false };
    const { canceled, filePath } = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
      defaultPath: path.join(os.homedir(), 'Downloads', `${slug(result.title)}.mmd`),
      filters: [{ name: 'Mermaid', extensions: ['mmd'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    fs.writeFileSync(filePath, result.source);
    return { ok: true, filePath };
  });

  // The Petal tab already showing this session, in any window, if any.
  function tabShowing(sessionId) {
    for (const { contentsId, tabId, feed } of sessions.values()) {
      if (feed.session?.sessionId !== sessionId) continue;
      const win = BrowserWindow.getAllWindows().find((w) => w.webContents.id === contentsId);
      if (win) return { win, tabId };
    }
    return null;
  }

  // Opening a past session: jump to its tab if open, resume here if this tab is free,
  // otherwise resume it in a new tab. Only ever types one `claude --resume` command.
  ipcMain.handle('history:resume', (event, { sessionId, confirmFork }) => {
    const session = own(event);
    const record = history.findRecord(sessionId);
    if (!session || !record) return { note: 'That session is no longer on disk.' };
    if (!record.cwd) return { note: 'This session has no folder recorded, so it can’t be resumed here.' };

    const existing = tabShowing(sessionId);
    if (existing) {
      existing.win.show();
      existing.win.focus();
      existing.win.webContents.send('tabs:activate', { tabId: existing.tabId });
      return { ok: true, focused: existing.win.webContents.id !== event.sender.id };
    }
    if (history.isLive(sessionId) && !confirmFork) {
      return { confirm: 'This session is still running in another terminal. Opening it here as well forks it.' };
    }
    const command = `cd ${shellQuote(record.cwd)} && claude --resume ${sessionId}\r`;
    links.addLink({ from: session.feed.session?.sessionId ?? null, to: sessionId, kind: confirmFork ? 'fork' : 'resume' });
    if (session.feed.claudePid) {
      openTab(event.sender, { command });
      return { ok: true, newTab: true, command };
    }
    session.pty.write(command);
    return { ok: true, command };
  });
}

module.exports = { registerHistoryIpc, shellQuote };

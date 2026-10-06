// IPC for the History view, the Outcome Flow and its Mermaid export.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BrowserWindow, clipboard, dialog, type IpcMainInvokeEvent } from 'electron';
import * as history from './history';
import * as flowStore from './flow-store';
import * as organizer from './session-organizer';
import { writeHandoff, readTurns, type Turn } from './handoff';
import * as links from './links-store';
import * as tagsStore from './tags-store';
import { handle, send } from './ipc';
import { buildResumeCommand } from './resume-command';
import type { ActiveSession, OpenTab, TabSessions } from './tab-session';
import type { FlowExportRequest, MermaidResult } from '../shared/ipc';
import type { FlowTarget, Theme } from '../shared/types';

interface ResolvedTarget {
  sessionId: string;
  file: string;
  title: string;
  cwd: string | null;
}

interface HistoryIpcDeps {
  sessions: TabSessions;
  activeSession: ActiveSession;
  openTab: OpenTab;
  currentTheme: () => Theme;
}

const slug = (text: unknown) => String(text || 'session').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'session';

export function registerHistoryIpc({ sessions, activeSession, openTab, currentTheme }: HistoryIpcDeps): void {
  const own = (event: IpcMainInvokeEvent) => activeSession(event.sender.id); // the tab shown in the asking window

  // target: { kind: 'current' } or { kind: 'history', sessionId }
  function resolveTarget(event: IpcMainInvokeEvent, target: FlowTarget | undefined): ResolvedTarget | null {
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
  function mermaidFor(event: IpcMainInvokeEvent, { target, all }: FlowExportRequest): MermaidResult | null {
    const resolved = resolveTarget(event, target);
    const stored = resolved && flowStore.load(resolved.sessionId);
    if (!stored) return null;
    return { ...stored.mermaid[all ? 'all' : 'latest'], title: stored.title };
  }

  handle('history:list', () => {
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

  // Joins the pass already running, if any, and resolves when it ends.
  handle('history:tidy', () => organizer.runNow());

  // Her tag edits; each returns only { ok } and the view re-reads the list.
  handle('history:tag-add', (_event, { sessionId, name }) => { tagsStore.addTag(sessionId, name); return { ok: true }; });
  handle('history:tag-remove', (_event, { sessionId, name }) => { tagsStore.removeTag(sessionId, name); return { ok: true }; });
  handle('history:tag-delete', (_event, { name }) => { tagsStore.deleteTag(name); return { ok: true }; });
  handle('history:tag-rename', (_event, { from, to }) => { tagsStore.renameTag(from, to); return { ok: true }; });

  handle('history:preview', (_event, { sessionId }) => history.preview(sessionId));

  // The whole conversation, a page at a time from the end: her prompts and Claude's replies, no tool noise.
  const TURNS_PER_PAGE = 30;
  const turnCache = new Map<string, { mtimeMs: number; turns: Turn[] }>(); // so "Show earlier" doesn't re-read the transcript
  async function turnsFor(file: string): Promise<Turn[]> {
    const { mtimeMs } = fs.statSync(file);
    const cached = turnCache.get(file);
    if (cached?.mtimeMs === mtimeMs) return cached.turns;
    const turns = await readTurns(file);
    turnCache.set(file, { mtimeMs, turns });
    return turns;
  }
  handle('history:conversation', async (_event, { sessionId, before }) => {
    const record = history.findRecord(sessionId);
    if (!record) return { missing: true, turns: [], start: 0, total: 0 };
    const turns = await turnsFor(record.file);
    const end = Math.min(before ?? turns.length, turns.length);
    const start = Math.max(0, end - TURNS_PER_PAGE);
    return {
      turns: turns.slice(start, end).map((turn, i) => ({ index: start + i, prompt: turn.prompt, reply: turn.reply.join('\n\n') })),
      start,
      total: turns.length,
    };
  });

  // Another session reads this one: write a clean copy, then type a "read this" line for her to finish.
  handle('history:send', async (event, { sessionId }) => {
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
  handle('flow:get', (event, { target }) => {
    const resolved = resolveTarget(event, target);
    if (!resolved) return null;
    const stored = flowStore.load(resolved.sessionId);
    if (!stored) return { empty: true, creating: flowStore.isCreating(resolved.sessionId) };
    return { ...stored, stale: flowStore.isStale(stored, resolved.file) };
  });

  handle('flow:create', async (event, { target }) => {
    const resolved = resolveTarget(event, target);
    if (!resolved) return null;
    const stored = await flowStore.create({ ...resolved, transcriptFile: resolved.file, theme: currentTheme() });
    return { ...stored, stale: false };
  });

  handle('flow:mermaid', (event, options) => mermaidFor(event, options));

  handle('flow:copy-mermaid', async (event, options) => {
    const result = mermaidFor(event, options);
    if (!result) return { ok: false };
    clipboard.writeText(result.source);
    return { ok: true };
  });

  handle('flow:save-mermaid', async (event, options) => {
    const result = mermaidFor(event, options);
    if (!result) return { ok: false };
    const win = BrowserWindow.fromWebContents(event.sender);
    const saveOptions = {
      defaultPath: path.join(os.homedir(), 'Downloads', `${slug(result.title)}.mmd`),
      filters: [{ name: 'Mermaid', extensions: ['mmd'] }],
    };
    const { canceled, filePath } = await (win ? dialog.showSaveDialog(win, saveOptions) : dialog.showSaveDialog(saveOptions));
    if (canceled || !filePath) return { ok: false, canceled: true };
    fs.writeFileSync(filePath, result.source);
    return { ok: true, filePath };
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
  handle('history:resume', (event, { sessionId, confirmFork }) => {
    const session = own(event);
    const record = history.findRecord(sessionId);
    if (!session || !record) return { note: 'That session is no longer on disk.' };
    if (!record.cwd) return { note: 'This session has no folder recorded, so it can’t be resumed here.' };

    const existing = tabShowing(sessionId);
    if (existing) {
      existing.win.show();
      existing.win.focus();
      send(existing.win.webContents, 'tabs:activate', { tabId: existing.tabId });
      return { ok: true, focused: existing.win.webContents.id !== event.sender.id };
    }
    if (history.isLive(sessionId) && !confirmFork) {
      return { confirm: 'This session is still running in another terminal. Opening it here as well forks it.' };
    }
    const command = buildResumeCommand(record.cwd, record.sessionId); // the id from disk, not the renderer's string
    links.addLink({ from: session.feed.session?.sessionId ?? null, to: sessionId, kind: confirmFork ? 'fork' : 'resume' });
    if (session.feed.claudePid) {
      openTab(event.sender, { command });
      return { ok: true, newTab: true, command };
    }
    session.pty.write(command);
    return { ok: true, command };
  });
}

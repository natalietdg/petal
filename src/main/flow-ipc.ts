// IPC for the Outcome Flow and its Mermaid export.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BrowserWindow, clipboard, dialog, type IpcMainInvokeEvent } from 'electron';
import * as history from './history';
import * as flowStore from './flow-store';
import { handle } from './ipc';
import type { ActiveSession } from './tab-session';
import type { FlowExportRequest, MermaidResult } from '../shared/ipc';
import type { FlowTarget, Theme } from '../shared/types';

interface ResolvedTarget {
  sessionId: string;
  file: string;
  title: string;
  cwd: string | null;
}

interface FlowIpcDeps {
  activeSession: ActiveSession;
  currentTheme: () => Theme;
}

const SLUG_CHARS = 60;
const slug = (text: unknown) => String(text || 'session').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, SLUG_CHARS) || 'session';

export function registerFlowIpc({ activeSession, currentTheme }: FlowIpcDeps): void {
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
}

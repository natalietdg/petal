// IPC for Workflow › Factory. The global factory sits in the Claude folder, so it waits for her consent;
// the project is the git repo of the active tab's Claude session, and the renderer can only name that one.
import { BrowserWindow } from 'electron';
import { handle, send } from './ipc';
import { tick } from './factory-jobs-watch';
import { allowedClaudeHome } from './claude-folder';
import { loadFactoryState, migrateSaved, saveFactory, useGlobal, type FactoryPaths } from './factory-store';
import { repoRoot } from './repo-label';
import { factoryFixture, isSnapshotRun } from './snapshot-mode';
import type { ActiveSession } from './tab-session';

const WATCH_MS = 2000;

// The factory a new job in this repo starts with: the project's own, else the global one.
export function factoryFor(repo: string) {
  const state = loadFactoryState({ claudeDir: isSnapshotRun() ? factoryFixture.claudeDir : allowedClaudeHome(), repo });
  return state.project?.factory ?? state.global.factory;
}

// Reads job files every two seconds; no tokens. Windows hear when any job moved.
export function startJobWatch(onChange: () => void = () => {}): () => void {
  const timer = setInterval(() => {
    let moved = 0;
    try { moved = tick({ factoryFor }).length; } catch (error) { console.warn('[petal] factory watch:', (error as Error).message); }
    if (!moved) return;
    for (const win of BrowserWindow.getAllWindows()) send(win.webContents, 'factory:jobs-changed');
    onChange();
  }, WATCH_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

export function registerFactoryIpc({ activeSession }: { activeSession: ActiveSession }): void {
  // Snapshot runs only ever touch the stand-in folders.
  const paths = (contentsId: number): FactoryPaths => {
    const home = allowedClaudeHome();
    if (isSnapshotRun()) return { claudeDir: home && factoryFixture.claudeDir, repo: factoryFixture.repo };
    return { claudeDir: home, repo: repoRoot(activeSession(contentsId)?.feed.session?.cwd) };
  };
  // A project write needs the repo she saw to still be the active one, so a tab switch mid-edit can't touch another project.
  const checked = (contentsId: number, scope: unknown, repo: unknown): FactoryPaths => {
    const current = paths(contentsId);
    if (scope === 'project' && (typeof repo !== 'string' || repo !== current.repo)) throw new Error('The active tab moved to another project. Reopen Factory and try again.');
    return current;
  };

  handle('factory:get', (event) => {
    const where = paths(event.sender.id);
    migrateSaved(where); // a version 1 checklist moves onto the spine once, its old file kept beside it
    return loadFactoryState(where);
  });
  handle('factory:save', (event, { scope, repo, factory }) => saveFactory(checked(event.sender.id, scope, repo), scope === 'project' ? 'project' : 'global', factory));
  handle('factory:use-global', (event, { repo }) => useGlobal(checked(event.sender.id, 'project', repo)));
}

// IPC for Workflow › Factory. The global factory sits in the Claude folder, so it waits for her consent;
// the project is the git repo of the active tab's Claude session, and the renderer can only name that one.
import { handle } from './ipc';
import { allowedClaudeHome } from './claude-folder';
import { loadFactoryState, saveFactory, useGlobal, type FactoryPaths } from './factory-store';
import { repoRoot } from './repo-label';
import { factoryFixture, isSnapshotRun } from './snapshot-mode';
import type { ActiveSession } from './tab-session';

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

  handle('factory:get', (event) => loadFactoryState(paths(event.sender.id)));
  handle('factory:save', (event, { scope, repo, factory }) => saveFactory(checked(event.sender.id, scope, repo), scope === 'project' ? 'project' : 'global', factory));
  handle('factory:use-global', (event, { repo }) => useGlobal(checked(event.sender.id, 'project', repo)));
}

// IPC for Open Repo: list the indexed repos, and jump a tab's shell into one of them.
import { handle } from './ipc';
import * as repoIndex from './repo-index';
import { isSnapshotRun, repoWrites } from './snapshot-mode';
import type { OpenTab, TabSessions } from './tab-session';

interface ReposIpcDeps {
  sessions: TabSessions;
  openTab: OpenTab;
}

export function registerReposIpc({ sessions, openTab }: ReposIpcDeps): void {
  const tabSession = (contentsId: number, tabId: string) =>
    [...sessions.values()].find((s) => s.contentsId === contentsId && s.tabId === tabId);
  // Same test as History's resume: a running claude process, not just a followed transcript.
  const claudeLive = (contentsId: number, tabId: string) => Boolean(tabSession(contentsId, tabId)?.feed.claudePid);

  handle('repos:list', (event, { tabId }) => {
    repoIndex.refreshIfStale();
    const index = repoIndex.current();
    return {
      repos: index?.repos ?? [],
      scannedAt: index?.scannedAt ?? null,
      scanning: repoIndex.isScanning(),
      claudeLive: claudeLive(event.sender.id, tabId),
    };
  });

  handle('repos:open', (event, { tabId, path }) => {
    const session = tabSession(event.sender.id, tabId);
    if (!session) return { note: 'That tab has closed.' };
    const plan = repoIndex.planRepoOpen(repoIndex.current(), path, claudeLive(event.sender.id, tabId));
    if ('note' in plan) return plan;
    if (isSnapshotRun()) repoWrites.push({ tabId, ...plan });
    else if (plan.newTab) openTab(event.sender, { command: plan.command });
    else session.pty.write(plan.command);
    return { ok: true as const, ...plan };
  });
}

// IPC for Open Repo: list the indexed repos, jump a tab's shell into one of them, or start a new claude in a chosen folder.
import path from 'node:path';
import { BrowserWindow, type WebContents } from 'electron';
import { handle } from './ipc';
import * as repoIndex from './repo-index';
import { claudeStarts, isSnapshotRun, repoWrites } from './snapshot-mode';
import { harnessLine } from './snapshot-shell';
import { pickFolder } from './pick-folder';
import { claudeLaunch } from './claude-launch';
import { claudeInstalled } from './tabs';
import { buildStartInCommand, shellQuote } from './resume-command';
import { agentsIn } from './workflow-setup';
import { allowedClaudeHome } from './claude-folder';
import type { OpenTab, TabSessions } from './tab-session';

interface ReposIpcDeps {
  sessions: TabSessions;
  openTab: OpenTab;
}

// Her own agents in ~/.claude/agents; none while reading the Claude folder is off.
function userAgents(): { name: string; description: string }[] {
  const home = allowedClaudeHome();
  return home ? agentsIn(path.join(home, 'agents')).map(({ name, description }) => ({ name, description })) : [];
}

// The folder a palette row names: a repo, home, or one she picks in a dialog; a note when there is none.
async function resolveFolder(sender: WebContents, target: unknown): Promise<{ cwd: string } | { note: string }> {
  const plan = repoIndex.planRepoStart(repoIndex.current(), target, repoIndex.scanRoot());
  if (plan !== 'pick') return plan;
  if (isSnapshotRun()) return { note: 'No folder chosen.' }; // no dialog can open in a snapshot run
  const cwd = await pickFolder(BrowserWindow.fromWebContents(sender));
  return cwd ? { cwd } : { note: 'No folder chosen.' };
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

  // Open Repo: the same rows as Add Session; a target (home, picked folder) cd's there like a repo does.
  handle('repos:open', async (event, { tabId, path, target }) => {
    if (!tabSession(event.sender.id, tabId)) return { note: 'That tab has closed.' };
    const folder = target === undefined ? null : await resolveFolder(event.sender, target);
    if (folder && 'note' in folder) return folder;
    const session = tabSession(event.sender.id, tabId); // again: the dialog may have outlived the tab
    if (!session) return { note: 'That tab has closed.' };
    const live = claudeLive(event.sender.id, tabId);
    const plan = folder ? { command: repoIndex.buildCdCommand(folder.cwd), newTab: live } : repoIndex.planRepoOpen(repoIndex.current(), path, live);
    if ('note' in plan) return plan;
    if (isSnapshotRun()) repoWrites.push({ tabId, ...plan });
    else if (plan.newTab) openTab(event.sender, { command: plan.command });
    else session.pty.write(plan.command);
    return { ok: true as const, ...plan };
  });

  // Add Session: a new tab whose shell cd's into the chosen folder and starts claude there, so home is never a silent default.
  handle('repos:agents', () => userAgents());

  handle('repos:start', async (event, { target, agent = null }) => {
    if (agent !== null && !userAgents().some((a) => a.name === agent)) return { note: `No agent named ${String(agent)} in ~/.claude/agents.` }; // never trust the renderer's name
    const folder = await resolveFolder(event.sender, target);
    if ('note' in folder) return folder;
    const { cwd } = folder;
    // Without Claude Code the new tab only enters the folder, so no "command not found" greets her.
    const installed = await claudeInstalled();
    const command = installed ? buildStartInCommand(cwd, (await claudeLaunch()).command, agent) : repoIndex.buildCdCommand(cwd);
    // Snapshot runs type a shell no-op in its place and record what would have been typed, so no real claude starts.
    // The no-op never contains the recorded line's text ("cd '…"), or the shell guard would count it as a leak.
    const standIn = harnessLine(`: ${installed ? 'petal-start-claude in' : 'petal-enter-folder'} ${shellQuote(cwd)}`);
    const newTab = openTab(event.sender, { command: isSnapshotRun() ? standIn : command });
    if (isSnapshotRun() && newTab && installed) claudeStarts.push({ tabId: newTab, command });
    return { ok: true as const };
  });
}

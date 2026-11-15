// IPC for Workflow › Factory. The global factory sits in the Claude folder, so it waits for her consent;
// the project is the git repo of the active tab's Claude session, and the renderer can only name that one.
import { BrowserWindow } from 'electron';
import { handle, send } from './ipc';
import path from 'node:path';
import { jobRepos, tick } from './factory-jobs-watch';
import { ensureRunners, jobAction, jobSignals, jobsView, markSeen, runnerProgress } from './factory-jobs-view';
import { listJobs, saveShipMode, writeJob } from './factory-jobs-store';
import { recordActivity } from './activity-feed';
import * as needsYouHub from './needs-you-hub';
import { openTab } from './tabs';
import { claudeLaunch } from './claude-launch';
import { buildStartInCommand, shellQuote } from './resume-command';
import { harnessLine } from './snapshot-shell';
import { JOB_ACTIONS, isFinished, isWaiting, stateLabel, type Job } from '../shared/factory-jobs';
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
    let moved: Job[] = [];
    try { moved = tick({ factoryFor, progressOf: runnerProgress }); } catch (error) { console.warn('[petal] factory watch:', (error as Error).message); }
    void ensureRunners().then((started) => { if (started.length) jobsMoved(started); }).catch((error: Error) => console.warn('[petal] factory runners:', error.message));
    jobsMoved(moved); // every tick: the lane also learns of jobs that appeared without moving (after a restart)
    if (moved.length) onChange();
  }, WATCH_MS);
  timer.unref?.();
  jobsMoved([]);
  return () => clearInterval(timer);
}

let shownJobs = ''; // what windows last heard about: every job's id, state and last write

// Windows re-read, the lane gets the waiting jobs, and the feed records each job that needs her or finished.
// Windows also re-read when jobs appear or change on disk without a move (after a restart, or a job removed).
function jobsMoved(moved: readonly Job[]): void {
  for (const job of moved) {
    if (!isWaiting(job.state) && !isFinished(job.state) && job.state !== 'stalled' && job.state !== 'spec') continue;
    recordActivity({ id: `job-${job.id}-${job.state}`, kind: 'job', sessionId: job.parentSessionId, sessionName: null, branch: job.branch, repo: path.basename(job.repo), text: `${job.title}: ${stateLabel(job)}` });
  }
  try { needsYouHub.setJobs(jobSignals()); } catch (error) { console.warn('[petal] factory lane:', (error as Error).message); }
  const key = JSON.stringify(jobRepos().flatMap((repo) => listJobs(repo).map((j) => [j.id, j.state, j.updatedAt])));
  if (!moved.length && key === shownJobs) return;
  shownJobs = key;
  for (const win of BrowserWindow.getAllWindows()) send(win.webContents, 'factory:jobs-changed');
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

  // Jobs: only repos Petal lists can be named, so a renderer can't point git at another folder.
  const activeRepo = (contentsId: number): string | null => paths(contentsId).repo;
  const known = (contentsId: number, repo: unknown): string => {
    const view = jobsView(activeRepo(contentsId));
    if (typeof repo !== 'string' || !view.repos.some((r) => r.repo === repo)) throw new Error('Petal doesn’t know that repo. Reopen Factory and try again.');
    return repo;
  };
  handle('factory:jobs', (event) => jobsView(activeRepo(event.sender.id)));
  handle('factory:job-action', async (event, { repo, id, action, note }) => {
    if (!JOB_ACTIONS.includes(action) || typeof id !== 'string' || !/^[a-z0-9-]{1,80}$/.test(id)) throw new Error('Unknown job action.');
    const result = await jobAction(known(event.sender.id, repo), id, action, typeof note === 'string' ? note : undefined);
    jobsMoved(result.job ? [result.job] : []);
    // Take over: the job's copy opens as an ordinary tab with Claude in it. Snapshot runs type a no-op instead.
    if (result.takeOver) openTab(event.sender, { command: isSnapshotRun() ? harnessLine(`: petal-take-over ${shellQuote(result.takeOver)}`) : buildStartInCommand(result.takeOver, (await claudeLaunch()).command, null) });
    return { takeOver: result.takeOver ?? null };
  });
  handle('factory:ship-mode', (event, { repo, mode }) => {
    const checkout = known(event.sender.id, repo);
    saveShipMode(checkout, mode);
    // Jobs that haven't reached Merge ship the new way; a job already merging keeps the mode it was checked against.
    for (const job of listJobs(checkout)) if (!isFinished(job.state) && job.state !== 'merging') writeJob({ ...job, shipMode: mode });
    return jobsView(activeRepo(event.sender.id));
  });
  handle('factory:seen', (event, { repo }) => { markSeen(known(event.sender.id, repo)); return jobsView(activeRepo(event.sender.id)); });
}

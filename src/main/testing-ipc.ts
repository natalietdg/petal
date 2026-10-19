// IPC for the Testing tab: what the active tab's project tests with, each task's suite and run history, and running it.
// A run is a script Petal writes under userData and types into a NEW tab after her click (never a tab with claude in it);
// main watches each stage's exit-code file and report. Reading the project and her skills waits for the folder gate.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { BrowserWindow, Notification, shell, webContents, type WebContents } from 'electron';
import { handle, send } from './ipc';
import { allowedClaudeHome, claudeFolderAllowed, projectClaudeDir } from './claude-folder';
import { isSnapshotRun, slashFixture, testingFixture } from './snapshot-mode';
import { harnessLine } from './snapshot-shell';
import { slashCatalog } from './slash-catalog';
import { detectStack, proposeStages, scriptsOf, testingSkills } from './testing-detect';
import { parseReport, parseText, keepOutput, shortenPaths, shortenText } from './testing-parse';
import { pipelineScript, readLogTail, runLine, stageFiles, trimmedNote, withReporter, type StagePlan } from './testing-runner';
import { claudeRun, scanLog, type ClaudeCall, type FileTouch, type SuiteWrite } from './testing-claude';
import { projectRootOf, ranIn, repoRoot, runProject } from './testing-project';
import * as history from './history';
import { sessionTitleFor } from './session-title';
import { NEW_SESSION } from '../shared/session-label';
import { readClaudePipeline } from './testing-claude-pipeline';
import { load as loadConfig } from './config-store';
import { agentOf, allAgents, loopsOf, saveLoop, settleOutsideChange, suiteFile, syncSuites, testAgentsOf, undoSuiteChange, writeSuite } from './task-suites';
import { setAgentTitle } from './agent-titles';
import { draftWithSkill } from './testing-skill';
import { readAgentLog } from './agent-log';
import { NO_TOKENS } from '../shared/token-usage';
import { dismissRestored, lockHookPresent, lockRefusals, loadManifest, refreshLock, resolveUnconfirmed, setLock, upgradeLock } from './test-lock';
import { AGENT_NAME_MAX, agentName, agentTabTitle, cleanAgentName, type AgentRole } from '../shared/agent-names';
import { agentView, claimAgent, closeTaskAgents, findAgent, herEvent, listedLoops, loopView, openAgentTerminal, repliesOf, sendToAgent, startTestAgents, stopTaskLoop, watchRoot, windowReady, type Claim } from './test-agents';
import { cleanSentBug, noEvents, openAgent, withEvent } from '../shared/agent-loop';
import { addSent } from '../shared/bug-queue';
import { buildSentFixerBrief, ITEMS_CAP, NAME_CAP } from '../shared/test-loop';
import { scenariosApprovedText } from '../shared/suite-draft';
import type { LoopNotice } from '../shared/loop-signals';
import type { LockManifest } from '../shared/test-lock';
import { checkSuite, emptySuite, isTaskId, suiteFor, type SuiteViews } from '../shared/task-suite';
import { foldAgents, listedSession, listedSessions, needsOwnTask, ownedTask, type AgentSession, type PickAgent, type PickSession, type SessionCandidate } from '../shared/task-testing';
import { lastRunAt, latest } from '../shared/task-activity';
import { panelSessions } from './agents-ipc';
import { giveSessionTask } from './tasks-ipc';
import { pruneProject } from './testing-prune';
import * as store from './testing-store';
import { criteriaFile, prepareLoop, readCriteria } from './criteria-store';
import {
  normalizeCommand, runGoing, runStateOf, unconfirmed, addCounts, emptyCounts,
  type Elsewhere, type LoopFacts, type LoopView, type StoredLoop, type TestAgent, type PipelineConfig, type PipelineRun, type RunReply, type StageConfig, type LockView, type StageResult, type SuiteSeed, type TestingState, NO_LOCK,
} from '../shared/testing';
import type { OpenTab, TabSession, TabSessions } from './tab-session';
import type { Reply } from '../shared/types';
import { recordActivity } from './activity-feed';
import { repoBranch } from './repo-label';
import { captureReplies, readDistillation } from './distillation-store';
import { loadTasks } from './tasks-store';
import type { Task } from '../shared/tasks';
import { scopeFacts, taskIdAt } from './testing-tasks';

const POLL_MS = 1000;
const GIVE_UP_MS = 3 * 60 * 60 * 1000; // a run with no end marker after 3 hours counts as stopped
const SNAPSHOT_STAND_IN = ': petal-test-run'; // typed in snapshot runs instead of the real line
const BRIEF_CAP = 12000;
const CHANGED_DAYS = 7; // Suite health's core stage counts files changed this recently
const CHANGED_CAP = 300;
const KNOWN_CAP = 50; // loops one window asks about per tick
const NAMES_CAP = 200; // scenario names approved in one go
const NOTICE_MAX = 200;
const EVENT_MAX = 200; // a lane line Petal writes for a follow-up

interface Watched { root: string; run: PipelineRun; stages: { config: StageConfig; plan: StagePlan; files: ReturnType<typeof stageFiles> }[]; done: string; started: number; timer: ReturnType<typeof setInterval> }
const watching = new Map<string, Watched>(); // run id -> its watch
const editsSeen = new Map<string, number>(); // transcript -> edits counted at the last auto check
const runTabs = new Map<string, string>(); // `${contentsId}:${tabId}` of a tab a run opened -> its project root
const notices = new Set<Notification>(); // held until clicked or closed, so the click still lands

// The repo's runs still going, and whether one blocks this task: one run at a time per task.
const runsGoing = (): { root: string; taskId: string | null }[] => [...watching.values()].map((w) => ({ root: w.root, taskId: w.run.taskId ?? null }));
const runningIn = (root: string): string[] => [...watching.values()].filter((w) => w.root === root).map((w) => w.run.id);

// ---- Which project: the tab's claude folder, else its shell's, walked up to the repo root.
const shellCwd = (pid: number): Promise<string | null> => new Promise((resolve) => {
  execFile('/usr/sbin/lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { timeout: 2000 }, (error, out) => {
    resolve(error ? null : /^n(.+)$/m.exec(out)?.[1] ?? null);
  });
});

export { repoRoot } from './testing-project';

async function cwdOf(session: TabSession): Promise<string | null> {
  if (isSnapshotRun() && testingFixture.project) return testingFixture.project;
  const ranHere = runTabs.get(`${session.contentsId}:${session.tabId}`); // a run's own tab belongs to its project
  if (ranHere) return ranHere;
  return session.feed.session?.cwd ?? (await shellCwd(session.pty.pid));
}

// The tab's project: the git repo its folder is in; null for the home folder or a folder outside a repo.
const projectOf = async (session: TabSession | undefined): Promise<string | null> => projectRootOf(session ? await cwdOf(session) : null);

// A project she picked in Testing (the tab is in ~); taken only when it is itself a repo root, else the tab's.
async function rootFor(session: TabSession | undefined, picked: unknown): Promise<string | null> {
  if (typeof picked === 'string' && projectRootOf(picked) === picked) return picked;
  return projectOf(session);
}

// ---- Reading the project: stack, skills, proposal.
// The Claude folder Testing reads (skills, recent sessions): the allowed one, or the run's stand-in in snapshot runs.
function testingClaudeDir(): string | null {
  const home = allowedClaudeHome();
  if (!home) return null;
  return (isSnapshotRun() && (testingFixture.claudeDir || slashFixture.claudeDir)) || home;
}

function skillsFor(root: string) {
  const claudeDir = testingClaudeDir();
  if (!claudeDir) return [];
  return testingSkills(slashCatalog({ claudeDir, projectDir: projectClaudeDir(root) }));
}

const defaultPipeline = (stages: StageConfig[]): PipelineConfig => ({ stages, keepGoing: false, autoRun: false, confirmed: [] });

// The project's commands from before suites were per task: Claude's .petal/pipeline.json, else the pipeline she saved.
export function projectSeed(root: string): SuiteSeed | null {
  const claude = readClaudePipeline(root);
  if (claude && 'stages' in claude) return { stages: claude.stages };
  const saved = store.load(root).pipeline?.stages ?? [];
  if (saved.length) return { stages: saved };
  return claude ? { problem: claude.problem } : null;
}

// What a Claude run on a task with no suite is matched against: the project's commands, else what detection suggests.
const fallbackStages = (root: string): StageConfig[] => {
  const seed = projectSeed(root);
  return seed && 'stages' in seed ? seed.stages : proposeStages(root, detectStack(root));
};

// Commands she confirmed once run without asking again; kept on this machine, never in the repo.
const confirmedOf = (root: string): string[] => store.load(root).pipeline?.confirmed ?? [];
function rememberConfirmed(root: string, stages: StageConfig[]): void {
  const pipeline = store.load(root).pipeline ?? defaultPipeline([]);
  store.savePipeline(root, { ...pipeline, confirmed: [...new Set([...pipeline.confirmed, ...stages.map((s) => normalizeCommand(s.command))])] });
}

// One session's log; cwd is Claude's folder, for a call without its own.
export interface SessionLog { transcript: string; sessionId: string; cwd: string | null }

interface LogFinds { found: { call: ClaudeCall; project: string | null }[]; writes: SuiteWrite[]; touches: FileTouch[] }

// Claude's calls in these logs, each with the project it ran in (its "cd", else Claude's folder then), and its suite file writes.
async function logCalls(logs: readonly SessionLog[]): Promise<LogFinds> {
  const finds: LogFinds = { found: [], writes: [], touches: [] };
  for (const log of logs) {
    const scan = await scanLog(log.transcript, log.sessionId);
    for (const call of scan.calls) finds.found.push({ call, project: projectRootOf(ranIn(call.command, call.cwd ?? log.cwd)) });
    finds.writes.push(...scan.suiteWrites);
    finds.touches.push(...scan.touches);
  }
  return finds;
}

// Every open session's log.
const openLogs = (sessions: TabSessions): SessionLog[] => [...sessions.values()].flatMap(({ feed }) => {
  const s = feed.session;
  return s?.transcript ? [{ transcript: s.transcript, sessionId: s.sessionId, cwd: (isSnapshotRun() && testingFixture.project) || s.cwd || null }] : [];
});

// Runs filed under the home folder before ~ stopped being a project; read only, each copied to the repo it ran in.
const homeRuns = (): PipelineRun[] => store.load(os.homedir()).runs.filter((r) => r.by === 'claude');

// A run from before prompts and durations were read: filled in once from its session's log, if it is still on disk.
const backfillTried = new Set<string>(); // sessionIds whose log was read for this
async function backfill(runs: PipelineRun[], sessions: TabSessions): Promise<PipelineRun[] | null> {
  const stale = runs.filter((r) => r.by === 'claude' && r.prompt === undefined && r.sessionId && !backfillTried.has(r.sessionId));
  if (!stale.length) return null;
  const open = new Map([...sessions.values()].flatMap(({ feed }) => (feed.session?.transcript ? [[feed.session.sessionId, feed.session.transcript] as const] : [])));
  const byId = new Map<string, ClaudeCall>();
  for (const sessionId of new Set(stale.map((r) => r.sessionId as string))) {
    backfillTried.add(sessionId);
    const file = open.get(sessionId) ?? history.findRecord(sessionId)?.file;
    if (file) for (const call of (await scanLog(file, sessionId)).calls) byId.set(`claude-${call.id}`, call);
  }
  return runs.map((run) => {
    if (!stale.includes(run)) return run;
    const call = byId.get(run.id);
    if (!call) return { ...run, prompt: '' };
    const wall = call.endAt > call.at ? call.endAt - call.at : null;
    return {
      ...run, startedAt: call.at, finishedAt: call.endAt, prompt: call.prompt, ...(call.cwd ? { cwd: call.cwd } : {}),
      stages: run.stages.map((stage) => ({ ...stage, durationMs: wall ?? stage.durationMs })),
    };
  });
}

// The Activity feed's words for a run's state.
const RUN_WORDS: Record<PipelineRun['state'], string> = { running: 'Tests running', passed: 'Tests passed', failed: 'Tests failed', stopped: 'Test run stopped' };

// The activity feed's line for a run; the same id as it moves from running to its result.
function recordRun(root: string, run: PipelineRun): void {
  const { passed, failed } = run.totals;
  const counts = run.state === 'running' ? '' : `: ${passed} passed${failed ? `, ${failed} failed` : ''}`;
  recordActivity({
    id: `test:${run.id}`, kind: 'test', at: run.finishedAt ?? run.startedAt,
    sessionId: run.sessionId ?? null, sessionName: run.sessionId ? sessionTitleFor(run.sessionId) : null, branch: repoBranch(root), repo: path.basename(root),
    text: `${RUN_WORDS[run.state]} in ${path.basename(root)}${counts}`, detail: run.stages.map((stage) => `${stage.name}: ${stage.status}`),
    target: { runId: run.id },
  });
}

// The logs of this project's agents whose tabs are closed: their suite writes and file touches still count.
async function closedAgentFinds(root: string, open: readonly SessionLog[]): Promise<LogFinds> {
  const seen = new Set(open.map((log) => log.sessionId));
  const logs = allAgents(root).map((a) => a.sessionId).filter((id) => !seen.has(id))
    .flatMap((id) => { const file = history.findRecord(id)?.file; return file ? [{ transcript: file, sessionId: id, cwd: root }] : []; });
  return logCalls(logs);
}

export interface ProjectChecks { suites: SuiteViews; lock: LockView }

// Claude's runs that ran in this project, from every open session and the old home-folder history, added once each.
// Then the tasks' suite files, so a change the testing agent just made shows, and the test lock's integrity check.
async function mergeClaudeRuns(root: string, sessions: TabSessions): Promise<ProjectChecks> {
  const { tasks } = loadTasks(root);
  if (!claudeFolderAllowed()) return { suites: syncSuites(root, tasks), lock: lockView(root, loadManifest(root)) };
  const { found, writes, manifest } = await lockFromLogs(root, sessions, tasks);
  const suites = syncSuites(root, tasks, writes);
  const names = store.load(root).agentNames;
  for (const agent of allAgents(root)) {
    const task = tasks.find((t) => t.id === agent.taskId);
    if (task) setAgentTitle(agent.sessionId, agentTabTitle(names, agent.role, task.title));
  }
  await saveClaudeRuns(root, found, tasks, suites, sessions);
  return { suites, lock: lockView(root, manifest) };
}

const lockView = (root: string, manifest: LockManifest): LockView => ({ enabled: manifest.enabled, hookPresent: lockHookPresent(root), restored: manifest.restored, refusals: lockRefusals(root, manifest) });

// Every open and closed agent log read, then the lock's integrity check with what they touched.
async function lockFromLogs(root: string, sessions: TabSessions, tasks: readonly Task[]): Promise<{ found: LogFinds['found']; writes: SuiteWrite[]; manifest: LockManifest }> {
  const logs = openLogs(sessions);
  const { found, writes, touches } = await logCalls(logs);
  const closed = await closedAgentFinds(root, logs);
  const inputs = { suiteTasks: tasks.map((t) => t.id).filter((id) => fs.existsSync(suiteFile(root, id))), criteria: readCriteria(root, tasks), agents: allAgents(root), touches: [...touches, ...closed.touches] };
  return { found, writes: [...writes, ...closed.writes], manifest: refreshLock(root, inputs, store.load(root).agentNames ?? {}) };
}

// ---- The lock keeps up with Testing closed: on a timer and after each Claude turn, for repos with the lock on.
const LOCK_TICK_MS = 10_000;
const lockBusy = new Set<string>(); // roots mid-refresh, so a slow read never stacks up

async function refreshRepoLock(root: string, sessions: TabSessions): Promise<void> {
  if (lockBusy.has(root) || !claudeFolderAllowed() || !loadManifest(root).enabled) return;
  lockBusy.add(root);
  try {
    upgradeLock(root);
    await lockFromLogs(root, sessions, loadTasks(root).tasks);
  } catch (error) {
    console.error(`[petal] test lock refresh failed for ${root}:`, error);
  } finally {
    lockBusy.delete(root);
  }
}

// The repos of open Claude sessions and run tabs.
function openRepos(sessions: TabSessions): Set<string> {
  const roots = new Set(runTabs.values());
  for (const { feed } of sessions.values()) {
    const root = projectRootOf(feed.session?.cwd ?? null);
    if (root) roots.add(root);
  }
  return roots;
}

function startLockTimer(sessions: TabSessions): void {
  setInterval(() => { for (const root of openRepos(sessions)) void refreshRepoLock(root, sessions); }, LOCK_TICK_MS).unref();
}

// After a Claude turn ends: its repo's lock catches up at once instead of on the next tick.
export async function refreshLockAfterTurn(session: TabSession): Promise<void> {
  if (!deps) return;
  const root = await projectOf(session);
  if (root) await refreshRepoLock(root, deps.sessions);
}

// Claude's runs in these logs that ran in this project, added once each; used for a concluded session's This session line.
export async function mergeLogRuns(root: string, logs: readonly SessionLog[]): Promise<void> {
  if (!claudeFolderAllowed()) return;
  const { tasks } = loadTasks(root);
  const { found, writes } = await logCalls(logs);
  await saveClaudeRuns(root, found, tasks, syncSuites(root, tasks, writes), new Map());
}

// The store is loaded after the logs are read, so a run saved meanwhile is never lost.
// A call lands on a stage of its task's suite; with no task or no suite, on the project's commands.
async function saveClaudeRuns(root: string, found: LogFinds['found'], tasks: Task[], suites: SuiteViews, sessions: TabSessions): Promise<void> {
  const calls = found.filter((c) => c.project === root).map((c) => c.call);
  const moved = root === os.homedir() ? [] : homeRuns().filter((run) => runProject(run) === root);
  const data = store.load(root);
  const known = new Set(data.runs.map((r) => r.id));
  const scripts = scriptsOf(root);
  let fallback: StageConfig[] | null = null;
  const stagesOf = (taskId: string | null): StageConfig[] => suiteFor(tasks, suites, taskId)?.suite.stages ?? (fallback ??= fallbackStages(root));
  const fresh = calls.filter((call) => !known.has(`claude-${call.id}`)).map((call) => {
    const taskId = taskIdAt(root, call.sessionId, call.at, tasks);
    return withTask(claudeRun(call, stagesOf(taskId), scripts, root), taskId);
  });
  fresh.forEach((run) => known.add(run.id));
  const copied: PipelineRun[] = [];
  for (const run of moved) if (!known.has(run.id)) { known.add(run.id); copied.push(run); } // the old file has a few ids twice
  const merged = [...fresh, ...copied, ...data.runs];
  const filled = await backfill(merged, sessions);
  if (fresh.length || copied.length || filled) store.save({ ...data, runs: filled ?? merged });
  for (const run of fresh) recordRun(root, run);
}

const withTask = (run: PipelineRun, taskId: string | null): PipelineRun => (taskId ? { ...run, taskId } : run);

// Each Claude run's session name, read fresh so a renamed session shows its new name.
const named = (runs: PipelineRun[]): PipelineRun[] => {
  const names = new Map<string, string>();
  return runs.map((run) => {
    if (run.by !== 'claude' || !run.sessionId) return run;
    if (!names.has(run.sessionId)) names.set(run.sessionId, sessionTitleFor(run.sessionId));
    const name = names.get(run.sessionId) ?? '';
    const placeholder = name.toLowerCase() === NEW_SESSION || name.endsWith(` · ${NEW_SESSION}`);
    return placeholder ? run : { ...run, sessionName: name };
  });
};

const PICK_MAX = 20;
type Candidate = SessionCandidate & { cwd: string | null };
type Pick = Candidate & { root: string; taskId: string | null; agents: PickAgent[] };

// Her Claude sessions in a repo, for a tab in ~ or outside a repo: the Sessions panel's live ones and History's recent ones.
// A task's agent sessions are folded into the row of the session owning it.
function sessionPicks(): Pick[] {
  const live = panelSessions().map((s): Candidate => ({ sessionId: s.sessionId, cwd: s.cwd, root: projectRootOf(s.cwd), status: s.status === 'busy' ? 'busy' : 'idle', at: s.updatedAt ?? null }));
  const recent = history.listSessions(new Set(), testingClaudeDir()).filter((r) => !r.live)
    .map((r): Candidate => ({ sessionId: r.sessionId, cwd: r.cwd, root: projectRootOf(r.cwd), status: 'closed', at: r.lastAt }));
  const rows = listedSessions(live, recent, Infinity).map(taskRunActivity());
  return foldAgents(rows, repoAgents(new Set(rows.map((r) => r.root))), PICK_MAX);
}

// Each repo's agent sessions with the names she gave its agents.
function repoAgents(roots: ReadonlySet<string>): AgentSession[] {
  return [...roots].flatMap((root) => {
    const names = store.load(root).agentNames;
    return allAgents(root).map((a) => ({ root, sessionId: a.sessionId, taskId: a.taskId, name: agentName(names, a.role) }));
  });
}

// A listed session's task, and its time moved up to that task's latest run; each repo's tasks and runs read once.
function taskRunActivity(): (c: Candidate & { root: string }) => Candidate & { root: string; taskId: string | null } {
  const byRoot = new Map<string, { tasks: Task[]; runAt: Map<string, number> }>();
  return (c) => {
    if (!byRoot.has(c.root)) byRoot.set(c.root, { tasks: loadTasks(c.root).tasks, runAt: lastRunAt(store.load(c.root).runs) });
    const repo = byRoot.get(c.root);
    const taskId = (repo && ownedTask(repo.tasks, c.sessionId)?.id) ?? null;
    return { ...c, taskId, at: latest(c.at, taskId ? repo?.runAt.get(taskId) : null) };
  };
}

async function elsewhereFor(session: TabSession | undefined): Promise<Elsewhere | null> {
  const cwd = session ? await cwdOf(session) : null;
  if (!cwd) return null;
  const rows = sessionPicks().map((s): PickSession => ({
    sessionId: s.sessionId, name: sessionTitleFor(s.sessionId, { cwd: s.cwd }), root: s.root, project: path.basename(s.root), status: s.status,
    suite: Boolean(s.taskId && fs.existsSync(suiteFile(s.root, s.taskId))), agents: s.agents,
  }));
  return { reason: path.resolve(cwd) === os.homedir() ? 'home' : 'no-repo', sessions: rows };
}

// A session she picked from that list: its repo, and its task, made for it now if it owns none. Only a listed session is taken.
function pickedSession(sessionId: unknown): { root: string; taskId: string } {
  const picked = listedSession(sessionPicks(), sessionId);
  if (!picked) throw new Error('That session isn’t one of your Claude sessions in a repo.');
  return { root: picked.root, taskId: picked.taskId ?? giveAutoTask(picked.root, { sessionId: picked.sessionId, cwd: picked.cwd }) };
}

// A task Testing made for a session, remembered as made here so an abandoned one can be pruned later.
function giveAutoTask(root: string, session: { sessionId: string; cwd: string | null }): string {
  const id = giveSessionTask(root, session);
  const data = store.load(root);
  store.save({ ...data, autoTasks: [...new Set([...(data.autoTasks ?? []), id])] });
  return id;
}

// This window's tab with her Claude session on the project: the asking tab first, else any other. Never an agent's.
async function sessionOnProject(root: string, sessions: TabSessions, asking: TabSession | undefined): Promise<TabSession | null> {
  const mine = [...sessions.values()].filter((s) => s.contentsId === asking?.contentsId && s.feed.session && !s.agent && !agentOf(root, s.feed.session.sessionId));
  const ordered = [...mine.filter((s) => s === asking), ...mine.filter((s) => s !== asking)];
  for (const s of ordered) if ((await projectOf(s)) === root) return s;
  return null;
}

// Files changed in the last week's commits plus uncommitted ones, repo-relative; none when git can't say.
function gitLines(root: string, args: string[]): Promise<string[]> {
  return new Promise((resolve) => {
    execFile('git', ['-C', root, ...args], { timeout: 3000, maxBuffer: 1 << 20 }, (error, out) => resolve(error ? [] : out.split('\n')));
  });
}

export async function recentlyChanged(root: string): Promise<string[]> {
  if (isSnapshotRun()) return testingFixture.changed ?? [];
  const [logged, status] = await Promise.all([
    gitLines(root, ['log', `--since=${CHANGED_DAYS}.days`, '--name-only', '--pretty=format:']),
    gitLines(root, ['status', '--porcelain']),
  ]);
  const files = [...logged, ...status.map((line) => line.slice(3).split(' -> ').pop() ?? '')].map((f) => f.trim()).filter(Boolean);
  return [...new Set(files)].slice(0, CHANGED_CAP);
}

// The loop's distillations from every open session on this project, stored before they are read back.
async function captureOpenDistillations(root: string, sessions: TabSessions): Promise<void> {
  for (const session of sessions.values()) {
    const replies = session.feed.shownReplies;
    if (!replies.length || (await projectOf(session)) !== root) continue;
    captureReplies(root, replies, session.feed.session?.sessionId ?? null);
  }
}

// After any Claude turn: its distillation, stored when the turn ran in a project with a test loop.
export function captureFinishedReply(reply: Reply, sessionId: string, cwd: string | null): void {
  if (!claudeFolderAllowed()) return;
  captureReplies(projectRootOf(isSnapshotRun() && testingFixture.project ? testingFixture.project : cwd), [reply], sessionId);
}

const giving = new Map<string, Promise<void>>(); // `${root}\0${sessionId}` -> its task being made; a quick refresh waits on it

// Every Claude session in the repo owning no task there gets its own, so Testing opens on its suite and its runs file
// under it; never a shell tab without Claude or one of Petal's agent sessions.
async function giveTabTask(root: string, asking: TabSession | undefined): Promise<void> {
  const session = asking?.feed.session;
  if (!session?.sessionId) return;
  const key = `${root}\0${session.sessionId}`;
  const pending = giving.get(key) ?? (async () => {
    if ((await projectOf(asking)) !== root) return;
    const { tasks, problem } = loadTasks(root);
    if (problem || !needsOwnTask({ tasks, sessionId: session.sessionId, isAgent: agentOf(root, session.sessionId) !== null })) return;
    giveAutoTask(root, { sessionId: session.sessionId, cwd: session.cwd ?? null });
  })().finally(() => giving.delete(key));
  giving.set(key, pending);
  await pending;
}

// The Claude sessions open now: the Sessions panel's live ones and every tab's.
const openSessionIds = (sessions: TabSessions): Set<string> =>
  new Set([...panelSessions().map((s) => s.sessionId), ...[...sessions.values()].flatMap((s) => (s.feed.session ? [s.feed.session.sessionId] : []))]);

async function stateFor(root: string, sessions: TabSessions, onProject: TabSession | null): Promise<TestingState> {
  const stack = [...detectStack(root), ...skillsFor(root)];
  const { suites, lock } = await mergeClaudeRuns(root, sessions);
  const data = store.load(root);
  const running = runningIn(root);
  return {
    allowed: true, project: { root, name: path.basename(root) }, elsewhere: null, stack, proposed: proposeStages(root, stack), seed: projectSeed(root), suites, lock, agentNames: data.agentNames ?? {}, runs: named(data.runs), running,
    sessionTab: onProject?.tabId ?? null, changed: await recentlyChanged(root), ...scopeFacts(root, onProject?.feed.session?.sessionId ?? null),
  };
}

// ---- Watching a run: each stage's exit file, then its report or log.
function finishStage(w: Watched, i: number, exitCode: number): StageResult {
  const { plan, files } = w.stages[i];
  let parsed = null;
  try {
    if (plan.report && fs.existsSync(plan.report.file)) parsed = parseReport(plan.report.kind, fs.readFileSync(plan.report.file, 'utf8'), w.root, plan.runner);
  } catch (error) {
    console.warn('[petal] test report unreadable, reading the log instead:', error);
  }
  const tail = readLogTail(files.log); // a huge log is read from its end only
  const log = tail.text;
  parsed = shortenPaths(parsed ?? parseText(log, plan.runner), w.root);
  const failed = exitCode !== 0 || parsed.counts.failed > 0;
  const began = fs.existsSync(files.log) ? fs.statSync(files.log).birthtimeMs : w.started;
  const ended = fs.statSync(files.exit).mtimeMs;
  return {
    ...w.run.stages[i], status: failed ? 'failed' : 'passed', exitCode, counts: parsed.counts, tests: parsed.tests,
    durationMs: parsed.durationMs ?? Math.max(0, Math.round(ended - began)), output: failed ? `${tail.trimmed ? `${trimmedNote()}\n` : ''}${shortenText(keepOutput(log), w.root)}` : '', runner: parsed.runner ?? plan.runner,
  };
}

function tick(w: Watched): void {
  let changed = false;
  const stages = [...w.run.stages];
  for (let i = 0; i < stages.length; i += 1) {
    const stage = stages[i];
    if (stage.status !== 'waiting' && stage.status !== 'running') continue;
    const { exit, log } = w.stages[i].files;
    if (fs.existsSync(exit)) {
      stages[i] = finishStage({ ...w, run: { ...w.run, stages } }, i, Number(fs.readFileSync(exit, 'utf8').trim() || 1));
      changed = true;
    } else if (stage.status === 'waiting' && fs.existsSync(log)) {
      stages[i] = { ...stage, status: 'running' };
      changed = true;
    }
  }
  const ended = fs.existsSync(w.done);
  const late = Date.now() - w.started > GIVE_UP_MS;
  if (ended || late) {
    for (let i = 0; i < stages.length; i += 1) {
      if (stages[i].status === 'waiting') { stages[i] = { ...stages[i], status: ended ? 'skipped' : 'stopped' }; changed = true; }
      if (stages[i].status === 'running') { stages[i] = { ...stages[i], status: 'stopped' }; changed = true; }
    }
  }
  if (!changed && !ended && !late) return;
  w.run = { ...w.run, stages, totals: stages.reduce((sum, s) => addCounts(sum, s.counts), emptyCounts()), state: runStateOf(stages) };
  if (ended || late) {
    w.run.finishedAt = Date.now();
    clearInterval(w.timer);
    watching.delete(w.run.id);
  }
  store.putRun(w.root, w.run);
  recordRun(w.root, w.run);
  for (const win of BrowserWindow.getAllWindows()) send(win.webContents, 'testing:run-update', { root: w.root, run: w.run });
}

// Writes the script, opens a new tab that runs it, and starts watching. Snapshot runs record the line instead.
function startRun(root: string, stages: StageConfig[], keepGoing: boolean, contents: WebContents, openTab: OpenTab, trigger: PipelineRun['trigger'], taskId: string | null): { started: string; typed: string } {
  const id = `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const dir = path.join(store.runsDir(root), id);
  fs.mkdirSync(dir, { recursive: true });
  const scripts = scriptsOf(root);
  const planned = stages.map((config, i) => {
    const files = stageFiles(dir, i);
    return { config, files, plan: withReporter(config.command, scripts, files.base, files.log) };
  });
  const script = path.join(dir, 'pipeline.sh');
  const done = path.join(dir, 'done');
  fs.writeFileSync(script, pipelineScript({ root, keepGoing, done, stages: planned.map(({ config, plan, files }) => ({ name: config.name, command: config.command, exec: plan.exec, log: files.log, exit: files.exit })) }));
  const typed = runLine(script);
  const run: PipelineRun = withTask({
    id, by: 'you', trigger, startedAt: Date.now(), finishedAt: null, state: 'running', totals: emptyCounts(),
    stages: planned.map(({ config, plan }) => ({ stageId: config.id, name: config.name, command: config.command, status: 'waiting', exitCode: null, durationMs: null, counts: emptyCounts(), tests: [], output: '', runner: plan.runner })),
  }, taskId);
  store.putRun(root, run);
  recordRun(root, run);
  const w: Watched = { root, run, stages: planned, done, started: Date.now(), timer: setInterval(() => tick(w), POLL_MS) };
  watching.set(id, w);
  if (isSnapshotRun()) {
    testingFixture.runs.push({ runId: id, dir, typed, script, stages: planned.map(({ config, plan, files }) => ({ name: config.name, command: config.command, exec: plan.exec, report: plan.report?.file ?? null, exit: files.exit, log: files.log })) });
  }
  const tabId = openTab(contents, { command: isSnapshotRun() ? harnessLine(`${SNAPSHOT_STAND_IN} ${id}`) : typed });
  if (tabId) runTabs.set(`${contents.id}:${tabId}`, root);
  return { started: id, typed };
}

export interface TestingDeps { sessions: TabSessions; openTab: OpenTab }
let deps: TestingDeps | null = null;

const sessionFor = (sessions: TabSessions, contentsId: number, tabId: unknown): TabSession | undefined =>
  [...sessions.values()].find((s) => s.contentsId === contentsId && s.tabId === tabId);

export function registerTestingIpc({ sessions, openTab }: TestingDeps): void {
  deps = { sessions, openTab };
  startLockTimer(sessions);
  startTestAgents({ sessions, openTab, notify: showNotice });
  // The project and one of its tasks, for the calls that act on a task's suite.
  const taskTarget = async (contentsId: number, tabId: unknown, picked: unknown, taskId: unknown): Promise<{ root: string; task: Task; tasks: Task[] } | { note: string }> => {
    if (!claudeFolderAllowed()) return { note: 'Petal isn’t reading your folders yet.' };
    const root = await rootFor(sessionFor(sessions, contentsId, tabId), picked);
    if (!root) return { note: 'No project in this tab. Open one first.' };
    const { tasks, problem } = loadTasks(root);
    const task = tasks.find((t) => t.id === taskId);
    return problem ? { note: problem } : task ? { root, task, tasks } : { note: 'That task is gone. It may have been deleted in another window.' };
  };
  const blank = (allowed: boolean, elsewhere: Elsewhere | null = null): TestingState => ({ allowed, project: null, elsewhere, stack: [], proposed: [], seed: null, suites: {}, lock: NO_LOCK, agentNames: {}, runs: [], running: [], sessionTab: null, changed: [], tasks: [], prds: [], sessionTaskId: null });

  // With `session`, the one she picked outside a repo: its repo, and its task as the session's task.
  handle('testing:detect', async (event, { tabId, root: picked, session }) => {
    if (!claudeFolderAllowed()) return blank(false);
    const asking = sessionFor(sessions, event.sender.id, tabId);
    if (session) {
      const { root, taskId } = pickedSession(session);
      return { ...(await stateFor(root, sessions, await sessionOnProject(root, sessions, asking))), sessionTaskId: taskId };
    }
    const root = await rootFor(asking, picked);
    if (!root) return blank(true, await elsewhereFor(asking));
    pruneProject(root, openSessionIds(sessions));
    await giveTabTask(root, asking);
    return stateFor(root, sessions, await sessionOnProject(root, sessions, asking));
  });

  // The cheap refresh while the tab is open: runs only, Claude's new ones merged in.
  handle('testing:history', async (event, { tabId, root: picked }) => {
    const none = { runs: [], running: [], sessionTab: null, criteria: null, seed: null, suites: {}, lock: NO_LOCK, agentNames: {}, distillation: [], loops: {}, tasks: [], prds: [], sessionTaskId: null };
    if (!claudeFolderAllowed()) return none;
    const asking = sessionFor(sessions, event.sender.id, tabId);
    const root = await rootFor(asking, picked);
    if (!root) return none;
    const { suites, lock } = await mergeClaudeRuns(root, sessions);
    await captureOpenDistillations(root, sessions);
    const data = store.load(root);
    const onProject = await sessionOnProject(root, sessions, asking);
    return {
      runs: named(data.runs), running: runningIn(root), sessionTab: onProject?.tabId ?? null,
      criteria: readCriteria(root), seed: projectSeed(root), suites, lock, agentNames: data.agentNames ?? {}, distillation: readDistillation(root), loops: loopViews(root, event.sender.id), ...scopeFacts(root, onProject?.feed.session?.sessionId ?? null),
    };
  });

  // A role's brief: its open agent gets it as a message, else that agent starts with it. The registry decides which.
  const briefRole = async (contentsId: number, root: string, task: Task, role: AgentRole, brief: string): Promise<Claim | { note: string }> => {
    const claim = await claimAgent(root, { taskId: task.id, taskTitle: task.title, role, brief, preferred: contentsId });
    if ('note' in claim || claim.created) return claim;
    const sent = await sendToAgent(root, claim.agent, brief, null, contentsId);
    return 'note' in sent ? sent : claim;
  };
  const startedWords = (claim: Claim, name: string): string => (claim.created ? `Started ${name} in its own terminal` : `${name} moves on to the test loop`);

  // The loop for a task: its testing agent and its bug fix agent, working at once. Each role's open agent is reused
  // (the drafting agent moves on to the loop this way), else one starts. One brief joins a running bug fix agent.
  handle('testing:loop-start', async (event, { tabId, root: picked, taskId, testerBrief, fixerBrief }) => {
    const target = await taskTarget(event.sender.id, tabId, picked, taskId);
    if ('note' in target) return target;
    const briefs = [testerBrief, fixerBrief].filter((brief) => brief !== null && brief !== undefined);
    if (!briefs.length || briefs.some((brief) => typeof brief !== 'string' || !brief.trim() || brief.length > BRIEF_CAP)) return { note: 'A loop brief is empty or too long.' };
    const { root, task } = target;
    const prior = loopsOf(root)[task.id];
    const running = prior?.kind === 'loop' && prior.stoppedAt === null ? prior : null;
    const names = store.load(root).agentNames ?? {};
    if (!fixerBrief && !running?.fixerSessionId) return { note: 'Start the loop to start its testing agent.' };
    if (fixerBrief && running) return { note: `${agentName(names, 'fixer')} is already running for this task, maybe in another window.` };
    prepareLoop(root, task.id);
    const tester = typeof testerBrief === 'string' ? await briefRole(event.sender.id, root, task, 'tester', testerBrief) : null;
    if (tester && 'note' in tester) return tester;
    const fixer = typeof fixerBrief === 'string' ? await briefRole(event.sender.id, root, task, 'fixer', fixerBrief) : null;
    if (fixer && 'note' in fixer) return fixer;
    const now = Date.now();
    const carried = prior?.approvedScenarios ? { approvedScenarios: prior.approvedScenarios } : {};
    const base: StoredLoop = running ?? { kind: 'loop', testerSessionId: null, fixerSessionId: null, startedAt: now, stoppedAt: null, queue: [], events: prior?.kind === 'draft' ? prior.events : noEvents(), ...carried };
    let events = base.events;
    if (tester) events = withEvent(events, 'tester', startedWords(tester, agentName(names, 'tester')), now);
    if (fixer) events = withEvent(events, 'fixer', startedWords(fixer, agentName(names, 'fixer')), now);
    const loop: StoredLoop = { ...base, testerSessionId: tester?.agent.sessionId ?? base.testerSessionId, fixerSessionId: fixer?.agent.sessionId ?? base.fixerSessionId, events };
    saveLoop(root, task.id, loop);
    watchRoot(root);
    const view = loopView(root, loop, event.sender.id);
    return { tester: view.tester, fixer: view.fixer };
  });

  // Ask Claude to draw one up: the task's testing agent, on the testing-suite skill. The skill is checked first: Petal's
  // unedited old copy is updated, a missing or edited one is replaced by its bundled instructions in the brief.
  // The task's open testing agent gets the request instead of a new one; refused while it is still drawing up or testing.
  handle('testing:agent-start', async (event, { tabId, root: picked, taskId, prompt }) => {
    const target = await taskTarget(event.sender.id, tabId, picked, taskId);
    if ('note' in target) return target;
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > BRIEF_CAP) return { note: 'The request is empty or too long.' };
    const { root, task } = target;
    const prior = loopsOf(root)[task.id];
    const tester = openAgent(testAgentsOf(root), task.id, 'tester');
    if (prior?.stoppedAt === null && prior.kind === 'loop') return { note: 'The test loop is running for this task. Stop it first.' };
    if (prior?.stoppedAt === null && tester && prior.testerSessionId === tester.sessionId) return { note: 'This task’s testing agent is already drawing up its suite.' };
    const skill = draftWithSkill(isSnapshotRun() ? testingFixture.claudeDir : allowedClaudeHome(), prompt.trim());
    prepareLoop(root, task.id); // bugs it finds go in the criteria file as [fail] lines
    const claim = await briefRole(event.sender.id, root, task, 'tester', skill.brief);
    if ('note' in claim) return claim;
    const name = agentName(store.load(root).agentNames ?? {}, 'tester');
    const now = Date.now();
    const words = claim.created ? `Started ${name} to draw up the suite` : `You → ${name} · draw up the suite`;
    saveLoop(root, task.id, {
      kind: 'draft', testerSessionId: claim.agent.sessionId, fixerSessionId: null, startedAt: now, stoppedAt: null, queue: [],
      events: withEvent(prior?.events ?? noEvents(), 'tester', words, now), ...(prior?.approvedScenarios ? { approvedScenarios: prior.approvedScenarios } : {}),
    });
    return { agent: agentView(root, claim.agent, event.sender.id), reused: !claim.created, updatedSkill: skill.updated };
  });

  // Edit scenarios: only the task's own criteria file, made first if missing, in her default editor.
  handle('testing:open-criteria', async (event, { tabId, root: picked, taskId }) => {
    const target = await taskTarget(event.sender.id, tabId, picked, taskId);
    if ('note' in target) return target;
    prepareLoop(target.root, target.task.id);
    const file = criteriaFile(target.root, target.task.id);
    if (isSnapshotRun()) { testingFixture.opened.push(file); return { ok: true as const }; }
    const failure = await shell.openPath(file); // '' means it opened
    return failure ? { note: `Couldn’t open the scenarios file: ${failure}` } : { ok: true as const };
  });

  // The lanes' read model. Main steps every queue itself, so a window only reads.
  handle('testing:loops', (event, { known }) => {
    if (!claudeFolderAllowed()) return { loops: [] };
    windowReady(event.sender.id);
    const asked = (Array.isArray(known) ? known.slice(0, KNOWN_CAP) : []).filter((k) => typeof k?.root === 'string' && projectRootOf(k.root) === k.root && isTaskId(k.taskId));
    const loops: LoopFacts[] = listedLoops(asked, event.sender.id).map((listed) => ({ ...listed, names: store.load(listed.root).agentNames ?? {} }));
    return { loops };
  });

  // Send to bug fix agent: the failure joins the queue of the task's open bug fix agent (a stopped loop starts again
  // around it), else a bug fix agent starts on it. A running loop keeps its testing agent.
  handle('testing:send-bug', async (event, { tabId, root: picked, taskId, bug }) => {
    const target = await taskTarget(event.sender.id, tabId, picked, taskId);
    if ('note' in target) return target;
    const clean = cleanSentBug(bug);
    if (!clean) return { note: 'That failure can’t be sent.' };
    const { root, task } = target;
    const names = store.load(root).agentNames ?? {};
    const fixerName = agentName(names, 'fixer');
    const prior = loopsOf(root)[task.id];
    const running = prior?.kind === 'loop' && prior.stoppedAt === null ? prior : null;
    const now = Date.now();
    const fresh = (fixerSessionId: string): StoredLoop => ({ kind: 'loop', testerSessionId: null, fixerSessionId, startedAt: now, stoppedAt: null, queue: [], events: noEvents() });
    const open = openAgent(testAgentsOf(root), task.id, 'fixer');
    if (open) {
      const base = running?.fixerSessionId === open.sessionId ? running : fresh(open.sessionId);
      const { queue, added } = addSent(base.queue, clean, now);
      const fixer = agentView(root, open, event.sender.id, names);
      if (!added) return { outcome: 'already' as const, fixer };
      saveLoop(root, task.id, { ...base, queue, events: withEvent(base.events, 'fixer', `You → ${fixerName} · ${clean.name}`, now) });
      watchRoot(root);
      return { outcome: 'queued' as const, fixer };
    }
    const brief = buildSentFixerBrief({ taskId: task.id, taskTitle: task.title, bugName: clean.name, prompt: clean.sent.failure, names: { tester: agentName(names, 'tester'), fixer: fixerName } });
    const claim = await claimAgent(root, { taskId: task.id, taskTitle: task.title, role: 'fixer', brief, preferred: event.sender.id });
    if ('note' in claim) return claim;
    const base = running ? { ...running, fixerSessionId: claim.agent.sessionId, queue: running.queue.map((b) => (b.state === 'fixing' ? { ...b, state: 'open' as const, asked: false } : b)) } : fresh(claim.agent.sessionId);
    const queue = addSent(base.queue, clean, now, 'fixing').queue; // its brief carries this bug
    saveLoop(root, task.id, { ...base, queue, events: withEvent(base.events, 'fixer', `Started ${fixerName} on ${clean.name}`, now) });
    watchRoot(root);
    return { outcome: 'started' as const, fixer: agentView(root, claim.agent, event.sender.id, names) };
  });

  // One of the project's agents, by session id only; root must be a repo root Petal reads.
  const agentAt = (root: unknown, sessionId: unknown): { root: string; agent: TestAgent } | { note: string } => {
    if (!claudeFolderAllowed()) return { note: 'Petal isn’t reading your folders yet.' };
    const agent = typeof root === 'string' && projectRootOf(root) === root ? findAgent(root, sessionId) : null;
    return agent && typeof root === 'string' ? { root, agent } : { note: 'That isn’t one of this project’s agents.' };
  };

  // Her message to one agent from its lane, or Petal's follow-up with its own lane line.
  handle('testing:agent-send', async (event, { root: asked, sessionId, text, event: line }) => {
    const found = agentAt(asked, sessionId);
    if ('note' in found) return found;
    if (typeof text !== 'string' || !text.trim() || text.length > BRIEF_CAP) return { note: 'Type a message first.' };
    const name = agentName(store.load(found.root).agentNames ?? {}, found.agent.role);
    const words = typeof line === 'string' && line.trim() ? line.trim().slice(0, EVENT_MAX) : herEvent(name, text);
    return sendToAgent(found.root, found.agent, text.trim(), words, event.sender.id);
  });

  // Open terminal: an ended agent resumes into this window with no message.
  handle('testing:agent-open', async (event, { root: asked, sessionId }) => {
    const found = agentAt(asked, sessionId);
    if ('note' in found) return found;
    const problem = await openAgentTerminal(found.root, found.agent, event.sender.id);
    return problem ? { note: problem } : { agent: agentView(found.root, found.agent, event.sender.id) };
  });

  // Looks right: the go-ahead goes to the task's testing agent, and the names she approved are saved with its loop.
  handle('testing:scenarios-approve', async (event, { root, taskId, names }) => {
    const loop = typeof root === 'string' && isTaskId(taskId) ? loopsOf(root)[taskId] : undefined;
    const found = agentAt(root, loop?.testerSessionId);
    if ('note' in found || !loop || typeof taskId !== 'string') return { note: 'Start the testing agent first.' };
    const approved = (Array.isArray(names) ? names : []).filter((n): n is string => typeof n === 'string' && n.length > 0).map((n) => n.slice(0, NAME_CAP)).slice(0, NAMES_CAP);
    if (!approved.length) return { note: 'There are no scenarios to approve.' };
    const name = agentName(store.load(found.root).agentNames ?? {}, 'tester');
    const sent = await sendToAgent(found.root, found.agent, scenariosApprovedText(taskId), `You → ${name} · scenarios look right, write the tests`, event.sender.id);
    if ('note' in sent) return sent;
    const now = loopsOf(found.root)[taskId] ?? loop;
    saveLoop(found.root, taskId, { ...now, approvedScenarios: [...(now.approvedScenarios ?? []), ...approved].slice(-ITEMS_CAP) });
    return sent;
  });

  // Stop: the queue stops stepping now; each running agent gets Esc, then the stop message once idle.
  handle('testing:loop-stop', (_event, { root, taskId }) => {
    if (!claudeFolderAllowed() || typeof root !== 'string' || projectRootOf(root) !== root || !isTaskId(taskId)) return { note: 'That loop isn’t one of this project’s.' };
    const problem = stopTaskLoop(root, taskId);
    return problem ? { note: problem } : { ok: true as const };
  });

  // A loop notification from the renderer: only while no Petal window is focused.
  handle('testing:notify', (event, { title, body, tabId }) => {
    if (typeof title !== 'string' || typeof body !== 'string') return { shown: false };
    return { shown: showNotice({ title, body, tabId: typeof tabId === 'string' ? tabId : null }, event.sender.id) };
  });

  // An agent's action log, tokens and replies, from its transcript: the open terminal's log, else History's copy.
  handle('testing:agent-log', async (event, { tabId, root: picked, sessionId }) => {
    if (!claudeFolderAllowed()) return { note: 'Petal isn’t reading your folders yet.' };
    const root = await rootFor(sessionFor(sessions, event.sender.id, tabId), picked);
    if (!root || typeof sessionId !== 'string' || !agentOf(root, sessionId)) return { note: 'That isn’t one of this project’s agents.' };
    const open = [...sessions.values()].find((s) => s.feed.session?.sessionId === sessionId)?.feed.session?.transcript;
    const file = open ?? history.findRecord(sessionId)?.file;
    const replies = [...repliesOf(sessionId)];
    return file ? { ...(await readAgentLog(file, root)), replies } : { actions: [], tokens: NO_TOKENS, replies };
  });

  // Close agents: each open agent's claude through the Sessions panel's Close, its terminal closed, the loop stopped.
  handle('testing:close-agents', async (event, { tabId, root: picked, taskId }) => {
    const target = await taskTarget(event.sender.id, tabId, picked, taskId);
    if ('note' in target) return target;
    return closeTaskAgents(target.root, target.task.id);
  });

  // The task's suite, from the editor: written to its file. Confirmations only ever come from a confirmed run.
  handle('testing:save-suite', async (event, { tabId, root: picked, taskId, suite }) => {
    const target = await taskTarget(event.sender.id, tabId, picked, taskId);
    if ('note' in target) return target;
    const check = checkSuite(suite);
    if (!check.ok) return { note: 'Each stage needs a name and a one-line command.' };
    writeSuite(target.root, target.task.id, check.suite);
    return { ok: true };
  });

  // Start from the project's commands: re-read here, never the renderer's copy. New commands still ask before their first run.
  handle('testing:seed-suite', async (event, { tabId, root: picked, taskId }) => {
    const target = await taskTarget(event.sender.id, tabId, picked, taskId);
    if ('note' in target) return target;
    const seed = projectSeed(target.root);
    if (!seed || !('stages' in seed)) return { note: 'The project has no commands to start from.' };
    writeSuite(target.root, target.task.id, emptySuite(seed.stages));
    return { ok: true };
  });

  // The test lock, per project: the hook entry in its .claude/settings.local.json and the manifest.
  handle('testing:lock', async (event, { tabId, root: picked, on }) => {
    if (!claudeFolderAllowed()) return { note: 'Petal isn’t reading your folders yet.' };
    const root = await rootFor(sessionFor(sessions, event.sender.id, tabId), picked);
    if (!root) return { note: 'No project in this tab. Open one first.' };
    const problem = setLock(root, on === true);
    return problem ? { note: problem } : { ok: true };
  });

  handle('testing:lock-dismiss', async (event, { tabId, root: picked, taskId }) => {
    const target = await taskTarget(event.sender.id, tabId, picked, taskId);
    if ('note' in target) return target;
    dismissRestored(target.root, target.task.id);
    return { ok: true };
  });

  // Her Keep or Restore for a locked test changed outside Claude.
  handle('testing:lock-resolve', async (event, { tabId, root: picked, taskId, path: rel, keep }) => {
    const target = await taskTarget(event.sender.id, tabId, picked, taskId);
    if ('note' in target) return target;
    const problem = resolveUnconfirmed(target.root, String(rel), keep === true);
    return problem ? { note: problem } : { ok: true };
  });

  // Her name for an agent role, for every task in the project; empty puts the default back.
  handle('testing:agent-name', async (event, { tabId, root: picked, role, name }) => {
    if (!claudeFolderAllowed()) return { note: 'Petal isn’t reading your folders yet.' };
    const root = await rootFor(sessionFor(sessions, event.sender.id, tabId), picked);
    if (!root) return { note: 'No project in this tab. Open one first.' };
    const clean = cleanAgentName(name);
    if (clean === undefined || (role !== 'tester' && role !== 'fixer')) return { note: `A name is 1 to ${AGENT_NAME_MAX} characters on one line.` };
    const data = store.load(root);
    const names = { ...(data.agentNames ?? {}) };
    if (clean === null) delete names[role as AgentRole]; else names[role as AgentRole] = clean;
    store.save({ ...data, agentNames: names });
    return { ok: true };
  });

  // Her Use this file or Keep the old suite, for a suite file changed outside the testing agent.
  handle('testing:suite-outside', async (event, { tabId, root: picked, taskId, use }) => {
    const target = await taskTarget(event.sender.id, tabId, picked, taskId);
    if ('note' in target) return target;
    const problem = settleOutsideChange(target.root, target.task.id, use === true);
    return problem ? { note: problem } : { ok: true };
  });

  handle('testing:undo-suite', async (event, { tabId, root: picked, taskId }) => {
    const target = await taskTarget(event.sender.id, tabId, picked, taskId);
    if ('note' in target) return target;
    return undoSuiteChange(target.root, target.task.id) ? { ok: true } : { note: 'There is no change to undo.' };
  });

  // Runs the task's suite (a subtask without one runs its parent's), tagged with that task.
  handle('testing:run', async (event, { tabId, root: picked, taskId, stageId = null, confirmed = false }): Promise<RunReply> => {
    const target = await taskTarget(event.sender.id, tabId, picked, taskId);
    if ('note' in target) return target;
    const { root, task } = target;
    if (runGoing(runsGoing(), root, task.id)) return { note: 'A run is still going for this task.' };
    const suite = suiteFor(target.tasks, syncSuites(root, target.tasks), task.id)?.suite;
    if (!suite) return { note: 'This task has no suite yet.' };
    const stages = stageId ? suite.stages.filter((s) => s.id === stageId) : suite.stages;
    if (!stages.length) return { note: 'There are no stages to run.' };
    const fresh = unconfirmed(confirmedOf(root), stages);
    if (fresh.length && !confirmed) return { confirm: { commands: stages.map((s) => ({ name: s.name, command: s.command, isNew: fresh.includes(s) })) } };
    rememberConfirmed(root, stages);
    return startRun(root, stages, suite.keepGoing, event.sender, openTab, 'click', task.id);
  });

  // Stop watching a run whose tab was closed or interrupted; the run keeps what finished.
  handle('testing:stop', (_event, { runId }) => {
    const w = watching.get(runId);
    if (!w) return { ok: true };
    fs.writeFileSync(w.done, '130');
    tick(w);
    return { ok: true };
  });
}

// Snapshot runs only: forget the tabs runs opened, as a restart does.
export const snapshotLoops = {
  forgetRunTabs: (): void => { if (isSnapshotRun()) runTabs.clear(); },
};

// Each task's loop as a window shows it.
const loopViews = (root: string, contentsId: number): Record<string, LoopView> =>
  Object.fromEntries(Object.entries(loopsOf(root)).map(([taskId, loop]) => [taskId, loopView(root, loop, contentsId)]));

// A loop notification: only while no Petal window is focused, and a click shows that window and tab. Snapshot runs
// record it, never show it.
function showNotice({ title, body, tabId }: LoopNotice, contentsId: number | null): boolean {
  if (!title.trim() || !loadConfig().testing.notify) return false;
  const focused = BrowserWindow.getFocusedWindow() !== null;
  if (isSnapshotRun()) { testingFixture.notices.push({ title, body, tabId, focused }); return false; }
  if (focused || !Notification.isSupported()) return false;
  const notice = new Notification({ title: title.slice(0, NOTICE_MAX), body: body.slice(0, NOTICE_MAX) });
  notices.add(notice);
  notice.on('close', () => notices.delete(notice));
  notice.on('click', () => {
    notices.delete(notice);
    const sender = contentsId === null ? undefined : webContents.fromId(contentsId);
    const win = sender && !sender.isDestroyed() ? BrowserWindow.fromWebContents(sender) : null;
    if (!sender || !win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    if (tabId) send(sender, 'testing:show-tab', { tabId });
  });
  notice.show();
  return true;
}

// After a Claude turn: run its task's suite if she turned auto-run on for it, the turn edited files, every command was
// confirmed before, nothing is running, and no claude on this project is mid-turn. Still a visible new tab.
export async function onTurnFinished(session: TabSession): Promise<void> {
  if (!deps || !claudeFolderAllowed()) return;
  const s = session.feed.session;
  if (!s?.transcript) return;
  const root = await projectOf(session);
  if (!root) return;
  const { edits } = await scanLog(s.transcript, s.sessionId);
  const before = editsSeen.get(s.transcript) ?? edits; // the first turn seen only sets the baseline, so a restart never runs it
  editsSeen.set(s.transcript, edits);
  const { tasks } = loadTasks(root);
  const taskId = taskIdAt(root, s.sessionId, Date.now(), tasks);
  const suite = suiteFor(tasks, syncSuites(root, tasks), taskId)?.suite; // the session's task's suite, if it asked to run after edits
  if (!suite?.autoRun || edits <= before || !suite.stages.length || unconfirmed(confirmedOf(root), suite.stages).length) return;
  if (runGoing(runsGoing(), root, taskId)) return;
  for (const other of deps.sessions.values()) {
    const o = other.feed.session;
    if (o?.status === 'busy' && o.cwd && repoRoot(o.cwd) === root) return;
  }
  const contents = webContents.fromId(session.contentsId);
  if (contents && !contents.isDestroyed()) startRun(root, suite.stages, suite.keepGoing, contents, deps.openTab, 'auto', taskId);
}

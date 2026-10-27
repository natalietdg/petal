// IPC for the Testing tab: what the active tab's project tests with, the repo's suite and run history, and running it.
// A run is a script Petal writes under userData and types into a NEW tab after her click (never a tab with claude in it);
// main watches each stage's exit-code file and report. Reading the project and her skills waits for the folder gate.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { BrowserWindow, Notification, webContents, type WebContents } from 'electron';
import { handle, send } from './ipc';
import { allowedClaudeHome, claudeFolderAllowed, projectClaudeDir } from './claude-folder';
import { isSnapshotRun, slashFixture, testingFixture } from './snapshot-mode';
import { harnessLine } from './snapshot-shell';
import { slashCatalog } from './slash-catalog';
import { detectStack, proposeStages, scriptsOf, testingSkills } from './testing-detect';
import { parseReport, parseText, keepOutput, shortenPaths, shortenText } from './testing-parse';
import { pipelineScript, readLogTail, resolveRunner, runLine, stageFiles, trimmedNote, withReporter, type StagePlan } from './testing-runner';
import { claudeRun, scanLog, type ClaudeCall, type FileTouch } from './testing-claude';
import { projectRootOf, ranIn, repoRoot, runProject } from './testing-project';
import * as history from './history';
import { sessionTitleFor } from './session-title';
import { NEW_SESSION } from '../shared/session-label';
import { readClaudePipeline } from './testing-claude-pipeline';
import { load as loadConfig } from './config-store';
import { agentOf, allAgents, loopsOf } from './task-suites';
import { suiteFile, suiteHome, syncSuite } from './repo-suite-store';
import { setAgentTitle } from './agent-titles';
import { lockHookPresent, lockRefusals, loadManifest, refreshLock, upgradeLock } from './test-lock';
import { agentName, agentTabTitle } from '../shared/agent-names';
import { loopView, startTestAgents } from './test-agents';
import type { LoopNotice } from '../shared/loop-signals';
import type { LockManifest } from '../shared/test-lock';
import { NO_SUITE, autoRunStages, isLevel, isTaskId, stagesToRun, type RepoSuiteView } from '../shared/repo-suite';
import { foldAgents, listedSession, listedSessions, needsOwnTask, ownedTask, type AgentSession, type PickAgent, type PickSession, type SessionCandidate } from '../shared/task-testing';
import { lastRunAt, latest } from '../shared/task-activity';
import { panelSessions } from './agents-ipc';
import { giveSessionTask } from './tasks-ipc';
import { pruneProject } from './testing-prune';
import * as store from './testing-store';
import { readCriteria, saveScenarioStatuses } from './criteria-store';
import { envPrefix, planScenario, planTicket, scenarioOutcome, ticketScenarios, type ScenarioPlan } from '../shared/scenario-run';
import type { CriteriaItem } from '../shared/test-loop';
import {
  normalizeCommand, runStateOf, unconfirmed, addCounts, emptyCounts,
  type Elsewhere, type LoopView, type PipelineConfig, type PipelineRun, type RunReply, type StageConfig, type LockView, type StageResult, type SuiteSeed, type TestingState, NO_LOCK,
} from '../shared/testing';
import type { OpenTab, TabSession, TabSessions } from './tab-session';
import type { Reply } from '../shared/types';
import { recordActivity } from './activity-feed';
import { repoBranch } from './repo-label';
import { captureReplies, readDistillation } from './distillation-store';
import { loadTasks } from './tasks-store';
import type { Task } from '../shared/tasks';
import { scopeFacts, taskIdAt } from './testing-tasks';
import { namedRepo, transcriptRepo } from './session-repo';
import * as organizer from './session-organizer';
import * as repoIndex from './repo-index';
import { makeTargets, sessionFor, type TestingIpcContext } from './testing-ipc-context';
import { registerSuiteIpc } from './testing-ipc-suite';
import { registerLockIpc } from './testing-ipc-lock';
import { registerLoopControlIpc, registerLoopStartIpc } from './testing-ipc-loop';
import { registerAgentIpc } from './testing-ipc-agents';

const POLL_MS = 1000;
const GIVE_UP_MS = 3 * 60 * 60 * 1000; // a run with no end marker after 3 hours counts as stopped
const SNAPSHOT_STAND_IN = ': petal-test-run'; // typed in snapshot runs instead of the real line
const CHANGED_DAYS = 7; // Suite health's core stage counts files changed this recently
const CHANGED_CAP = 300;
const NOTICE_MAX = 200;

// scenarios: a scenario run's scenarios, whose [pass]/[fail] are written back when it ends.
interface ScenarioWatch { items: { name: string; tests: CriteriaItem['tests'] }[]; files: ScenarioPlan['files'] }
interface Watched { root: string; run: PipelineRun; stages: { config: StageConfig; plan: StagePlan; files: ReturnType<typeof stageFiles> }[]; done: string; started: number; timer: ReturnType<typeof setInterval>; scenarios?: ScenarioWatch }
const watching = new Map<string, Watched>(); // run id -> its watch
const editsSeen = new Map<string, number>(); // transcript -> edits counted at the last auto check
const runTabs = new Map<string, string>(); // `${contentsId}:${tabId}` of a tab a run opened -> its project root
const notices = new Set<Notification>(); // held until clicked or closed, so the click still lands

// The checkout's runs still going: one run at a time per checkout, since it runs the one repo suite.
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

// The repo a Claude session worked in when its folder names none: its log's file paths, else History's project name.
async function workedIn(sessionId: string | null | undefined, transcript: string | null | undefined): Promise<string | null> {
  if (!sessionId) return null;
  const file = transcript || history.findRecord(sessionId)?.file;
  const fromLog = file ? await transcriptRepo(file) : null;
  return fromLog ?? namedRepo(organizer.loadCached()[sessionId]?.project, repoIndex.current()?.repos ?? []);
}

// The git repo the tab's folder is in; null for the home folder or a folder outside a repo.
const folderProject = async (session: TabSession | undefined): Promise<string | null> => projectRootOf(session ? await cwdOf(session) : null);

// The tab's project: its folder's repo, else the repo its Claude session worked in; null when neither.
async function projectOf(session: TabSession | undefined): Promise<string | null> {
  if (!session) return null;
  return (await folderProject(session)) ?? workedIn(session.feed.session?.sessionId, session.feed.session?.transcript);
}

const isPick = (picked: unknown): picked is string => typeof picked === 'string' && projectRootOf(picked) === picked;

// A project she picked in Testing for this tab; taken only when it is itself a repo root, else the tab's.
export async function rootFor(session: TabSession | undefined, picked: unknown): Promise<string | null> {
  return isPick(picked) ? picked : projectOf(session);
}

// ---- Reading the project: stack, skills, proposal.
// The Claude folder Testing reads (skills, recent sessions): the allowed one, or the run's stand-in in snapshot runs.
function testingClaudeDir(): string | null {
  const home = allowedClaudeHome();
  if (!home) return null;
  return (isSnapshotRun() && (testingFixture.claudeDir || slashFixture.claudeDir)) || home;
}

// Where the lock's hook entry goes: her allowed Claude folder, or only the run's stand-in in snapshot runs.
function lockClaudeDir(): string | null {
  if (isSnapshotRun()) return testingFixture.claudeDir || slashFixture.claudeDir || null;
  return allowedClaudeHome();
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

// What a Claude run is matched against when the repo has no suite: the project's commands, else what detection suggests.
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

interface LogFinds { found: { call: ClaudeCall; project: string | null }[]; touches: FileTouch[] }

// Claude's calls in these logs, each with the project it ran in (its "cd", else Claude's folder then), and the files it touched.
async function logCalls(logs: readonly SessionLog[]): Promise<LogFinds> {
  const finds: LogFinds = { found: [], touches: [] };
  for (const log of logs) {
    const scan = await scanLog(log.transcript, log.sessionId);
    for (const call of scan.calls) finds.found.push({ call, project: projectRootOf(ranIn(call.command, call.cwd ?? log.cwd)) });
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

// The logs of this project's agents whose tabs are closed: their file touches still count.
async function closedAgentFinds(root: string, open: readonly SessionLog[]): Promise<LogFinds> {
  const seen = new Set(open.map((log) => log.sessionId));
  const logs = allAgents(root).map((a) => a.sessionId).filter((id) => !seen.has(id))
    .flatMap((id) => { const file = history.findRecord(id)?.file; return file ? [{ transcript: file, sessionId: id, cwd: root }] : []; });
  return logCalls(logs);
}

export interface ProjectChecks { suite: RepoSuiteView; lock: LockView }

// Claude's runs that ran in this project, from every open session and the old home-folder history, added once each.
// Then the repo's suite file, so any session's change shows with Undo, and the test lock's integrity check.
async function mergeClaudeRuns(root: string, sessions: TabSessions): Promise<ProjectChecks> {
  const { tasks } = loadTasks(root);
  if (!claudeFolderAllowed()) return { suite: syncSuite(root), lock: lockView(root, loadManifest(root)) };
  const { found, manifest } = await lockFromLogs(root, sessions, tasks);
  const suite = syncSuite(root);
  const names = store.load(root).agentNames;
  for (const agent of allAgents(root)) {
    const task = tasks.find((t) => t.id === agent.taskId);
    if (task) setAgentTitle(agent.sessionId, agentTabTitle(names, agent.role, task.title));
  }
  await saveClaudeRuns(root, found, tasks, suite, sessions);
  return { suite, lock: lockView(root, manifest) };
}

const lockView = (root: string, manifest: LockManifest): LockView => ({ enabled: manifest.enabled, hookPresent: lockHookPresent(lockClaudeDir()), restored: manifest.restored, refusals: lockRefusals(root, manifest) });

// Every open and closed agent log read, then the lock's integrity check with what they touched.
async function lockFromLogs(root: string, sessions: TabSessions, tasks: readonly Task[]): Promise<{ found: LogFinds['found']; manifest: LockManifest }> {
  const logs = openLogs(sessions);
  const { found, touches } = await logCalls(logs);
  const closed = await closedAgentFinds(root, logs);
  const inputs = { criteria: readCriteria(root, tasks), touches: [...touches, ...closed.touches] };
  return { found, manifest: refreshLock(root, inputs, allAgents(root), store.load(root).agentNames ?? {}) };
}

// ---- The lock keeps up with Testing closed: on a timer and after each Claude turn, for repos with the lock on.
const LOCK_TICK_MS = 10_000;
const lockBusy = new Set<string>(); // roots mid-refresh, so a slow read never stacks up

async function refreshRepoLock(root: string, sessions: TabSessions): Promise<void> {
  if (lockBusy.has(root) || !claudeFolderAllowed() || !loadManifest(root).enabled) return;
  lockBusy.add(root);
  try {
    upgradeLock(root, lockClaudeDir());
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
  const { found } = await logCalls(logs);
  await saveClaudeRuns(root, found, tasks, syncSuite(root), new Map());
}

// The store is loaded after the logs are read, so a run saved meanwhile is never lost.
// A call lands on a stage of the repo's suite; with no suite, on the project's commands.
async function saveClaudeRuns(root: string, found: LogFinds['found'], tasks: Task[], suite: RepoSuiteView, sessions: TabSessions): Promise<void> {
  const calls = found.filter((c) => c.project === root).map((c) => c.call);
  const moved = root === os.homedir() ? [] : homeRuns().filter((run) => runProject(run) === root);
  const data = store.load(root);
  const known = new Set(data.runs.map((r) => r.id));
  const scripts = scriptsOf(root);
  let fallback: StageConfig[] | null = null;
  const stages = (): StageConfig[] => suite.suite?.stages ?? (fallback ??= fallbackStages(root));
  const fresh = calls.filter((call) => !known.has(`claude-${call.id}`)).map((call) => {
    const taskId = taskIdAt(root, call.sessionId, call.at, tasks);
    return withTask(claudeRun(call, stages(), scripts, root), taskId);
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
const RESOLVE_MAX = 40; // logs read per listing for sessions whose folder is no repo, newest first
type Candidate = SessionCandidate & { cwd: string | null };
type Pick = Candidate & { root: string; taskId: string | null; agents: PickAgent[] };

// Her Claude sessions in a repo, for a tab in ~ or outside a repo: the Sessions panel's live ones and History's recent ones.
// A session in ~ is listed under the repo it worked in. A task's agent sessions are folded into the row of the session owning it.
async function sessionPicks(): Promise<Pick[]> {
  const live = panelSessions().map((s): Candidate & { file: string | null } => ({ sessionId: s.sessionId, cwd: s.cwd, root: projectRootOf(s.cwd), status: s.status === 'busy' ? 'busy' : 'idle', at: s.updatedAt ?? null, file: null }));
  const recent = history.listSessions(new Set(), testingClaudeDir()).filter((r) => !r.live)
    .map((r): Candidate & { file: string | null } => ({ sessionId: r.sessionId, cwd: r.cwd, root: projectRootOf(r.cwd), status: 'closed', at: r.lastAt, file: r.file }));
  const rootless = [...live, ...recent].filter((c) => !c.root).sort((a, b) => (b.at ?? 0) - (a.at ?? 0)).slice(0, RESOLVE_MAX);
  await Promise.all(rootless.map(async (c) => { c.root = await workedIn(c.sessionId, c.file); }));
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
  const rows = (await sessionPicks()).map((s): PickSession => ({
    sessionId: s.sessionId, name: sessionTitleFor(s.sessionId, { cwd: s.cwd }), root: s.root, project: path.basename(s.root), status: s.status,
    suite: fs.existsSync(suiteFile(suiteHome(s.root))), agents: s.agents,
  }));
  return { reason: path.resolve(cwd) === os.homedir() ? 'home' : 'no-repo', sessions: rows };
}

// A session she picked from that list: its repo, and its task, made for it now if it owns none. Only a listed session is taken.
async function pickedSession(sessionId: unknown): Promise<{ root: string; taskId: string }> {
  const picked = listedSession(await sessionPicks(), sessionId);
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
  const { suite, lock } = await mergeClaudeRuns(root, sessions);
  const data = store.load(root);
  const running = runningIn(root);
  return {
    allowed: true, project: { root, name: path.basename(root) }, elsewhere: null, stack, proposed: proposeStages(root, stack), seed: projectSeed(root), suite, lock, agentNames: data.agentNames ?? {}, runs: named(data.runs), running,
    sessionTab: onProject?.tabId ?? null, changed: await recentlyChanged(root), runners: [...scenarioEnv(root).runners], ...scopeFacts(root, onProject?.feed.session?.sessionId ?? null),
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
    if (w.scenarios) writeScenarioResults(w.root, w.scenarios, stages);
  }
  store.putRun(w.root, w.run);
  recordRun(w.root, w.run);
  for (const win of BrowserWindow.getAllWindows()) send(win.webContents, 'testing:run-update', { root: w.root, run: w.run });
}

// Each scenario of a finished scenario run gets [pass] or [fail] in the criteria file; one whose files didn't run keeps its status.
function writeScenarioResults(root: string, watch: ScenarioWatch, stages: StageResult[]): void {
  const statuses: Record<string, 'pass' | 'fail'> = {};
  for (const item of watch.items) {
    const outcome = scenarioOutcome(item, stages, watch.files);
    if (outcome) statuses[item.name] = outcome;
  }
  try { saveScenarioStatuses(root, statuses); } catch (error) { console.warn('[petal] scenario results not written:', (error as Error).message); }
}

// The runners the suite's stages call (through package.json scripts too), the environment prefix they share, and their commands.
function scenarioEnv(root: string): { runners: Set<string>; prefix: string; commands: string[] } {
  const stages = syncSuite(root).suite?.stages ?? fallbackStages(root);
  const scripts = scriptsOf(root);
  const runners = new Set(stages.map((s) => resolveRunner(s.command, scripts).runner).filter((r): r is string => r !== null));
  const commands = stages.map((s) => s.command);
  return { runners, prefix: envPrefix(commands), commands };
}

// Writes the script, opens a new tab that runs it, and starts watching. Snapshot runs record the line instead.
function startRun(root: string, stages: StageConfig[], keepGoing: boolean, contents: WebContents, openTab: OpenTab, trigger: PipelineRun['trigger'], taskId: string | null, scenarios?: ScenarioWatch): { started: string; typed: string } {
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
  const w: Watched = { root, run, stages: planned, done, started: Date.now(), timer: setInterval(() => tick(w), POLL_MS), ...(scenarios ? { scenarios } : {}) };
  watching.set(id, w);
  if (isSnapshotRun()) {
    testingFixture.runs.push({ runId: id, dir, typed, script, stages: planned.map(({ config, plan, files }) => ({ name: config.name, command: config.command, exec: plan.exec, report: plan.report?.file ?? null, exit: files.exit, log: files.log })) });
  }
  const tabId = openTab(contents, { command: isSnapshotRun() ? harnessLine(`${SNAPSHOT_STAND_IN} ${id}`) : typed });
  if (tabId) runTabs.set(`${contents.id}:${tabId}`, root);
  return { started: id, typed };
}

export interface TestingDeps { sessions: TabSessions; openTab: OpenTab; agentOpening: (contentsId: number, tabId: string) => boolean }
let deps: TestingDeps | null = null;

export function registerTestingIpc({ sessions, openTab, agentOpening }: TestingDeps): void {
  deps = { sessions, openTab, agentOpening };
  startLockTimer(sessions);
  startTestAgents({ sessions, openTab, agentOpening, notify: showNotice });
  const ctx: TestingIpcContext = { sessions, openTab, ...makeTargets(sessions, rootFor), projectSeed, lockClaudeDir, notify: showNotice };
  registerStateIpc(ctx);
  registerRunIpc(ctx);
  registerSuiteIpc(ctx);
  registerLockIpc(ctx);
  registerLoopStartIpc(ctx);
  registerLoopControlIpc(ctx);
  registerAgentIpc(ctx);
}

const blank = (allowed: boolean, elsewhere: Elsewhere | null = null): TestingState => ({ allowed, project: null, elsewhere, stack: [], proposed: [], seed: null, suite: NO_SUITE, lock: NO_LOCK, agentNames: {}, runs: [], running: [], sessionTab: null, changed: [], runners: [], tasks: [], prds: [], sessionTaskId: null });

// The tab's project and its testing state: the full read, then the cheap refresh.
function registerStateIpc({ sessions }: TestingIpcContext): void {
  // With `session`, the one she picked outside a repo: its repo, and its task as the session's task.
  // With `picker`, she asked for the session picker over the repo her session worked in.
  handle('testing:detect', async (event, { tabId, root: picked, session, picker }) => {
    if (!claudeFolderAllowed()) return blank(false);
    const asking = sessionFor(sessions, event.sender.id, tabId);
    if (session) {
      const { root, taskId } = await pickedSession(session);
      return { ...(await stateFor(root, sessions, await sessionOnProject(root, sessions, asking))), sessionTaskId: taskId };
    }
    const inFolder = await folderProject(asking);
    const root = isPick(picked) ? picked : inFolder ?? (picker === true ? null : await projectOf(asking));
    if (!root) return blank(true, await elsewhereFor(asking));
    pruneProject(root, openSessionIds(sessions));
    await giveTabTask(root, asking);
    const state = await stateFor(root, sessions, await sessionOnProject(root, sessions, asking));
    return inFolder || isPick(picked) ? state : { ...state, elsewhere: await elsewhereFor(asking) }; // followed: the picker stays one click away
  });

  // The cheap refresh while the tab is open: runs only, Claude's new ones merged in.
  handle('testing:history', async (event, { tabId, root: picked }) => {
    const none = { runs: [], running: [], sessionTab: null, criteria: null, seed: null, suite: NO_SUITE, lock: NO_LOCK, agentNames: {}, distillation: [], loops: {}, tasks: [], prds: [], sessionTaskId: null };
    if (!claudeFolderAllowed()) return none;
    const asking = sessionFor(sessions, event.sender.id, tabId);
    const root = await rootFor(asking, picked);
    if (!root) return none;
    const { suite, lock } = await mergeClaudeRuns(root, sessions);
    await captureOpenDistillations(root, sessions);
    const data = store.load(root);
    const onProject = await sessionOnProject(root, sessions, asking);
    return {
      runs: named(data.runs), running: runningIn(root), sessionTab: onProject?.tabId ?? null,
      criteria: readCriteria(root), seed: projectSeed(root), suite, lock, agentNames: data.agentNames ?? {}, distillation: readDistillation(root), loops: loopViews(root, event.sender.id), ...scopeFacts(root, onProject?.feed.session?.sessionId ?? null),
    };
  });
}

// A run with a command not run before asks first, listing every command and which are new.
const confirmPrompt = (root: string, stages: StageConfig[]): RunReply | null => {
  const fresh = unconfirmed(confirmedOf(root), stages);
  return fresh.length ? { confirm: { commands: stages.map((s) => ({ name: s.name, command: s.command, isNew: fresh.includes(s) })) } } : null;
};
const taskTag = (taskId: unknown, tasks: readonly Task[]): string | null => (isTaskId(taskId) && tasks.some((t) => t.id === taskId) ? taskId : null);

// Running the repo's suite or a ticket's scenarios in a new tab, and stopping the watch on one.
function registerRunIpc({ projectTarget, openTab }: TestingIpcContext): void {
  // Runs the repo's suite in this checkout: the stages her filter shows, opt-in ones only when she turned them on. Tagged
  // with the task when one is given.
  handle('testing:run', async (event, { tabId, root: picked, taskId = null, stageId = null, levels = [], optedIn = [], confirmed = false }): Promise<RunReply> => {
    const target = await projectTarget(event.sender.id, tabId, picked);
    if ('note' in target) return target;
    const { root } = target;
    if (runningIn(root).length) return { note: 'A run is still going in this checkout.' };
    const suite = syncSuite(root).suite;
    if (!suite) return { note: 'This repo has no suite yet.' };
    const filter = { levels: (Array.isArray(levels) ? levels : []).filter(isLevel), optedIn: (Array.isArray(optedIn) ? optedIn : []).filter((id): id is string => typeof id === 'string') };
    const stages = stagesToRun(suite.stages, filter, typeof stageId === 'string' ? stageId : null);
    if (!stages.length) return { note: 'There are no stages to run. Opt-in stages run only when turned on.' };
    const ask = confirmPrompt(root, stages);
    if (ask && !confirmed) return ask;
    rememberConfirmed(root, stages);
    return startRun(root, stages, suite.keepGoing, event.sender, openTab, 'click', taskTag(taskId, target.tasks));
  });

  // Runs one scenario's tests, or every tested scenario of a ticket (staging ones only with staging on), one command per
  // test file. Its results set each scenario's [pass] or [fail]; the run shows in history like a stage run.
  handle('testing:run-scenarios', async (event, { tabId, root: picked, taskId = null, scenario = null, ticket = null, staging = false, confirmed = false }): Promise<RunReply> => {
    const target = await projectTarget(event.sender.id, tabId, picked);
    if ('note' in target) return target;
    const { root } = target;
    if (runningIn(root).length) return { note: 'A run is still going in this checkout.' };
    const scenarios = readCriteria(root, target.tasks)?.scenarios ?? [];
    const items = typeof scenario === 'string' ? scenarios.filter((s) => s.name === scenario && s.tests.length)
      : typeof ticket === 'string' ? ticketScenarios(scenarios, ticket, staging === true) : [];
    if (!items.length) return { note: typeof scenario === 'string' ? 'That scenario names no test.' : 'No scenario of this ticket names a test.' };
    const { runners, prefix, commands } = scenarioEnv(root);
    const plan = typeof scenario === 'string' ? planScenario(items[0], runners, prefix, commands) : planTicket(items, runners, prefix, commands);
    if (!plan.stages.length) return { note: `No known runner for ${plan.skipped[0] ?? 'these tests'}.` };
    const ask = confirmPrompt(root, plan.stages);
    if (ask && !confirmed) return ask;
    rememberConfirmed(root, plan.stages);
    return startRun(root, plan.stages, true, event.sender, openTab, 'click', taskTag(taskId, target.tasks), { items: items.map(({ name, tests }) => ({ name, tests })), files: plan.files });
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

// After a Claude turn: run the repo's suite if she turned auto-run on, the turn edited files, every command was confirmed
// before, nothing is running, and no claude on this project is mid-turn. Never an opt-in stage. Still a visible new tab.
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
  const suite = syncSuite(root).suite;
  const stages = suite ? autoRunStages(suite.stages) : [];
  if (!suite?.autoRun || edits <= before || !stages.length || unconfirmed(confirmedOf(root), stages).length) return;
  if (runningIn(root).length) return;
  for (const other of deps.sessions.values()) {
    const o = other.feed.session;
    if (o?.status === 'busy' && o.cwd && repoRoot(o.cwd) === root) return;
  }
  const contents = webContents.fromId(session.contentsId);
  if (contents && !contents.isDestroyed()) startRun(root, stages, suite.keepGoing, contents, deps.openTab, 'auto', taskId);
}

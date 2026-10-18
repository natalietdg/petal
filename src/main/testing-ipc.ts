// IPC for the Testing tab: what the active tab's project tests with, each task's suite and run history, and running it.
// A run is a script Petal writes under userData and types into a NEW tab after her click (never a tab with claude in it);
// main watches each stage's exit-code file and report. Reading the project and her skills waits for the folder gate.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { BrowserWindow, webContents, type WebContents } from 'electron';
import { handle, send } from './ipc';
import { allowedClaudeHome, claudeFolderAllowed, projectClaudeDir } from './claude-folder';
import { isSnapshotRun, slashFixture, testingFixture } from './snapshot-mode';
import { harnessLine } from './snapshot-shell';
import { slashCatalog } from './slash-catalog';
import { detectStack, proposeStages, scriptsOf, testingSkills } from './testing-detect';
import { parseReport, parseText, keepOutput, shortenPaths, shortenText } from './testing-parse';
import { pipelineScript, runLine, stageFiles, withReporter, type StagePlan } from './testing-runner';
import { claudeRun, scanLog, type ClaudeCall, type SuiteWrite } from './testing-claude';
import { projectRootOf, ranIn, repoRoot, runProject } from './testing-project';
import * as history from './history';
import { sessionTitleFor } from './session-title';
import { NEW_SESSION } from '../shared/session-label';
import { readClaudePipeline } from './testing-claude-pipeline';
import { agentsOf, rememberAgent, syncSuites, undoSuiteChange, writeSuite } from './task-suites';
import { checkSuite, emptySuite, suiteFor, type SuiteViews } from '../shared/task-suite';
import * as store from './testing-store';
import { ensureSelfIgnore } from './factory-store';
import { writeFileDurable } from './atomic-file';
import { buildStartCommand, shellQuote } from './resume-command';
import { claudeLaunch } from './claude-launch';
import { CRITERIA_CAP, CRITERIA_PATH, CRITERIA_SKELETON, parseCriteria, type Criteria } from '../shared/test-loop';
import {
  normalizeCommand, runStateOf, unconfirmed, addCounts, emptyCounts,
  type Elsewhere, type PipelineConfig, type PipelineRun, type ProjectRef, type RunReply, type StageConfig, type StageResult, type SuiteSeed, type TestingState,
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
const LOOP_STAND_IN = ': petal-loop-start'; // typed in snapshot runs instead of starting claude
const BRIEF_CAP = 12000;
const CHANGED_DAYS = 7; // Suite health's core stage counts files changed this recently
const CHANGED_CAP = 300;

interface Watched { root: string; run: PipelineRun; stages: { config: StageConfig; plan: StagePlan; files: ReturnType<typeof stageFiles> }[]; done: string; started: number; timer: ReturnType<typeof setInterval> }
const watching = new Map<string, Watched>(); // run id -> its watch
const editsSeen = new Map<string, number>(); // transcript -> edits counted at the last auto check
const runTabs = new Map<string, string>(); // `${contentsId}:${tabId}` of a tab a run opened -> its project root

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

interface LogFinds { found: { call: ClaudeCall; project: string | null }[]; writes: SuiteWrite[] }

// Claude's calls in these logs, each with the project it ran in (its "cd", else Claude's folder then), and its suite file writes.
async function logCalls(logs: readonly SessionLog[]): Promise<LogFinds> {
  const finds: LogFinds = { found: [], writes: [] };
  for (const log of logs) {
    const scan = await scanLog(log.transcript, log.sessionId);
    for (const call of scan.calls) finds.found.push({ call, project: projectRootOf(ranIn(call.command, call.cwd ?? log.cwd)) });
    finds.writes.push(...scan.suiteWrites);
  }
  return finds;
}

// Every open session's log.
const openLogs = (sessions: TabSessions): SessionLog[] => [...sessions.values()].flatMap(({ feed }) => {
  const s = feed.session;
  return s?.transcript ? [{ transcript: s.transcript, sessionId: s.sessionId, cwd: (isSnapshotRun() && testingFixture.project) || s.cwd || null }] : [];
});

const openCalls = (sessions: TabSessions) => logCalls(openLogs(sessions));

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

// Suite file writes in the logs of this project's testing agents whose tabs are closed.
async function closedAgentWrites(root: string, tasks: readonly Task[], open: readonly SessionLog[]): Promise<SuiteWrite[]> {
  const seen = new Set(open.map((log) => log.sessionId));
  const logs = tasks.flatMap((t) => agentsOf(root, t.id)).filter((id) => !seen.has(id))
    .flatMap((id) => { const file = history.findRecord(id)?.file; return file ? [{ transcript: file, sessionId: id, cwd: root }] : []; });
  return (await logCalls(logs)).writes;
}

// Claude's runs that ran in this project, from every open session and the old home-folder history, added once each.
// Then the tasks' suite files, so a change the testing agent just made shows; returns each task's suite.
async function mergeClaudeRuns(root: string, sessions: TabSessions): Promise<SuiteViews> {
  const { tasks } = loadTasks(root);
  if (!claudeFolderAllowed()) return syncSuites(root, tasks);
  const logs = openLogs(sessions);
  const { found, writes } = await logCalls(logs);
  const suites = syncSuites(root, tasks, [...writes, ...(await closedAgentWrites(root, tasks, logs))]);
  await saveClaudeRuns(root, found, tasks, suites, sessions);
  return suites;
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

const PICK_MAX = 8;

// Projects to offer when the tab is in ~ or outside a repo: open tabs', where Claude ran checks, recent sessions'.
async function recentProjects(sessions: TabSessions): Promise<ProjectRef[]> {
  const seen = new Map<string, number>(); // root -> most recent use
  const note = (root: string | null, at: number) => { if (root) seen.set(root, Math.max(seen.get(root) ?? 0, at)); };
  for (const s of sessions.values()) note(await projectOf(s), Date.now());
  for (const { call, project } of (await openCalls(sessions)).found) note(project, call.at);
  for (const run of homeRuns()) note(runProject(run), run.startedAt);
  for (const record of history.listSessions(new Set(), testingClaudeDir()).slice(0, 40)) note(projectRootOf(record.cwd), record.lastAt);
  return [...seen].sort((a, b) => b[1] - a[1]).slice(0, PICK_MAX).map(([root]) => ({ root, name: path.basename(root) }));
}

async function elsewhereFor(session: TabSession | undefined, sessions: TabSessions): Promise<Elsewhere | null> {
  const cwd = session ? await cwdOf(session) : null;
  if (!cwd) return null;
  const folder = path.resolve(cwd);
  return { reason: folder === os.homedir() ? 'home' : 'no-repo', folder: path.basename(folder), projects: await recentProjects(sessions) };
}

// This window's tab with a Claude session on the project: the asking tab first, else any other.
async function sessionOnProject(root: string, sessions: TabSessions, asking: TabSession | undefined): Promise<TabSession | null> {
  const mine = [...sessions.values()].filter((s) => s.contentsId === asking?.contentsId && s.feed.session);
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

async function stateFor(root: string, sessions: TabSessions, onProject: TabSession | null): Promise<TestingState> {
  const stack = [...detectStack(root), ...skillsFor(root)];
  const suites = await mergeClaudeRuns(root, sessions);
  const data = store.load(root);
  const running = [...watching.values()].find((w) => w.root === root)?.run.id ?? null;
  return {
    allowed: true, project: { root, name: path.basename(root) }, elsewhere: null, stack, proposed: proposeStages(root, stack), seed: projectSeed(root), suites, runs: named(data.runs), running,
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
  const log = fs.existsSync(files.log) ? fs.readFileSync(files.log, 'utf8') : '';
  parsed = shortenPaths(parsed ?? parseText(log, plan.runner), w.root);
  const failed = exitCode !== 0 || parsed.counts.failed > 0;
  const began = fs.existsSync(files.log) ? fs.statSync(files.log).birthtimeMs : w.started;
  const ended = fs.statSync(files.exit).mtimeMs;
  return {
    ...w.run.stages[i], status: failed ? 'failed' : 'passed', exitCode, counts: parsed.counts, tests: parsed.tests,
    durationMs: parsed.durationMs ?? Math.max(0, Math.round(ended - began)), output: failed ? shortenText(keepOutput(log), w.root) : '', runner: parsed.runner ?? plan.runner,
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

// ---- Test loop: Petal makes .petal/ (kept out of git) and reads the criteria file; Claude runs the loop itself.
const criteriaFile = (root: string): string => path.join(root, ...CRITERIA_PATH.split('/'));

export function prepareLoop(root: string): void {
  const file = criteriaFile(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  ensureSelfIgnore(path.dirname(file), root);
  if (!fs.existsSync(file)) writeFileDurable(file, CRITERIA_SKELETON, undefined, { within: root });
}

// Read only, the first CRITERIA_CAP bytes; null when there is no file yet.
export function readCriteria(root: string): Criteria | null {
  let fd: number;
  try { fd = fs.openSync(criteriaFile(root), 'r'); } catch { return null; }
  try {
    const size = fs.fstatSync(fd).size;
    const buffer = Buffer.alloc(Math.min(size, CRITERIA_CAP));
    const read = fs.readSync(fd, buffer, 0, buffer.length, 0);
    return parseCriteria(buffer.toString('utf8', 0, read), size > CRITERIA_CAP);
  } finally {
    fs.closeSync(fd);
  }
}

export interface TestingDeps { sessions: TabSessions; openTab: OpenTab }
let deps: TestingDeps | null = null;

const sessionFor = (sessions: TabSessions, contentsId: number, tabId: unknown): TabSession | undefined =>
  [...sessions.values()].find((s) => s.contentsId === contentsId && s.tabId === tabId);

export function registerTestingIpc({ sessions, openTab }: TestingDeps): void {
  deps = { sessions, openTab };
  // The project and one of its tasks, for the calls that act on a task's suite.
  const taskTarget = async (contentsId: number, tabId: unknown, picked: unknown, taskId: unknown): Promise<{ root: string; task: Task; tasks: Task[] } | { note: string }> => {
    if (!claudeFolderAllowed()) return { note: 'Petal isn’t reading your folders yet.' };
    const root = await rootFor(sessionFor(sessions, contentsId, tabId), picked);
    if (!root) return { note: 'No project in this tab. Open one first.' };
    const { tasks, problem } = loadTasks(root);
    const task = tasks.find((t) => t.id === taskId);
    return problem ? { note: problem } : task ? { root, task, tasks } : { note: 'That task is gone. It may have been deleted in another window.' };
  };
  const blank = (allowed: boolean, elsewhere: Elsewhere | null = null): TestingState => ({ allowed, project: null, elsewhere, stack: [], proposed: [], seed: null, suites: {}, runs: [], running: null, sessionTab: null, changed: [], tasks: [], prds: [], sessionTaskId: null });

  handle('testing:detect', async (event, { tabId, root: picked }) => {
    if (!claudeFolderAllowed()) return blank(false);
    const asking = sessionFor(sessions, event.sender.id, tabId);
    const root = await rootFor(asking, picked);
    return root ? stateFor(root, sessions, await sessionOnProject(root, sessions, asking)) : blank(true, await elsewhereFor(asking, sessions));
  });

  // The cheap refresh while the tab is open: runs only, Claude's new ones merged in.
  handle('testing:history', async (event, { tabId, root: picked }) => {
    const none = { runs: [], running: null, sessionTab: null, criteria: null, seed: null, suites: {}, distillation: [], tasks: [], prds: [], sessionTaskId: null };
    if (!claudeFolderAllowed()) return none;
    const asking = sessionFor(sessions, event.sender.id, tabId);
    const root = await rootFor(asking, picked);
    if (!root) return none;
    const suites = await mergeClaudeRuns(root, sessions);
    await captureOpenDistillations(root, sessions);
    const data = store.load(root);
    const onProject = await sessionOnProject(root, sessions, asking);
    return {
      runs: named(data.runs), running: [...watching.values()].find((w) => w.root === root)?.run.id ?? null, sessionTab: onProject?.tabId ?? null,
      criteria: readCriteria(root), seed: projectSeed(root), suites, distillation: readDistillation(root), ...scopeFacts(root, onProject?.feed.session?.sessionId ?? null),
    };
  });

  // Starts a task's testing agent: claude with the brief in a new tab, under a session id Petal picks and remembers,
  // so only that session's writes change the task's suite.
  const startAgent = async (contents: WebContents, root: string, taskId: string, brief: string): Promise<string | null> => {
    const sessionId = crypto.randomUUID();
    rememberAgent(root, taskId, sessionId);
    const command = `cd ${shellQuote(root)} && ${buildStartCommand(brief, `${(await claudeLaunch()).command} --session-id ${sessionId}`)}`;
    if (isSnapshotRun()) testingFixture.loopStarts.push({ command });
    const opened = openTab(contents, { command: isSnapshotRun() ? harnessLine(LOOP_STAND_IN) : command, background: true });
    if (opened) runTabs.set(`${contents.id}:${opened}`, root);
    return opened ?? null;
  };

  // Prepares .petal/, then either leaves the paste to the reply box's path or starts the task's testing agent in a new tab.
  handle('testing:loop-start', async (event, { tabId, root: picked, brief, newTab, taskId }) => {
    if (!claudeFolderAllowed()) return { note: 'Petal isn’t reading your folders yet.' };
    const root = await rootFor(sessionFor(sessions, event.sender.id, tabId), picked);
    if (!root) return { note: 'No project in this tab. Open one first.' };
    if (typeof brief !== 'string' || !brief.trim() || brief.length > BRIEF_CAP) return { note: 'The loop brief is empty or too long.' };
    const task = loadTasks(root).tasks.find((t) => t.id === taskId);
    if (newTab === true && !task) return { note: 'That task is gone. It may have been deleted in another window.' };
    prepareLoop(root);
    if (newTab !== true || !task) return { tabId: null };
    return { tabId: await startAgent(event.sender, root, task.id, brief) };
  });

  // Ask Claude to draw one up: the testing agent, started on the testing-suite skill for this task.
  handle('testing:agent-start', async (event, { tabId, root: picked, taskId, prompt }) => {
    const target = await taskTarget(event.sender.id, tabId, picked, taskId);
    if ('note' in target) return target;
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > BRIEF_CAP) return { note: 'The request is empty or too long.' };
    return { tabId: await startAgent(event.sender, target.root, target.task.id, prompt) };
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
    if ([...watching.values()].some((w) => w.root === root)) return { note: 'A run is still going for this project.' };
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
  if ([...watching.values()].some((w) => w.root === root)) return;
  for (const other of deps.sessions.values()) {
    const o = other.feed.session;
    if (o?.status === 'busy' && o.cwd && repoRoot(o.cwd) === root) return;
  }
  const contents = webContents.fromId(session.contentsId);
  if (contents && !contents.isDestroyed()) startRun(root, suite.stages, suite.keepGoing, contents, deps.openTab, 'auto', taskId);
}

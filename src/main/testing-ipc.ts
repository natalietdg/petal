// IPC for the Testing tab: what the active tab's project tests with, its pipeline and run history, and running it.
// A run is a script Petal writes under userData and types into a NEW tab after her click (never a tab with claude in it);
// main watches each stage's exit-code file and report. Reading the project and her skills waits for the folder gate.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { BrowserWindow, webContents, type WebContents } from 'electron';
import { handle, send } from './ipc';
import { allowedClaudeHome, claudeFolderAllowed, projectClaudeDir } from './claude-folder';
import { isSnapshotRun, slashFixture, testingFixture } from './snapshot-mode';
import { slashCatalog } from './slash-catalog';
import { detectStack, proposeStages, scriptsOf, testingSkills } from './testing-detect';
import { parseReport, parseText, keepOutput, shortenPaths, shortenText } from './testing-parse';
import { pipelineScript, runLine, stageFiles, withReporter, type StagePlan } from './testing-runner';
import { claudeRun, scanLog } from './testing-claude';
import { adoptClaudePipeline, offersClaudePipeline, readClaudePipeline, type ClaudePipeline } from './testing-claude-pipeline';
import * as store from './testing-store';
import { ensureSelfIgnore } from './factory-store';
import { writeFileDurable } from './atomic-file';
import { buildStartCommand, shellQuote } from './resume-command';
import { CRITERIA_CAP, CRITERIA_PATH, CRITERIA_SKELETON, parseCriteria, type Criteria } from '../shared/test-loop';
import {
  normalizeCommand, runStateOf, unconfirmed, addCounts, emptyCounts,
  type ClaudePipelineState, type PipelineConfig, type PipelineRun, type RunReply, type StageConfig, type StageResult, type TestingState,
} from '../shared/testing';
import type { OpenTab, TabSession, TabSessions } from './tab-session';

const POLL_MS = 1000;
const GIVE_UP_MS = 3 * 60 * 60 * 1000; // a run with no end marker after 3 hours counts as stopped
const MAX_STAGES = 20;
const SNAPSHOT_STAND_IN = ': petal-test-run'; // typed in snapshot runs instead of the real line
const LOOP_STAND_IN = ': petal-loop-start\r'; // typed in snapshot runs instead of starting claude
const BRIEF_CAP = 12000;

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

export function repoRoot(cwd: string): string {
  const stop = os.homedir();
  for (let dir = cwd; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    if (dir === stop || path.dirname(dir) === dir) return cwd;
  }
}

async function cwdOf(session: TabSession): Promise<string | null> {
  if (isSnapshotRun() && testingFixture.project) return testingFixture.project;
  const ranHere = runTabs.get(`${session.contentsId}:${session.tabId}`); // a run's own tab belongs to its project
  if (ranHere) return ranHere;
  return session.feed.session?.cwd ?? (await shellCwd(session.pty.pid));
}

const projectOf = async (session: TabSession | undefined): Promise<string | null> => {
  const cwd = session ? await cwdOf(session) : null;
  return cwd && path.isAbsolute(cwd) ? repoRoot(cwd) : null;
};

// ---- Reading the project: stack, skills, proposal.
function skillsFor(root: string) {
  const home = allowedClaudeHome();
  if (!home) return [];
  const claudeDir = (isSnapshotRun() && (testingFixture.claudeDir || slashFixture.claudeDir)) || home;
  return testingSkills(slashCatalog({ claudeDir, projectDir: projectClaudeDir(root) }));
}

const defaultPipeline = (stages: StageConfig[]): PipelineConfig => ({ stages, keepGoing: false, autoRun: false, confirmed: [] });

const validClaudePipeline = (root: string): ClaudePipeline | null => {
  const claude = readClaudePipeline(root);
  return claude && 'stages' in claude ? claude : null;
};

// The stages to offer when nothing is saved: the pipeline Claude drew up, else what detection suggests.
const proposalFor = (root: string, stack = detectStack(root)): StageConfig[] => validClaudePipeline(root)?.stages ?? proposeStages(root, stack);

function claudePipelineState(root: string, saved: PipelineConfig | null): ClaudePipelineState | null {
  const claude = readClaudePipeline(root);
  if (!claude) return null;
  if ('problem' in claude) return { problem: claude.problem };
  return { proposal: !saved, offer: offersClaudePipeline(saved, claude), stages: claude.stages.length };
}

// Claude's runs in every open session on this project, added to its history once each.
function mergeClaudeRuns(root: string, sessions: TabSessions, stages: StageConfig[]): void {
  if (!claudeFolderAllowed()) return;
  const data = store.load(root);
  const known = new Set(data.runs.map((r) => r.id));
  const fresh: PipelineRun[] = [];
  const scripts = scriptsOf(root);
  for (const { feed } of sessions.values()) {
    const s = feed.session;
    const cwd = (isSnapshotRun() && testingFixture.project) || s?.cwd;
    if (!s?.transcript || !cwd || repoRoot(cwd) !== root) continue;
    for (const call of scanLog(s.transcript, s.sessionId).calls) if (!known.has(`claude-${call.id}`)) fresh.push(claudeRun(call, stages, scripts, root));
  }
  if (fresh.length) store.save({ ...data, runs: [...fresh, ...data.runs] });
}

// This window's tab with a Claude session on the project: the asking tab first, else any other.
async function sessionTabFor(root: string, sessions: TabSessions, asking: TabSession | undefined): Promise<string | null> {
  const mine = [...sessions.values()].filter((s) => s.contentsId === asking?.contentsId && s.feed.session);
  const ordered = [...mine.filter((s) => s === asking), ...mine.filter((s) => s !== asking)];
  for (const s of ordered) if ((await projectOf(s)) === root) return s.tabId;
  return null;
}

function stateFor(root: string, sessions: TabSessions, sessionTab: string | null): TestingState {
  const stack = [...detectStack(root), ...skillsFor(root)];
  const proposed = proposalFor(root, stack);
  const saved = store.load(root).pipeline;
  const pipeline = saved ?? defaultPipeline(proposed);
  mergeClaudeRuns(root, sessions, pipeline.stages);
  const data = store.load(root);
  const running = [...watching.values()].find((w) => w.root === root)?.run.id ?? null;
  return { allowed: true, project: { root, name: path.basename(root) }, stack, proposed, pipeline, saved: Boolean(saved), runs: data.runs, running, sessionTab, claudePipeline: claudePipelineState(root, saved) };
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
  for (const win of BrowserWindow.getAllWindows()) send(win.webContents, 'testing:run-update', { root: w.root, run: w.run });
}

// Writes the script, opens a new tab that runs it, and starts watching. Snapshot runs record the line instead.
function startRun(root: string, stages: StageConfig[], keepGoing: boolean, contents: WebContents, openTab: OpenTab, trigger: PipelineRun['trigger']): { started: string; typed: string } {
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
  const run: PipelineRun = {
    id, by: 'you', trigger, startedAt: Date.now(), finishedAt: null, state: 'running', totals: emptyCounts(),
    stages: planned.map(({ config, plan }) => ({ stageId: config.id, name: config.name, command: config.command, status: 'waiting', exitCode: null, durationMs: null, counts: emptyCounts(), tests: [], output: '', runner: plan.runner })),
  };
  store.putRun(root, run);
  const w: Watched = { root, run, stages: planned, done, started: Date.now(), timer: setInterval(() => tick(w), POLL_MS) };
  watching.set(id, w);
  if (isSnapshotRun()) {
    testingFixture.runs.push({ runId: id, dir, typed, script, stages: planned.map(({ config, plan, files }) => ({ name: config.name, command: config.command, exec: plan.exec, report: plan.report?.file ?? null, exit: files.exit, log: files.log })) });
  }
  const tabId = openTab(contents, { command: isSnapshotRun() ? `${SNAPSHOT_STAND_IN} ${id}\r` : typed });
  if (tabId) runTabs.set(`${contents.id}:${tabId}`, root);
  return { started: id, typed };
}

// Stages, keep-going and auto-run from the renderer; confirmations only ever come from a confirmed run.
export function cleanPipeline(raw: unknown, previous: PipelineConfig | null): PipelineConfig | null {
  const value = raw as Partial<PipelineConfig> | null;
  if (!value || !Array.isArray(value.stages) || value.stages.length > MAX_STAGES) return null;
  const stages: StageConfig[] = [];
  for (const s of value.stages as Partial<StageConfig>[]) {
    const name = typeof s?.name === 'string' ? s.name.trim().slice(0, 60) : '';
    const command = typeof s?.command === 'string' ? s.command.trim() : '';
    const id = typeof s?.id === 'string' && /^[\w-]{1,64}$/.test(s.id) ? s.id : null;
    if (!name || !command || !id || command.length > 2000 || /[\r\n]/.test(command) || stages.some((x) => x.id === id)) return null;
    stages.push({ id, name, command });
  }
  return { stages, keepGoing: value.keepGoing === true, autoRun: value.autoRun === true, confirmed: previous?.confirmed ?? [], savedAt: Date.now() };
}

// ---- Test loop: Petal makes .petal/ (kept out of git) and reads the criteria file; Claude runs the loop itself.
const criteriaFile = (root: string): string => path.join(root, ...CRITERIA_PATH.split('/'));

export function prepareLoop(root: string): void {
  const file = criteriaFile(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  ensureSelfIgnore(path.dirname(file));
  if (!fs.existsSync(file)) writeFileDurable(file, CRITERIA_SKELETON);
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
  const blank = (allowed: boolean): TestingState => ({ allowed, project: null, stack: [], proposed: [], pipeline: defaultPipeline([]), saved: false, runs: [], running: null, sessionTab: null, claudePipeline: null });

  handle('testing:detect', async (event, { tabId }) => {
    if (!claudeFolderAllowed()) return blank(false);
    const asking = sessionFor(sessions, event.sender.id, tabId);
    const root = await projectOf(asking);
    return root ? stateFor(root, sessions, await sessionTabFor(root, sessions, asking)) : blank(true);
  });

  // The cheap refresh while the tab is open: runs only, Claude's new ones merged in.
  handle('testing:history', async (event, { tabId }) => {
    if (!claudeFolderAllowed()) return { runs: [], running: null, sessionTab: null, criteria: null, claudePipeline: null };
    const asking = sessionFor(sessions, event.sender.id, tabId);
    const root = await projectOf(asking);
    if (!root) return { runs: [], running: null, sessionTab: null, criteria: null, claudePipeline: null };
    // An unsaved pipeline is the proposal, so Claude's runs still land on a stage.
    mergeClaudeRuns(root, sessions, store.load(root).pipeline?.stages ?? proposalFor(root));
    const data = store.load(root);
    return { runs: data.runs, running: [...watching.values()].find((w) => w.root === root)?.run.id ?? null, sessionTab: await sessionTabFor(root, sessions, asking), criteria: readCriteria(root), claudePipeline: claudePipelineState(root, data.pipeline) };
  });

  // Prepares .petal/, then either leaves the paste to the reply box's path or starts claude with the brief in a new tab.
  handle('testing:loop-start', async (event, { tabId, brief, newTab }) => {
    if (!claudeFolderAllowed()) return { note: 'Petal isn’t reading your folders yet.' };
    const root = await projectOf(sessionFor(sessions, event.sender.id, tabId));
    if (!root) return { note: 'No project in this tab. Open one first.' };
    if (typeof brief !== 'string' || !brief.trim() || brief.length > BRIEF_CAP) return { note: 'The loop brief is empty or too long.' };
    prepareLoop(root);
    if (newTab !== true) return { tabId: null };
    const command = `cd ${shellQuote(root)} && ${buildStartCommand(brief)}`;
    if (isSnapshotRun()) testingFixture.loopStarts.push({ command });
    const opened = openTab(event.sender, { command: isSnapshotRun() ? LOOP_STAND_IN : command, background: true });
    if (opened) runTabs.set(`${event.sender.id}:${opened}`, root);
    return { tabId: opened ?? null };
  });

  handle('testing:save-pipeline', async (event, { tabId, pipeline }) => {
    if (!claudeFolderAllowed()) return { note: 'Petal isn’t reading your folders yet.' };
    const root = await projectOf(sessionFor(sessions, event.sender.id, tabId));
    if (!root) return { note: 'No project in this tab.' };
    const clean = cleanPipeline(pipeline, store.load(root).pipeline);
    if (!clean) return { note: 'Each stage needs a name and a one-line command.' };
    store.savePipeline(root, clean);
    return { ok: true };
  });

  // Use it: re-reads and re-checks the file here, never the renderer's copy. New commands still ask before their first run.
  handle('testing:use-claude-pipeline', async (event, { tabId }) => {
    if (!claudeFolderAllowed()) return { note: 'Petal isn’t reading your folders yet.' };
    const root = await projectOf(sessionFor(sessions, event.sender.id, tabId));
    if (!root) return { note: 'No project in this tab.' };
    const claude = validClaudePipeline(root);
    if (!claude) return { note: 'Claude’s .petal/pipeline.json is gone or no longer valid.' };
    store.savePipeline(root, adoptClaudePipeline(store.load(root).pipeline, claude));
    return { ok: true };
  });

  handle('testing:run', async (event, { tabId, stageId = null, confirmed = false }): Promise<RunReply> => {
    if (!claudeFolderAllowed()) return { note: 'Petal isn’t reading your folders yet.' };
    const root = await projectOf(sessionFor(sessions, event.sender.id, tabId));
    if (!root) return { note: 'No project in this tab. Open one first.' };
    if ([...watching.values()].some((w) => w.root === root)) return { note: 'A run is still going for this project.' };
    const data = store.load(root);
    const pipeline = data.pipeline ?? defaultPipeline(proposalFor(root));
    const stages = stageId ? pipeline.stages.filter((s) => s.id === stageId) : pipeline.stages;
    if (!stages.length) return { note: 'There are no stages to run.' };
    const fresh = unconfirmed(pipeline, stages);
    if (fresh.length && !confirmed) return { confirm: { commands: stages.map((s) => ({ name: s.name, command: s.command, isNew: fresh.includes(s) })) } };
    const confirmedNow = [...new Set([...pipeline.confirmed, ...stages.map((s) => normalizeCommand(s.command))])];
    store.savePipeline(root, { ...pipeline, confirmed: confirmedNow });
    return startRun(root, stages, pipeline.keepGoing, event.sender, openTab, 'click');
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

// After a Claude turn: run the pipeline if she turned auto-run on, the turn edited files, every command was
// confirmed before, nothing is running, and no claude on this project is mid-turn. Still a visible new tab.
export async function onTurnFinished(session: TabSession): Promise<void> {
  if (!deps || !claudeFolderAllowed()) return;
  const s = session.feed.session;
  if (!s?.transcript) return;
  const root = await projectOf(session);
  if (!root) return;
  const { edits } = scanLog(s.transcript, s.sessionId);
  const before = editsSeen.get(s.transcript) ?? edits; // the first turn seen only sets the baseline, so a restart never runs it
  editsSeen.set(s.transcript, edits);
  const pipeline = store.load(root).pipeline;
  if (!pipeline?.autoRun || edits <= before || !pipeline.stages.length || unconfirmed(pipeline, pipeline.stages).length) return;
  if ([...watching.values()].some((w) => w.root === root)) return;
  for (const other of deps.sessions.values()) {
    const o = other.feed.session;
    if (o?.status === 'busy' && o.cwd && repoRoot(o.cwd) === root) return;
  }
  const contents = webContents.fromId(session.contentsId);
  if (contents && !contents.isDestroyed()) startRun(root, pipeline.stages, pipeline.keepGoing, contents, deps.openTab, 'auto');
}

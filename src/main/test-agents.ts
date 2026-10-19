// The Testing screen's agents, owned by main. An agent is found only by its session id: its terminal is whichever tab's
// claude reports that session, in any window. Main steps every running loop's bug queue, routes each message to its
// agent (pasted by the window holding its terminal), and resumes an agent with no claude by `claude --resume`, in an
// agent terminal with no tab-bar entry. One open agent per role per task is enforced in claimAgent, and only there.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow, webContents } from 'electron';
import { on, send } from './ipc';
import { claudeFolderAllowed } from './claude-folder';
import * as history from './history';
import * as store from './testing-store';
import { isSnapshotRun, stopWrites, testingFixture } from './snapshot-mode';
import { harnessLine } from './snapshot-shell';
import { buildResumeCommand, buildStartCommand, shellQuote } from './resume-command';
import { claudeLaunch } from './claude-launch';
import { setAgentTitle } from './agent-titles';
import { readCriteria } from './criteria-store';
import { closeAgentSession } from './sessions-ipc';
import { readTail } from './jsonl-window';
import { ReplyCollector } from './replies';
import { keysFor } from './prompt-keys';
import { loopsOf, rememberAgent, saveLoop, saveTestAgents, testAgentsOf, testingData } from './task-suites';
import {
  READY_SETTLE_MS, ROLES, agentBySession, agentState, claimRole, closeAgents, inFlightAgain, openAgent, resumeWhen, sessionOf, stepLoop, terminalOf, unsent, withEvent,
} from '../shared/agent-loop';
import { activeBugs, fixLines, type QueueMessage } from '../shared/bug-queue';
import { isTerminal, latestLoop } from '../shared/loop-line';
import { finishNotice, fixesLanded, fixNotice, type LoopNotice } from '../shared/loop-signals';
import { agentName, agentTabTitle, type AgentNames, type AgentRole } from '../shared/agent-names';
import { ASKING_NOTE } from '../shared/agent-chat';
import { forTask } from '../shared/task-suite';
import { stopAll } from '../shared/test-loop';
import type { AgentCloseResult, AgentPasteOutcome, AgentSendOutcome } from '../shared/ipc';
import type { AgentView, LoopView, PipelineRun, StoredLoop, TestAgent } from '../shared/testing';
import type { Reply } from '../shared/types';
import type { OpenTab, TabSession, TabSessions } from './tab-session';

const TICK_MS = 1500; // every running loop's queue steps this often
const HOST_OPEN_MS = 15_000; // an agent terminal the renderer never started is dropped after this
const STARTING_MS = 120_000; // an agent terminal whose claude never reported the session is closed after this
const PASTE_TIMEOUT_MS = 8000; // a window that never answers a paste counts as gone
const RESUME_TRIES = 3; // per agent per launch, so a session that can't resume never loops
const LOOP_RUNS = 10; // a loop's newest task runs, where a bug's failure output is looked up
const TAIL_BYTES = 2 * 1024 * 1024; // an ended agent's replies are read from the end of its transcript
const TAIL_REPLIES = 50;
const LOOP_STAND_IN = ': petal-loop-start'; // typed in snapshot runs instead of starting claude
const RESUME_STAND_IN = ': petal-resume'; // typed in snapshot runs instead of resuming claude
const EVENT_TEXT = 80;

export interface AgentDeps {
  sessions: TabSessions;
  openTab: OpenTab;
  notify: (notice: LoopNotice, contentsId: number | null) => void;
}

interface Host { contentsId: number; tabId: string; openedAt: number; followed: boolean }
interface Outgoing { root: string; taskId: string; role: AgentRole; text: string; event: string | null; handoff: string | null } // handoff: its queue key

let deps: AgentDeps | null = null;
const hosts = new Map<string, Host>(); // sessionId -> the agent terminal main opened for it
const outbox = new Map<string, Outgoing[]>(); // sessionId -> messages waiting for its claude
const readySince = new Map<string, number>(); // sessionId -> when a terminal first reported it
const delivering = new Set<string>(); // sessionIds mid-paste
const resumeTries = new Map<string, number>();
const eagerTried = new Set<string>(); // agents of running loops already resumed once at launch
const notes = new Map<string, string>(); // sessionId -> why it can't be reached
const askingTabs = new Map<number, Set<string>>(); // contentsId -> its agent terminals showing a prompt
const steppingRoots = new Set<string>(); // projects that may have a running loop
const stepping = new Set<string>(); // `${root}:${taskId}` mid-step
let lastAsker: number | null = null; // the last window whose Testing asked for loops: loaded, so it can open terminals
let rootsScanned = false;

const loopKey = (root: string, taskId: string): string => `${root}:${taskId}`;
const isRunning = (loop: StoredLoop | undefined): loop is StoredLoop => loop?.kind === 'loop' && loop.stoppedAt === null;
const namesOf = (root: string): AgentNames => store.load(root).agentNames ?? {};

// ---- Terminals: found by the session their claude reports, never by a tab id.
interface Terminal { contentsId: number; tabId: string; sessionId: string | null; busy: boolean; tab: TabSession }

const terminals = (): Terminal[] => [...(deps?.sessions.values() ?? [])].map((tab) => ({
  contentsId: tab.contentsId, tabId: tab.tabId, sessionId: tab.feed.session?.sessionId ?? null, busy: tab.feed.session?.status === 'busy', tab,
}));

const terminalFor = (sessionId: string): Terminal | null => terminalOf(terminals(), sessionId);
const isAsking = (terminal: Terminal | null): boolean => Boolean(terminal && askingTabs.get(terminal.contentsId)?.has(terminal.tabId));
const isReady = (sessionId: string): boolean => Date.now() - (readySince.get(sessionId) ?? Infinity) >= READY_SETTLE_MS;

function liveContents(id: number | null | undefined): Electron.WebContents | null {
  const contents = typeof id === 'number' ? webContents.fromId(id) : undefined;
  return contents && !contents.isDestroyed() ? contents : null;
}

// Where a new agent terminal opens: the window that asked, else the last one Testing ran in, else any.
const windowFor = (preferred: number | null): Electron.WebContents | null =>
  liveContents(preferred) ?? liveContents(lastAsker) ?? BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())?.webContents ?? null;

// ---- The registry. The one place an agent is started: the task's open agent in that role is returned instead.
export interface Claim { agent: TestAgent; created: boolean }
export interface ClaimRequest { taskId: string; taskTitle: string; role: AgentRole; brief: string; preferred: number | null }

export async function claimAgent(root: string, { taskId, taskTitle, role, brief, preferred }: ClaimRequest): Promise<Claim | { note: string }> {
  const open = openAgent(testAgentsOf(root), taskId, role);
  if (open) return { agent: open, created: false };
  const contents = windowFor(preferred);
  if (!contents) return { note: 'Open a Petal window first.' };
  const sessionId = (isSnapshotRun() && testingFixture.agentIds.shift()) || crypto.randomUUID();
  const claim = claimRole(testAgentsOf(root), { sessionId, taskId, role, cwd: root, startedAt: Date.now(), closedAt: null });
  saveTestAgents(root, claim.agents);
  rememberAgent(root, taskId, sessionId, role);
  setAgentTitle(sessionId, agentTabTitle(namesOf(root), role, taskTitle));
  const command = `cd ${shellQuote(root)} && ${buildStartCommand(brief, `${(await claudeLaunch()).command} --session-id ${sessionId}`)}`;
  if (isSnapshotRun()) testingFixture.loopStarts.push({ command, brief });
  openHost(contents, sessionId, isSnapshotRun() ? harnessLine(LOOP_STAND_IN) : command);
  steppingRoots.add(root);
  return { agent: claim.agent, created: true };
}

function openHost(contents: Electron.WebContents, sessionId: string, command: string): void {
  const tabId = deps?.openTab(contents, { command, agent: true });
  if (tabId) hosts.set(sessionId, { contentsId: contents.id, tabId, openedAt: Date.now(), followed: false });
}

export const findAgent = (root: string, sessionId: unknown): TestAgent | null =>
  (typeof sessionId === 'string' ? agentBySession(testAgentsOf(root), sessionId) : null);

// ---- What a window shows.
export function agentView(root: string, agent: TestAgent, contentsId: number, names: AgentNames = namesOf(root)): AgentView {
  const terminal = agent.closedAt === null ? terminalFor(agent.sessionId) : null;
  const host = hosts.get(agent.sessionId);
  const starting = Boolean(host && !host.followed);
  const at = terminal ?? (starting ? host : null);
  return {
    ...agent, name: agentName(names, agent.role),
    state: agentState(agent, { running: terminal ? { busy: terminal.busy } : null, asking: isAsking(terminal), starting }),
    hostTabId: at?.contentsId === contentsId ? at.tabId : null,
    hostElsewhere: Boolean(at && at.contentsId !== contentsId),
    note: notes.get(agent.sessionId) ?? null,
  };
}

export function loopView(root: string, loop: StoredLoop, contentsId: number): LoopView {
  const agents = testAgentsOf(root);
  const names = namesOf(root);
  const view = (role: AgentRole): AgentView | null => {
    const agent = agentBySession(agents, sessionOf(loop, role));
    return agent ? agentView(root, agent, contentsId, names) : null;
  };
  const { testerSessionId: _tester, fixerSessionId: _fixer, ...rest } = loop;
  return { ...rest, tester: view('tester'), fixer: view('fixer') };
}

// A window whose Testing asked for loops has loaded, so main can open agent terminals in it.
export const windowReady = (contentsId: number): void => { lastAsker = contentsId; };

// The loops a window lists: running ones, ones with an agent at work, and the ones it asked about.
export function listedLoops(known: readonly { root: string; taskId: string }[], contentsId: number): { root: string; taskId: string; loop: LoopView }[] {
  const asked = new Set(known.map((k) => loopKey(k.root, k.taskId)));
  const roots = new Set([...steppingRoots, ...known.map((k) => k.root), ...[...outbox.values()].flatMap((list) => list.map((o) => o.root))]);
  const listed: { root: string; taskId: string; loop: LoopView }[] = [];
  for (const root of roots) {
    for (const [taskId, loop] of Object.entries(loopsOf(root))) {
      const view = loopView(root, loop, contentsId);
      const active = [view.tester, view.fixer].some((a) => a && a.state !== 'ended' && a.state !== 'closed');
      if (isRunning(loop) || active || asked.has(loopKey(root, taskId))) listed.push({ root, taskId, loop: view });
    }
  }
  return listed;
}

// ---- Sending to an agent: queued in main, pasted once its claude is ready, resumed first when none runs it.
export async function sendToAgent(root: string, agent: TestAgent, text: string, event: string | null, preferred: number | null): Promise<{ outcome: AgentSendOutcome } | { note: string }> {
  if (agent.closedAt !== null) return { note: 'That agent was closed. Start a new one.' };
  const terminal = terminalFor(agent.sessionId);
  if (isAsking(terminal)) return { note: ASKING_NOTE };
  const problem = terminal || hosts.has(agent.sessionId) ? null : resumeProblem(agent);
  if (problem) return { note: problem };
  enqueue({ root, taskId: agent.taskId, role: agent.role, text, event, handoff: null }, agent.sessionId);
  if (!terminal) {
    const failed = await resume(root, agent, preferred);
    return failed ? { note: failed } : { outcome: 'resuming' };
  }
  return { outcome: (await pump(agent.sessionId)) ? 'sent' : 'queued' };
}

// Open terminal: an ended agent resumes with no message.
export async function openAgentTerminal(root: string, agent: TestAgent, preferred: number): Promise<string | null> {
  if (agent.closedAt !== null) return 'That agent was closed. Start a new one.';
  return terminalFor(agent.sessionId) ? null : resume(root, agent, preferred);
}

function enqueue(message: Outgoing, sessionId: string): void {
  outbox.set(sessionId, [...(outbox.get(sessionId) ?? []), message]);
}

// The first waiting message goes out once its claude has been ready a moment and isn't asking her anything.
async function pump(sessionId: string): Promise<boolean> {
  const next = outbox.get(sessionId)?.[0];
  const terminal = terminalFor(sessionId);
  if (!next || !terminal || delivering.has(sessionId) || !isReady(sessionId) || isAsking(terminal)) return false;
  delivering.add(sessionId);
  try {
    if ((await pasteVia(terminal, next.text)) !== 'sent') return false;
    outbox.set(sessionId, (outbox.get(sessionId) ?? []).filter((m) => m !== next));
    if (next.event) addEvent(next.root, next.taskId, next.role, next.event);
    return true;
  } finally {
    delivering.delete(sessionId);
  }
}

const waitingPastes = new Map<number, { contentsId: number; done: (outcome: AgentPasteOutcome) => void }>();
let nextPaste = 0;

// The window holding the terminal pastes through the reply box's path, which refuses while a prompt is on screen.
function pasteVia(terminal: Terminal, text: string): Promise<AgentPasteOutcome> {
  const contents = liveContents(terminal.contentsId);
  if (!contents) return Promise.resolve('gone');
  const requestId = ++nextPaste;
  return new Promise((resolve) => {
    const timer = setTimeout(() => { waitingPastes.delete(requestId); resolve('gone'); }, PASTE_TIMEOUT_MS);
    waitingPastes.set(requestId, { contentsId: contents.id, done: (outcome) => { clearTimeout(timer); waitingPastes.delete(requestId); resolve(outcome); } });
    send(contents, 'testing:agent-paste', { requestId, tabId: terminal.tabId, text });
  });
}

function addEvent(root: string, taskId: string, role: AgentRole, text: string): void {
  const loop = loopsOf(root)[taskId];
  if (loop) saveLoop(root, taskId, { ...loop, events: withEvent(loop.events, role, text, Date.now()) });
}

export const herEvent = (name: string, text: string): string => `You → ${name}: ${text.trim().slice(0, EVENT_TEXT)}`;

// ---- Resume: the same session id in its own folder. Never --fork-session, never into a session running elsewhere.
async function resume(root: string, agent: TestAgent, preferred: number | null): Promise<string | null> {
  if (hosts.has(agent.sessionId)) return null; // already starting
  const problem = resumeProblem(agent);
  if (problem) { notes.set(agent.sessionId, problem); return problem; }
  const contents = windowFor(preferred);
  if (!contents) return 'Open a Petal window first.';
  resumeTries.set(agent.sessionId, (resumeTries.get(agent.sessionId) ?? 0) + 1);
  notes.delete(agent.sessionId);
  await reopenInFlight(root, agent);
  const command = isSnapshotRun() ? harnessLine(RESUME_STAND_IN) : buildResumeCommand(agent.cwd, agent.sessionId, (await claudeLaunch()).command);
  openHost(contents, agent.sessionId, command);
  return null;
}

function resumeProblem(agent: TestAgent): string | null {
  if ((resumeTries.get(agent.sessionId) ?? 0) >= RESUME_TRIES) return 'Its session didn’t come back after a few tries. Open it from History instead.';
  if (history.isLive(agent.sessionId)) return 'Its session is running in another terminal. Close it there first.';
  if (!isSnapshotRun() && !history.findRecord(agent.sessionId)) return 'Its session is no longer on disk.';
  return null;
}

// A claude that died mid-handoff never finishes it: after reading what its transcript already says, what was in
// flight to it goes back in the queue, and the old copy waiting here is dropped.
async function reopenInFlight(root: string, agent: TestAgent): Promise<void> {
  if (!isRunning(loopsOf(root)[agent.taskId])) return;
  await stepTask(root, agent.taskId);
  const loop = loopsOf(root)[agent.taskId];
  if (!isRunning(loop) || sessionOf(loop, agent.role) !== agent.sessionId) return;
  outbox.set(agent.sessionId, (outbox.get(agent.sessionId) ?? []).filter((m) => m.handoff === null));
  saveLoop(root, agent.taskId, { ...loop, queue: inFlightAgain(loop.queue, agent.role) });
}

// ---- Replies: the live terminal's, else the end of its transcript, so a fix that landed while Petal was closed counts.
const tailCache = new Map<string, { mtimeMs: number; size: number; replies: Reply[] }>();

export function transcriptReplies(file: string): Reply[] {
  let stat: fs.Stats;
  try { stat = fs.statSync(file); } catch { return []; }
  const cached = tailCache.get(file);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.replies;
  const collector = new ReplyCollector(TAIL_REPLIES);
  for (const entry of readTail(file, TAIL_BYTES).entries) collector.add(entry);
  const replies = collector.newestFirst();
  tailCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, replies });
  return replies;
}

export function repliesOf(sessionId: string | null): readonly Reply[] {
  if (!sessionId) return [];
  const terminal = terminalFor(sessionId);
  if (terminal) return terminal.tab.feed.shownReplies;
  const file = history.findRecord(sessionId)?.file;
  return file ? transcriptReplies(file) : [];
}

// ---- Stepping: one queue step per running loop; handoffs join the outbox of the agent they're for.
async function stepTask(root: string, taskId: string): Promise<void> {
  const key = loopKey(root, taskId);
  const before = loopsOf(root)[taskId];
  if (!isRunning(before) || !before.fixerSessionId || stepping.has(key)) return;
  stepping.add(key);
  try {
    const testerReplies = repliesOf(before.testerSessionId);
    const fixerReplies = repliesOf(before.fixerSessionId);
    const loop = loopsOf(root)[taskId]; // read again after the reads, so a bug she sent meanwhile is kept
    if (!isRunning(loop) || !loop.fixerSessionId) return;
    const progress = latestLoop(testerReplies, loop.startedAt);
    const names = namesOf(root);
    const testerHost = hostOf(loop.testerSessionId);
    if (progress && isTerminal(progress.phase) && !activeBugs(loop.queue).length) {
      saveLoop(root, taskId, { ...loop, stoppedAt: Date.now() });
      deps?.notify(finishNotice(loop.queue, testerHost?.tabId ?? null), testerHost?.contentsId ?? null);
      return;
    }
    const role = { tester: agentName(names, 'tester'), fixer: agentName(names, 'fixer') };
    const data = store.load(root);
    const runs: PipelineRun[] = forTask(data.runs, taskId).slice(0, LOOP_RUNS);
    const result = stepLoop(loop, {
      bugs: loop.testerSessionId ? forTask(readCriteria(root)?.bugs ?? [], taskId) : [], runs, testerRound: progress?.round ?? 0,
      fixerBusy: Boolean(terminalFor(loop.fixerSessionId)?.busy), fixesDone: fixLines(fixerReplies, loop.startedAt), now: Date.now(),
    }, role);
    let queue = result.queue;
    for (const message of result.send) queue = handOver(root, taskId, loop, message) ? queue : unsent(queue, message);
    if (JSON.stringify([queue, result.events]) === JSON.stringify([loop.queue, loop.events])) return;
    saveLoop(root, taskId, { ...loop, queue, events: result.events });
    const fixerHost = hostOf(loop.fixerSessionId);
    for (const bug of fixesLanded(loop.queue, queue)) deps?.notify(fixNotice(bug, role.fixer, fixerHost?.tabId ?? null), fixerHost?.contentsId ?? null);
  } finally {
    stepping.delete(key);
  }
}

// False when the loop has no agent in that role to take it.
function handOver(root: string, taskId: string, loop: StoredLoop, message: QueueMessage): boolean {
  const sessionId = sessionOf(loop, message.to);
  if (!sessionId) return false;
  enqueue({ root, taskId, role: message.to, text: message.text, event: null, handoff: message.key }, sessionId);
  return true;
}

const hostOf = (sessionId: string | null): { contentsId: number; tabId: string } | null => {
  if (!sessionId) return null;
  return terminalFor(sessionId) ?? hosts.get(sessionId) ?? null;
};

// ---- The timer: terminals checked, running loops stepped, waiting messages pasted or their agents resumed.
async function tick(): Promise<void> {
  if (!claudeFolderAllowed()) return; // nothing is read or resumed before she allows it
  scanRoots();
  checkHosts();
  for (const root of [...steppingRoots]) {
    const running = Object.entries(loopsOf(root)).filter(([, loop]) => isRunning(loop));
    if (!running.length) { steppingRoots.delete(root); continue; }
    for (const [taskId, loop] of running) {
      await resumeAtLaunch(root, loop);
      await stepTask(root, taskId);
    }
  }
  for (const [sessionId, messages] of outbox) {
    if (!messages.length) { outbox.delete(sessionId); continue; }
    if (terminalFor(sessionId)) { void pump(sessionId); continue; }
    const agent = findAgent(messages[0].root, sessionId);
    if (!agent || agent.closedAt !== null || (await resume(messages[0].root, agent, null))) outbox.delete(sessionId); // the lane's note says why
  }
}

// After a quit or reload, a running loop's agents come back on their own, once each, into a window that has loaded.
async function resumeAtLaunch(root: string, loop: StoredLoop): Promise<void> {
  if (lastAsker === null) return;
  for (const role of ROLES) {
    const agent = findAgent(root, sessionOf(loop, role));
    if (!agent || eagerTried.has(agent.sessionId) || resumeWhen(agent, loop) !== 'at-launch') continue;
    eagerTried.add(agent.sessionId);
    if (!terminalFor(agent.sessionId)) await resume(root, agent, null);
  }
}

// An agent terminal whose claude never came up, or has exited, is closed: it has no tab-bar entry to close it from.
function checkHosts(): void {
  const now = Date.now();
  for (const terminal of terminals()) {
    if (terminal.sessionId && !readySince.has(terminal.sessionId)) readySince.set(terminal.sessionId, now);
  }
  const following = new Set(terminals().flatMap((t) => (t.sessionId ? [t.sessionId] : [])));
  for (const sessionId of readySince.keys()) if (!following.has(sessionId)) readySince.delete(sessionId);
  for (const [sessionId, host] of hosts) {
    const tab = deps?.sessions.get(`${host.contentsId}:${host.tabId}`);
    if (!tab) { if (host.followed || now - host.openedAt > HOST_OPEN_MS) hosts.delete(sessionId); continue; }
    if (tab.feed.session?.sessionId === sessionId) { host.followed = true; resumeTries.delete(sessionId); continue; }
    if (!host.followed && now - host.openedAt < STARTING_MS) continue;
    hosts.delete(sessionId);
    if (tab.agent) tab.pty.kill();
  }
}

// Projects with a running loop, read once from the testing store after launch.
function scanRoots(): void {
  if (rootsScanned) return;
  rootsScanned = true;
  let files: string[];
  try { files = fs.readdirSync(store.testingDir()).filter((f) => f.endsWith('.json')); } catch { return; }
  for (const file of files) {
    try {
      const root = (JSON.parse(fs.readFileSync(path.join(store.testingDir(), file), 'utf8')) as { root?: unknown }).root;
      if (typeof root === 'string' && Object.values(testingData(root).loops ?? {}).some(isRunning)) steppingRoots.add(root);
    } catch { /* an unreadable store is skipped */ }
  }
}

export const watchRoot = (root: string): void => { steppingRoots.add(root); };

// ---- Stop and Close.
export function stopTaskLoop(root: string, taskId: string): string | null {
  const loop = loopsOf(root)[taskId];
  if (!isRunning(loop)) return 'The loop isn’t running.';
  const now = Date.now();
  saveLoop(root, taskId, { ...loop, stoppedAt: now, events: ROLES.reduce((events, role) => (sessionOf(loop, role) ? withEvent(events, role, 'Stopped', now) : events), loop.events) });
  const running = ROLES.flatMap((role) => { const id = sessionOf(loop, role); return id ? [id] : []; });
  for (const sessionId of running) outbox.set(sessionId, (outbox.get(sessionId) ?? []).filter((m) => m.handoff === null));
  void stopAll(running.filter((id) => terminalFor(id)).map((sessionId) => ({
    sendEsc: () => interrupt(sessionId),
    isIdle: () => !terminalFor(sessionId)?.busy,
    send: async (text: string) => { const terminal = terminalFor(sessionId); return terminal ? pasteVia(terminal, text) : 'gone'; },
    sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  })));
  return null;
}

// Esc to a working claude only: on an idle one it would clear what is typed.
function interrupt(sessionId: string): void {
  const terminal = terminalFor(sessionId);
  const keys = keysFor({ kind: 'interrupt' });
  if (!terminal?.busy || !keys) return;
  if (isSnapshotRun()) stopWrites.push({ tabId: terminal.tabId, keys });
  else keys.forEach((key) => terminal.tab.pty.write(key));
}

// Each open agent's claude closed through the Sessions panel's Close, its agent terminal closed, its record closed.
export async function closeTaskAgents(root: string, taskId: string): Promise<{ closed: AgentCloseResult[] } | { note: string }> {
  const open = testAgentsOf(root).filter((a) => a.taskId === taskId && a.closedAt === null);
  if (!open.length) return { note: 'This task has no agents to close.' };
  const loop = loopsOf(root)[taskId];
  if (isRunning(loop) && open.some((a) => terminalFor(a.sessionId)?.busy)) return { note: 'An agent is still working. Stop the loop first.' };
  const closed: AgentCloseResult[] = [];
  for (const agent of open) closed.push(await closeAgentSession(agent.sessionId));
  const done = closed.filter((c) => c.outcome !== 'running').map((c) => c.sessionId);
  for (const sessionId of done) forgetTerminal(sessionId);
  saveTestAgents(root, closeAgents(testAgentsOf(root), done, Date.now()));
  const now = Date.now();
  const after = loopsOf(root)[taskId];
  if (after) {
    const events = ROLES.reduce((list, role) => (done.includes(sessionOf(after, role) ?? '') ? withEvent(list, role, 'Closed', now) : list), after.events);
    saveLoop(root, taskId, { ...after, stoppedAt: after.stoppedAt ?? now, events });
  }
  return { closed };
}

function forgetTerminal(sessionId: string): void {
  outbox.delete(sessionId);
  notes.delete(sessionId);
  hosts.delete(sessionId);
  for (const terminal of terminals()) if (terminal.tab.agent && terminal.sessionId === sessionId) terminal.tab.pty.kill();
}

// ---- Wiring: the timer, and the windows' answers.
export function startTestAgents(given: AgentDeps): void {
  deps = given;
  setInterval(() => void tick().catch((error: Error) => console.error('[petal] testing agents tick failed:', error)), TICK_MS);
  on('testing:agent-pasted', (event, reply) => {
    const waiting = waitingPastes.get(reply?.requestId);
    const outcome = reply?.outcome;
    if (waiting && waiting.contentsId === event.sender.id && (outcome === 'sent' || outcome === 'asking' || outcome === 'gone')) waiting.done(outcome);
  });
  on('testing:agent-asking', (event, report) => {
    const tabIds = Array.isArray(report?.tabIds) ? report.tabIds.filter((id): id is string => typeof id === 'string') : [];
    askingTabs.set(event.sender.id, new Set(tabIds));
  });
}

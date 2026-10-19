// Testing, organised by task: each task owns its suite of stages (typecheck, unit, e2e, mobile flows...), its results
// grouped by file with failures first, its run history with a trend, its test loop and criteria. A PRD shows an overview.
// Nothing runs without her click; the first run of any command asks first, and runs go in a new visible tab.
import * as overlays from './overlays';
import * as tabs from './tabs';
import * as composer from './composer';
import { byId, el, isIpcError } from './dom';
import { OPEN_TEST_RUN_EVENT } from './conclusion-banner';
import { historyList, pipelineStrip, stackList, stageResults, trend } from './testing-view';
import { historyDays, stagesFromRuns, type RunRow } from '../shared/testing-history';
import { createLoopPanel, type LoopModel } from './testing-loop-view';
import { buildFixPrompt, slugId, type PipelineRun, type StackItem, type StageResult, type TestCase, type TestingState } from '../shared/testing';
import { isActive, type Criteria } from '../shared/test-loop';
import { bySession, mergeRecords, recordsFromReplies, type DistillRecord } from '../shared/distillation';
import { suiteHealth, withCoreStage } from '../shared/suite-health';
import { distillSection } from './testing-distill-view';
import { healthPanel } from './testing-health-view';
import { createAgents } from './testing-agents';
import { lockBar, noSuite, noTasks, prdOverview, sessionPicker, suiteChangeLine, taskPicker } from './testing-tasks-view';
import { agentName } from '../shared/agent-names';
import { prdOf } from '../shared/test-scope';
import { forTask, suiteFor, suitePath, type SuiteFor, type TaskSuite } from '../shared/task-suite';
import { keepTarget, prdOverview as overviewRows, type TestTarget } from '../shared/task-testing';
import type { Prd, Task } from '../shared/tasks';

const POLL_MS = 4000; // picks up Claude's runs from the session log while the tab is open
const LOOP_POLL_MS = 1500; // a running loop's Loop line and criteria refresh faster

const view = byId('testing');
view.tabIndex = -1;

const head = el('header', 'tst-head');
const title = el('h2', 'tst-title', 'Testing');
const summary = el('p', 'tst-summary');
const tools = el('div', 'tst-tools-bar');
const editButton = el('button', 'tst-button', 'Edit suite');
editButton.type = 'button';
editButton.title = 'This task’s stages';
const runButton = el('button', 'tst-button tst-primary', 'Run suite');
runButton.type = 'button';
tools.append(editButton, runButton);
head.append(title, summary, tools);

const pickerBox = el('div', 'tst-pickerbox');
const changeBox = el('div', 'tst-changebox');
const note = el('div', 'tst-note');
note.setAttribute('role', 'status');
const confirmBox = el('div', 'tst-confirm');
confirmBox.setAttribute('role', 'alertdialog');
confirmBox.setAttribute('aria-label', 'Confirm the commands to run');
const strip = el('div', 'tst-strip');
const editor = el('div', 'tst-editor');
const body = el('div', 'tst-body');
const results = el('section', 'tst-results');
results.setAttribute('aria-label', 'Results');
const side = el('aside', 'tst-side');
const historyBox = el('section', 'tst-history');
historyBox.setAttribute('aria-label', 'History');
const healthBox = el('section', 'tst-healthbox');
healthBox.setAttribute('aria-label', 'Suite health');
const stackBox = el('section', 'tst-stackbox');
stackBox.setAttribute('aria-label', 'What this project tests with');
side.append(historyBox, healthBox, stackBox);
body.append(results, side);
const loopPanel = createLoopPanel({ start: (focus, rounds) => void startLoop(focus, rounds), stop: () => void stopCurrentLoop(), askThread: (prompt) => void askThread(loopTabId(), prompt, 'loop') });
view.append(head, pickerBox, changeBox, note, confirmBox, loopPanel.element, strip, editor, body);

// ---- State, per window.
let data: TestingState | null = null;
let sourceTab: string | null = null; // the tab whose project this shows; a run's own new tab doesn't change it
let selectedRun: string | null = null; // null: the latest result of each stage
let selectedStage: string | null = null;
let draft: TaskSuite | null = null; // set while editing the shown task's suite
let confirming: { stageId: string | null; commands: { name: string; command: string; isNew: boolean }[] } | null = null;
let message = '';
let folderAllowed = true;
let poll: ReturnType<typeof setInterval> | null = null;
const pickedFor = new Map<string, string>(); // tab id -> the repo of the session she picked there, when the tab is in ~ or outside a repo
const expanded = new Set<string>(); // history rows opened to their repeats or other commands
let criteria: Criteria | null = null;
let distillation: DistillRecord[] = []; // the project's stored rounds, from .petal/distillation.jsonl
let loopNote = '';
let loopTick: ReturnType<typeof setInterval> | null = null;
let target: TestTarget | null = null; // the task or PRD shown; follows the session's task until she picks
let targetPicked = false;

export const isOpen = (): boolean => overlays.isOpen('testing');
const picked = (): string | null => (sourceTab ? pickedFor.get(sourceTab) ?? null : null);
const runById = (id: string | null): PipelineRun | null => data?.runs.find((r) => r.id === id) ?? null;

// ---- The shown task: its suite (or its parent's), and only its own runs, criteria and rounds.
const shownTask = (): Task | null => (target?.kind === 'task' ? data?.tasks.find((t) => t.id === target?.id) ?? null : null);
const shownPrd = (): Prd | null => {
  const id = target?.kind === 'prd' ? target.id : prdOf(data?.tasks ?? [], shownTask());
  return data?.prds.find((p) => p.id === id) ?? null;
};
const runsWith = (): SuiteFor | null => (data ? suiteFor(data.tasks, data.suites, shownTask()?.id ?? null) : null);
const suite = (): TaskSuite | null => runsWith()?.suite ?? null;
const taskId = (): string | null => shownTask()?.id ?? null;
const taskRuns = (): PipelineRun[] => forTask(data?.runs ?? [], taskId());
const taskDistillation = (): DistillRecord[] => forTask(distillation, taskId());
function taskCriteria(): Criteria | null {
  if (!criteria) return null;
  return { ...criteria, scenarios: forTask(criteria.scenarios, taskId()), bugs: forTask(criteria.bugs, taskId()) };
}

function followSessionTask(): void {
  if (!data) return;
  target = keepTarget(targetPicked ? target : null, data, data.sessionTaskId);
}

function pick(next: TestTarget): void {
  target = next;
  targetPicked = true;
  selectedRun = null;
  selectedStage = null;
  draft = null;
  confirming = null;
  message = '';
  drawAll();
  pickerBox.querySelector<HTMLElement>('.tst-task-select')?.focus();
}

function drawPicker(): void {
  pickerBox.replaceChildren();
  pickerBox.hidden = !folderAllowed || !data?.project || !target;
  if (data?.project && target) pickerBox.append(taskPicker(data, target, pick));
}

// The testing agent's last change to this task's suite, with Undo, or why its file was not taken; then the test lock.
function drawChange(): void {
  changeBox.replaceChildren();
  const id = taskId();
  if (!data?.project || !id || draft) { changeBox.hidden = true; return; }
  const own = data.suites[id];
  const line = own ? suiteChangeLine(own.change, own.problem, () => void undoChange()) : null;
  if (line) changeBox.append(line);
  const restored = data.lock.restored.filter((f) => f.taskId === id);
  changeBox.append(lockBar(data.lock, restored, agentName(data.agentNames, 'fixer'), { toggle: (on) => void toggleLock(on), dismiss: () => void dismissRestored() }, false));
  changeBox.hidden = false;
}

// The newest result for a stage, from the chosen run or across all runs (Claude's land on their matching stage).
function resultOf(stageId: string): { stage: StageResult; run: PipelineRun } | null {
  const runs = selectedRun ? [runById(selectedRun)].filter((r): r is PipelineRun => r !== null) : taskRuns();
  for (const run of runs) {
    const stage = run.stages.find((s) => s.stageId === stageId);
    if (stage) return { stage, run };
  }
  return null;
}

// The stage the results pane shows: the chosen one, else the first failed, else the first.
function shownStage(): { stage: StageResult; run: PipelineRun } | null {
  const run = runById(selectedRun);
  if (run && !run.stages.some((s) => suite()?.stages.some((p) => p.id === s.stageId))) return run.stages[0] ? { stage: run.stages[0], run } : null;
  const stages = suite()?.stages ?? [];
  const id = selectedStage ?? stages.find((s) => resultOf(s.id)?.stage.status === 'failed')?.id ?? stages[0]?.id ?? null;
  return id ? resultOf(id) : null;
}

// ---- Drawing.
// Names the task and its PRD, or the PRD for its overview.
function headLine(): string {
  const task = shownTask();
  const prd = shownPrd();
  if (target?.kind === 'prd') return prd ? `PRD · ${prd.title}` : '';
  if (!task) return '';
  const s = runsWith();
  const stages = s ? `${s.suite.stages.length} stage${s.suite.stages.length === 1 ? '' : 's'}` : 'No suite yet';
  const borrowed = s && s.owner.id !== task.id ? ` from ${s.owner.title}` : '';
  return [task.title, prd ? `PRD ${prd.title}` : 'No PRD', `${stages}${borrowed}`, s?.suite.keepGoing ? 'keeps going after a failure' : '', s?.suite.autoRun ? 'runs after Claude’s edits' : ''].filter(Boolean).join(' · ');
}

function drawHead(): void {
  const p = suite();
  const onTask = Boolean(shownTask());
  summary.replaceChildren(data?.project ? headLine() : '');
  if (data?.project && picked()) {
    const change = el('button', 'tst-link tst-change-session', 'Change session');
    change.type = 'button';
    change.addEventListener('click', () => { if (sourceTab) pickedFor.delete(sourceTab); target = null; targetPicked = false; selectedRun = null; selectedStage = null; void load(); });
    summary.append(' · ', change);
  }
  const busy = Boolean(data?.running);
  tools.hidden = !onTask;
  runButton.disabled = !p?.stages.length || busy || draft !== null;
  runButton.textContent = busy ? 'Running…' : 'Run suite';
  editButton.disabled = !onTask || draft !== null;
}

function drawNote(): void {
  note.replaceChildren();
  if (!folderAllowed) {
    const allow = el('button', 'tst-link', 'Allow');
    allow.type = 'button';
    allow.addEventListener('click', () => window.dispatchEvent(new Event('petal:allow-folder')));
    note.append(el('span', null, 'Petal needs to read your folders to see what this project tests with.'), allow);
  } else if (message) {
    note.append(el('span', null, message));
  }
  const running = runById(data?.running ?? null);
  if (running) {
    const stop = el('button', 'tst-link', 'Stop watching');
    stop.type = 'button';
    stop.title = 'Stop the run in its tab with Ctrl+C first; this only stops Petal waiting for it';
    stop.addEventListener('click', () => void window.pastel.testing.stop(running.id).then(refresh));
    note.append(el('span', null, 'Running in a new tab. Press Ctrl+C there to stop it.'), stop);
  }
  note.hidden = !note.childElementCount;
}

function drawConfirm(): void {
  confirmBox.replaceChildren();
  confirmBox.hidden = !confirming;
  if (!confirming) return;
  const list = el('ol', 'tst-confirm-list');
  for (const c of confirming.commands) {
    const item = el('li');
    item.append(el('span', 'tst-confirm-name', c.name), el('code', null, c.command));
    if (c.isNew) item.append(el('span', 'tst-new', 'new'));
    list.append(item);
  }
  const go = el('button', 'tst-button tst-primary tst-confirm-run', confirming.commands.length > 1 ? 'Run these' : 'Run it');
  go.type = 'button';
  const cancel = el('button', 'tst-button', 'Cancel');
  cancel.type = 'button';
  const target = confirming.stageId;
  go.addEventListener('click', () => { confirming = null; void run(target, true); });
  cancel.addEventListener('click', () => { confirming = null; drawAll(); runButton.focus(); });
  const actions = el('div', 'tst-actions');
  actions.append(go, cancel);
  confirmBox.append(
    el('p', 'tst-confirm-title', `Run ${confirming.commands.length > 1 ? 'these commands' : 'this command'} in a new tab?`),
    list,
    el('p', 'tst-muted', 'They run in the repo folder, in order. Petal adds a report flag where the runner has one and keeps the output in its own folder. You confirm each command once.'),
    actions,
  );
  go.focus();
}

function startDraft(next: TaskSuite, note = ''): void {
  draft = { ...next, stages: next.stages.map((s) => ({ ...s })) };
  confirming = null;
  message = note;
  drawAll();
  editor.querySelector<HTMLInputElement>('.tst-edit-name')?.focus();
}

function drawStrip(): void {
  strip.replaceChildren();
  const task = shownTask();
  if (!data?.project || !task) return;
  const p = suite();
  if (!p) {
    if (draft) return;
    const fromClaude = stagesFromRuns(taskRuns());
    strip.append(noSuite({
      askClaude: () => void askForSuite(task),
      seed: data.seed && 'stages' in data.seed ? () => void seedSuite() : null,
      edit: () => startDraft({ stages: [], keepGoing: false, autoRun: false }),
      fromRuns: fromClaude.length ? () => startDraft({ stages: fromClaude, keepGoing: false, autoRun: false }, 'Check the commands, then save. Each one still asks before its first run.') : null,
    }, data.seed && 'problem' in data.seed ? data.seed.problem : null, Boolean(data.running)));
    return;
  }
  const current = shownStage();
  strip.append(pipelineStrip(p, (id) => resultOf(id)?.stage ?? null, current?.stage.stageId ?? null, {
    select: (id) => { selectedStage = id; drawAll(); strip.querySelector<HTMLElement>(`[data-stage="${id}"]`)?.focus(); },
    runStage: (id) => void run(id, false),
  }, Boolean(data.running) || draft !== null));
}

function drawEditor(): void {
  editor.replaceChildren();
  editor.hidden = !draft;
  if (!draft) return;
  const d = draft;
  const rows = el('ol', 'tst-edit-rows');
  d.stages.forEach((stage, i) => {
    const row = el('li', 'tst-edit-row');
    const name = el('input', 'tst-input tst-edit-name');
    Object.assign(name, { value: stage.name, spellcheck: false });
    name.setAttribute('aria-label', `Stage ${i + 1} name`);
    name.addEventListener('input', () => { stage.name = name.value; });
    const command = el('input', 'tst-input tst-edit-command');
    Object.assign(command, { value: stage.command, spellcheck: false });
    command.setAttribute('aria-label', `Stage ${i + 1} command`);
    command.addEventListener('input', () => { stage.command = command.value; });
    const move = (delta: number, label: string, text: string) => {
      const b = el('button', 'tst-icon', text);
      b.type = 'button';
      b.setAttribute('aria-label', `Move ${stage.name || 'stage'} ${label}`);
      b.disabled = i + delta < 0 || i + delta >= d.stages.length;
      b.addEventListener('click', () => { d.stages.splice(i, 1); d.stages.splice(i + delta, 0, stage); drawEditor(); });
      return b;
    };
    const remove = el('button', 'tst-icon', '×');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Remove ${stage.name || 'stage'}`);
    remove.addEventListener('click', () => { d.stages.splice(i, 1); drawEditor(); });
    row.append(el('span', 'tst-edit-num', String(i + 1)), name, command, move(-1, 'up', '↑'), move(1, 'down', '↓'), remove);
    rows.append(row);
  });
  const add = el('button', 'tst-button', 'Add stage');
  add.type = 'button';
  add.addEventListener('click', () => {
    d.stages.push({ id: slugId('stage', d.stages.map((s) => s.id)), name: 'New stage', command: '' });
    drawEditor();
    editor.querySelector<HTMLInputElement>('.tst-edit-row:last-child .tst-edit-name')?.select();
  });
  const reset = el('button', 'tst-button', 'Use detected stages');
  reset.type = 'button';
  reset.disabled = !data?.proposed.length;
  reset.addEventListener('click', () => { d.stages = (data?.proposed ?? []).map((s) => ({ ...s })); drawEditor(); });
  const task = shownTask();
  const owner = runsWith()?.owner;
  const borrowed = task && owner && owner.id !== task.id;
  const toggle = (label: string, key: 'keepGoing' | 'autoRun', hint: string) => {
    const wrap = el('label', 'tst-toggle');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = d[key];
    box.addEventListener('change', () => { d[key] = box.checked; });
    wrap.append(box, el('span', null, label), el('span', 'tst-muted', hint));
    return wrap;
  };
  const save = el('button', 'tst-button tst-primary', 'Save suite');
  save.type = 'button';
  save.addEventListener('click', () => void saveSuite());
  const cancel = el('button', 'tst-button', 'Cancel');
  cancel.type = 'button';
  cancel.addEventListener('click', () => { draft = null; message = ''; drawAll(); editButton.focus(); });
  const lineA = el('div', 'tst-actions');
  lineA.append(add, reset);
  const lineB = el('div', 'tst-actions');
  lineB.append(save, cancel);
  editor.append(
    el('h3', 'tst-section-title', `Edit the suite for ${task?.title ?? 'this task'}`),
    el('p', 'tst-muted', borrowed ? `Saving gives this subtask its own suite. ${owner.title} keeps its own.` : 'Stages run in order in one new tab, each a shell command in the repo folder. Save with no stages to remove the suite.'),
    rows, lineA,
    toggle('Keep going after a failure', 'keepGoing', 'Otherwise the suite stops at the first failed stage.'),
    toggle('Run this suite when Claude finishes a turn on this task that changed files', 'autoRun', 'Off by default. Only commands you already confirmed, in a new visible tab, never while Claude is mid-turn.'),
    lineB,
  );
}

const fixHandlers = {
  fixTest: (stage: StageResult, test: TestCase) => void askFix(buildFixPrompt({ stage: stage.name, command: stage.command, tests: [test], output: stage.output })),
  fixStage: (stage: StageResult) => void askFix(buildFixPrompt({ stage: stage.name, command: stage.command, tests: stage.tests, output: stage.output })),
};

function drawResults(): void {
  results.replaceChildren();
  if (!folderAllowed || !data) return;
  if (!data.project) {
    results.append(data.elsewhere ? sessionPicker(data.elsewhere.sessions, (id) => void chooseSession(id)) : el('p', 'tst-empty', 'Open a project in this tab first. Testing shows the project of the tab you are on.'));
    return;
  }
  if (!data.tasks.length) { results.append(noTasks(openBoard)); return; }
  if (target?.kind === 'prd') {
    results.append(el('h3', 'tst-section-title', 'Tasks and their suites'), prdOverview(overviewRows(data, target.id, data.suites, data.runs, criteria), (id) => pick({ kind: 'task', id })));
    return;
  }
  if (!suite() && !selectedRun) return;
  const shown = shownStage();
  const titleText = shown ? `${shown.stage.name}${selectedRun ? ` · ${new Date(shown.run.startedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}` : 'Results';
  const top = el('div', 'tst-results-top');
  top.append(el('h3', 'tst-section-title', titleText));
  if (selectedRun) {
    const back = el('button', 'tst-link', 'Show latest');
    back.type = 'button';
    back.addEventListener('click', () => { selectedRun = null; drawAll(); });
    top.append(back);
  }
  results.append(top, stageResults(shown?.stage ?? null, shown?.run ?? null, fixHandlers));
}

// A session from the picker: its repo stands in for the tab's, then its task's suite shows; main makes the task when it has none.
async function chooseSession(sessionId: string): Promise<void> {
  const id = tabId();
  if (!id) return;
  const result = await window.pastel.testing.detect(id, null, sessionId);
  if (isIpcError(result)) { message = result.error; drawAll(); return; }
  if (sourceTab && result.project) pickedFor.set(sourceTab, result.project.root);
  data = result;
  folderAllowed = result.allowed;
  target = result.sessionTaskId ? { kind: 'task', id: result.sessionTaskId } : null;
  targetPicked = true;
  selectedRun = null;
  selectedStage = null;
  message = '';
  drawAll();
  await refresh();
}

// Each Claude session's distillation goes under that session's newest row in History, once.
function historyExtras(): (row: RunRow) => HTMLElement | null {
  const groups = new Map(bySession(taskDistillation()).map((g) => [g.sessionId, g.records]));
  const placed = new Set<string>();
  return (row) => {
    const sessionId = row.run.by === 'claude' ? row.run.sessionId ?? null : null;
    const records = sessionId ? groups.get(sessionId) : undefined;
    if (!sessionId || !records || placed.has(sessionId)) return null;
    placed.add(sessionId);
    return distillSection(records, `history:${sessionId}`, (prompt) => void askThread(tabOfSession(sessionId), prompt, 'history'));
  };
}

const tabOfSession = (sessionId: string): string | null => tabs.ids().find((id) => tabs.get(id)?.update?.sessionId === sessionId) ?? null;

// An open thread's card in Testing: asked in the tab that runs that session, through the reply box's paste path.
async function askThread(tabId: string | null, prompt: string, where: 'loop' | 'history'): Promise<void> {
  const tab = tabId ? tabs.get(tabId) : null;
  const say = (text: string) => { if (where === 'loop') { loopNote = text; drawLoop(); } else { message = text; drawNote(); } };
  if (!tab || tab.update?.state !== 'live') { say('That session isn’t running in a tab here. Resume it from History, then ask again.'); return; }
  const sent = await composer.pasteToClaude(tab, composer.stripControls(prompt).trim());
  say(sent ? `Asked Claude in ${tab.update?.label || 'its tab'}: ${prompt.length > 80 ? `${prompt.slice(0, 79)}…` : prompt}` : 'Couldn’t reach Claude in that tab. Try again.');
}

function drawHealth(): void {
  healthBox.replaceChildren();
  const p = suite();
  if (!data?.project || !p) return;
  const health = suiteHealth({ runs: taskRuns(), changed: data.changed });
  healthBox.append(el('h3', 'tst-section-title', 'Suite health'), healthPanel(health, p.stages, { addCore: (command) => void addCoreStage(command) }, draft !== null));
}

function drawSide(): void {
  historyBox.replaceChildren();
  stackBox.replaceChildren();
  side.hidden = !data?.project || !shownTask();
  drawHealth();
  if (!data?.project || !shownTask()) return;
  historyBox.append(el('h3', 'tst-section-title', 'History'));
  const runs = taskRuns();
  const stages = suite()?.stages ?? [];
  if (runs.length) {
    historyBox.append(trend(runs, stages.map((s) => s.id), stages.map((s) => s.name)), historyList(historyDays(runs), selectedRun, expanded, {
      extra: historyExtras(),
      choose: (id) => {
        selectedRun = selectedRun === id ? null : id;
        selectedStage = runById(id)?.stages.find((s) => s.status === 'failed')?.stageId ?? runById(id)?.stages[0]?.stageId ?? null;
        drawAll();
        historyBox.querySelector<HTMLElement>(`[data-run="${id}"]`)?.focus();
      },
      toggle: (key) => {
        if (!expanded.delete(key)) expanded.add(key);
        drawSide();
        historyBox.querySelector<HTMLElement>(`[data-toggle="${CSS.escape(key)}"]`)?.focus();
      },
    }));
  } else {
    historyBox.append(el('p', 'tst-muted', 'No runs for this task yet. Your runs of its suite and the tests Claude runs while it holds the task show here.'));
  }
  stackBox.append(el('h3', 'tst-section-title', 'What this repo tests with'), stackList(data.stack, insertSkill));
}

// ---- Test loop: the task's testing agent and bug fix agent, working at once (testing-agents.ts).
const agents = createAgents({
  root: () => data?.project?.root ?? null,
  picked: () => picked(),
  tabId: () => tabId(),
  task: () => shownTask(),
  suite: () => suite(),
  stack: () => data?.stack ?? [],
  names: () => data?.agentNames ?? {},
  criteria: () => criteria,
  taskRuns: () => taskRuns(),
  redraw: () => { if (isOpen()) drawLoop(); },
  renamed: () => load(),
  say: (text) => { loopNote = text; drawLoop(); },
});
loopPanel.element.after(agents.element);
const loopTabId = (): string | null => agents.testerTab();

// Distillation stays on the testing agent's rounds: stored ones plus any its tab shows since the loop started.
function loopDistillation(): { distill: DistillRecord[]; distillKey: string } {
  const { record, testerTab } = agents.facts();
  const update = testerTab ? tabs.get(testerTab)?.update ?? null : null;
  const sessionId = update?.sessionId ?? null;
  const live = update ? recordsFromReplies(update.replies, sessionId, record?.startedAt ?? 0) : [];
  const groups = bySession(taskDistillation());
  const stored = sessionId ? groups.find((g) => g.sessionId === sessionId) : groups[0];
  return { distill: mergeRecords(stored?.records ?? [], live), distillKey: (sessionId ?? stored?.sessionId) || 'none' };
}

// Claude's newest result per stage since the loop started.
function claudeStages(since: number): LoopModel['stages'] {
  const p = suite();
  if (!p || !data) return [];
  const claudeRuns = taskRuns().filter((r) => r.by === 'claude' && r.startedAt >= since);
  if (!claudeRuns.length) return [];
  return p.stages.map((stage) => ({ name: stage.name, status: claudeRuns.find((r) => r.stages.some((s) => s.stageId === stage.id))?.stages.find((s) => s.stageId === stage.id)?.status ?? 'waiting' }));
}

function drawLoop(): void {
  loopPanel.element.hidden = !folderAllowed || !data?.project || !suite();
  agents.draw();
  if (loopPanel.element.hidden) { stopLoopTick(); return; }
  const { record, progress, status } = agents.facts();
  const { distill, distillKey } = loopDistillation();
  const stages = suite()?.stages ?? [];
  const names = data?.agentNames ?? {};
  const why = !stages.length ? 'Add stages to this task’s suite first. The loop runs them each round.'
    : `Start opens two tabs. ${agentName(names, 'tester')} writes and runs tests and files the bugs it finds; ${agentName(names, 'fixer')} fixes them at the same time. Neither commits.`;
  loopPanel.update({
    status, progress, criteria: taskCriteria(), why,
    canStart: Boolean(stages.length) && !isActive(status) && draft === null,
    stages: status === 'idle' ? [] : claudeStages(record?.startedAt ?? 0),
    stopping: record?.stopping ?? false,
    note: loopNote,
    distillation: distill,
    distillKey,
  });
  // A live loop refreshes faster than the general poll.
  const wantTick = isOpen() && isActive(status);
  if (wantTick && !loopTick) loopTick = setInterval(() => { if (isOpen()) void refresh(); else stopLoopTick(); }, LOOP_POLL_MS);
  if (!wantTick) stopLoopTick();
}

function stopLoopTick(): void {
  if (loopTick) clearInterval(loopTick);
  loopTick = null;
}

async function startLoop(focus: string, rounds: number): Promise<void> {
  await agents.start(focus, rounds);
  await refresh();
}

const stopCurrentLoop = (): Promise<void> => agents.stop();

function drawAll(): void {
  drawHead();
  drawPicker();
  drawChange();
  drawNote();
  drawConfirm();
  drawLoop();
  drawStrip();
  drawEditor();
  drawResults();
  drawSide();
}

// ---- Actions.
const tabId = (): string | null => (sourceTab && tabs.get(sourceTab) ? sourceTab : tabs.active()?.id ?? null);

// Back to the project's own tab and its reply box, then send or insert.
function toSessionTab(): void {
  const id = data?.sessionTab && tabs.get(data.sessionTab) ? data.sessionTab : tabId();
  if (id && tabs.active()?.id !== id) tabs.activate(id);
  overlays.hide('testing');
}

async function askFix(prompt: string): Promise<void> {
  toSessionTab();
  await composer.askClaude(prompt);
}

function insertSkill(item: StackItem): void {
  if (!item.insert) return;
  toSessionTab();
  composer.insertCommand(item.insert);
}

const openBoard = (): void => { overlays.hide('testing'); byId('board-button').click(); };

// Ask Claude to draw one up: starts this task's testing agent in a new tab on the testing-suite skill. Only it may write the suite.
async function askForSuite(task: Task): Promise<void> {
  const id = tabId();
  if (!id) return;
  const prd = data?.prds.find((p) => p.id === prdOf(data?.tasks ?? [], task));
  const prompt = [
    `/petal-testing-suite for task ${task.id}: "${task.title}".`, task.notes ? `Notes: ${task.notes}` : '', prd ? `PRD: ${prd.title}${prd.notes ? `. ${prd.notes}` : ''}.` : '',
    `You are this task's testing agent, so you may write ${suitePath(task.id)}.`,
  ].filter(Boolean).join(' ');
  const reply = await window.pastel.testing.agentStart({ tabId: id, root: picked(), taskId: task.id, prompt });
  message = isIpcError(reply) ? `Couldn’t start the testing agent: ${reply.error}` : 'note' in reply ? reply.note
    : reply.tabId ? 'Started this task’s testing agent in a new tab. Its suite shows here when it writes one.' : 'Couldn’t open a new tab for the testing agent.';
  drawNote();
}

async function run(stageId: string | null, confirmed: boolean): Promise<void> {
  const id = tabId();
  const forTaskId = taskId();
  if (!id || !forTaskId) return;
  const reply = await window.pastel.testing.run({ tabId: id, root: picked(), taskId: forTaskId, stageId, confirmed });
  if (isIpcError(reply)) { message = `Couldn’t start the run: ${reply.error}`; drawAll(); return; }
  if ('confirm' in reply) { confirming = { stageId, commands: reply.confirm.commands }; message = ''; drawAll(); return; }
  if ('note' in reply) { message = reply.note; drawAll(); return; }
  message = '';
  selectedRun = null;
  await refresh();
}

type SuiteCall = (request: { tabId: string; root: string | null; taskId: string }) => Promise<{ ok: true } | { note: string } | { error: string }>;

// Save, seed or undo for the shown task, then reload; false when main said no.
async function suiteCall(call: SuiteCall, done: string): Promise<boolean> {
  const id = tabId();
  const forTaskId = taskId();
  if (!id || !forTaskId) return false;
  const reply = await call({ tabId: id, root: picked(), taskId: forTaskId });
  if (isIpcError(reply) || 'note' in reply) { message = isIpcError(reply) ? reply.error : reply.note; drawNote(); return false; }
  message = done;
  selectedStage = null;
  await load();
  return true;
}

const writeSuite = (next: TaskSuite, done: string): Promise<boolean> =>
  suiteCall((request) => window.pastel.testing.saveSuite({ ...request, suite: next }), done);

async function saveSuite(): Promise<void> {
  if (!draft) return;
  const clean: TaskSuite = { ...draft, stages: draft.stages.map((s) => ({ ...s, name: s.name.trim(), command: s.command.trim() })) };
  const saving = draft;
  draft = null;
  if (await writeSuite(clean, clean.stages.length ? 'Suite saved.' : 'Suite removed.')) editButton.focus();
  else { draft = saving; drawAll(); }
}

// Suite health's core stage, first in the suite; its new command still asks before its first run.
async function addCoreStage(command: string): Promise<void> {
  const p = suite();
  if (!p || draft) return;
  await writeSuite({ ...p, stages: withCoreStage(p.stages, command) }, 'Core stage added first. It asks before its first run.');
}

async function toggleLock(on: boolean): Promise<void> {
  const id = tabId();
  if (!id) return;
  const reply = await window.pastel.testing.setLock({ tabId: id, root: picked(), on });
  message = isIpcError(reply) ? reply.error : 'note' in reply ? reply.note : on ? 'Tests are locked to the testing agent.' : 'Test lock is off.';
  await load();
}

const dismissRestored = (): Promise<boolean> => suiteCall((request) => window.pastel.testing.dismissRestored(request), '');

const seedSuite = (): Promise<boolean> => suiteCall((request) => window.pastel.testing.seedSuite(request), 'Suite started from the project’s commands. Each one still asks before its first run.');
const undoChange = (): Promise<boolean> => suiteCall((request) => window.pastel.testing.undoSuite(request), 'Change undone.');

async function load(): Promise<void> {
  const id = tabId();
  if (!id) return;
  const result = await window.pastel.testing.detect(id, picked());
  if (isIpcError(result)) { message = `Couldn’t read this project: ${result.error}`; drawAll(); return; }
  data = result;
  folderAllowed = result.allowed;
  followSessionTask();
  drawAll();
}

// Runs only: Claude's new runs and finished stages, cheaply, while the tab is open.
async function refresh(): Promise<void> {
  const id = tabId();
  if (!id || !data) return load();
  const result = await window.pastel.testing.history(id, picked());
  if (isIpcError(result) || !data) return;
  data = { ...data, runs: result.runs, running: result.running, sessionTab: result.sessionTab ?? data.sessionTab, seed: result.seed, suites: result.suites, lock: result.lock, agentNames: result.agentNames, tasks: result.tasks, prds: result.prds, sessionTaskId: result.sessionTaskId };
  followSessionTask();
  criteria = result.criteria;
  distillation = result.distillation;
  void agents.refreshLogs().then(() => { if (isOpen()) agents.draw(); }); // logs and tokens follow; the view doesn't wait
  void agents.step();
  if (draft) { drawHead(); drawPicker(); drawNote(); drawLoop(); drawResults(); drawSide(); return; } // the editor keeps her typing
  drawAll();
}

export async function open(): Promise<void> {
  if (!overlays.show('testing')) return;
  sourceTab = tabs.active()?.id ?? null;
  selectedRun = null;
  selectedStage = null;
  confirming = null;
  draft = null;
  message = '';
  loopNote = '';
  data = null;
  criteria = null;
  distillation = [];
  target = null;
  targetPicked = false;
  drawAll();
  await load();
  await refresh();
  view.focus();
  poll ??= setInterval(() => { if (isOpen()) void refresh(); else stopPolling(); }, POLL_MS);
}

function stopPolling(): void {
  if (poll) clearInterval(poll);
  poll = null;
}

export const close = (): void => overlays.hide('testing');
export const toggle = (): void => { if (isOpen()) close(); else void open(); };

export function setFolderAllowed(allowed: boolean): void {
  folderAllowed = allowed;
  if (isOpen()) void load();
}

editButton.addEventListener('click', () => { if (shownTask()) startDraft(suite() ?? { stages: [], keepGoing: false, autoRun: false }); });
runButton.addEventListener('click', () => void run(null, false));

window.pastel.testing.onRunUpdate(({ run: updated }) => {
  if (!isOpen() || !data) return;
  const others = data.runs.filter((r) => r.id !== updated.id);
  data = { ...data, runs: [updated, ...others].sort((a, b) => b.startedAt - a.startedAt), running: updated.state === 'running' ? updated.id : data.running === updated.id ? null : data.running };
  if (!draft) drawAll();
});
// A Loop line or a busy flip in the loop's tab shows at once, not on the next poll.
window.pastel.onReplies((update) => { if (isOpen() && data && update.tabId === loopTabId()) queueMicrotask(drawLoop); });
byId('testing-button').addEventListener('click', toggle);
// A run named in a conclusion's This session line: open Testing on it, when it is this project's.
window.addEventListener(OPEN_TEST_RUN_EVENT, (event) => void openRun(String((event as CustomEvent<string>).detail ?? '')));
export async function openRun(runId: string): Promise<void> {
  await open();
  const found = runById(runId);
  if (!isOpen() || !found) return;
  if (found.taskId && data?.tasks.some((t) => t.id === found.taskId)) { target = { kind: 'task', id: found.taskId }; targetPicked = true; }
  selectedRun = runId; // shown even when it belongs to no task
  selectedStage = null;
  drawAll();
}

// Snapshot harness: choices that outlive a close (picked projects, opened history rows), cleared between steps.
export const leftovers = () => ({ picked: [...pickedFor.keys()], expanded: [...expanded] });
export function resetLeftovers(): void {
  pickedFor.clear();
  expanded.clear();
}

// For the snapshot harness.
export const state = () => ({ target, task: shownTask()?.title ?? null, head: summary.textContent ?? '', sessionTaskId: data?.sessionTaskId ?? null, taskRuns: taskRuns().length, suiteChange: Boolean(taskId() && data?.suites[taskId() as string]?.change), suiteProblem: (taskId() && data?.suites[taskId() as string]?.problem) || null, elsewhere: data?.elsewhere ?? null, picked: picked(), sessionTab: data?.sessionTab ?? null, loop: agents.facts().status, distillation: loopDistillation().distill.length, loopProgress: agents.facts().progress, loopTab: loopTabId(), agents: agents.state(), project: data?.project?.name ?? null, stages: suite()?.stages.map((s) => s.name) ?? [], runs: data?.runs.length ?? 0, selectedRun, selectedStage, editing: draft !== null, seed: data?.seed ?? null, confirming: confirming?.commands.map((c) => c.command) ?? null, sourceTab });

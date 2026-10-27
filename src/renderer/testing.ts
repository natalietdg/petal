// Testing for the repo, in three sections: Suite (its one suite of stages shared by every worktree, filtered by level and
// ticket, with results grouped by file, failures first), Scenarios & bugs (scenarios, manual checks and one bug list),
// and Agents (the session's task's test loop and its two agents). History, suite health and the repo's test tools sit
// in the side column. Nothing runs without her click; the first run of any command asks first, in a new visible tab.
import * as overlays from './overlays';
import * as tabs from './tabs';
import * as composer from './composer';
import * as agentTerms from './agent-terms';
import { byId, el, isIpcError } from './dom';
import { OPEN_TEST_RUN_EVENT } from './conclusion-banner';
import { historyList, stackList, stageResults, suiteStrip, trend, type FixWhere } from './testing-view';
import { historyDays, stagesFromRuns, type RunRow } from '../shared/testing-history';
import { createLoopPanel } from './testing-loop-view';
import { buildFixPrompt, slugId, type StackItem, type SuiteRun, type StageResult, type TestCase, type TestingState } from '../shared/testing';
import { buildSentFixerBrief, filterCriteria, isActive, openBugs, ticketsOf, type Criteria, type ManualStatus } from '../shared/test-loop';
import { DRAFT_TURNS, FIX_TURNS, SUITE_SKILL_CHARS, agentEstimateText, agentTokens } from '../shared/token-usage';
import { bySession, mergeRecords, recordsFromReplies, type DistillRecord } from '../shared/distillation';
import { suiteHealth, withCoreStage } from '../shared/suite-health';
import { distillSection } from './testing-distill-view';
import { healthPanel } from './testing-health-view';
import { createAgents } from './testing-agents';
import { sentBug, type SentBug } from '../shared/bug-queue';
import { lockBar, noSuite, noTasks, sessionPicker, suiteChangeLine, taskPicker } from './testing-tasks-view';
import { criteriaPanel, filterBar, optInList } from './testing-suite-view';
import { scenarioBlock } from '../shared/scenario-run';
import { agentName } from '../shared/agent-names';
import { prdOf } from '../shared/test-scope';
import { LEVELS, asSuiteStage, forTask, shownStages, stagesToRun, type Level, type RepoSuite } from '../shared/repo-suite';
import { draftRequest } from '../shared/suite-draft';
import { keepTarget, type TestTarget } from '../shared/task-testing';
import type { Prd, Task } from '../shared/tasks';

const POLL_MS = 4000; // picks up Claude's runs from the session log while the tab is open
const LOOP_POLL_MS = 1500; // a running loop's Loop line and criteria refresh faster

const view = byId('testing');
view.tabIndex = -1;

const title = el('h2', 'tst-title', 'Testing');
const head = el('header', 'tst-head');
const suiteTitle = el('h3', 'tst-zone-title', 'Suite');
const summary = el('p', 'tst-summary');
const tools = el('div', 'tst-tools-bar');
const editButton = el('button', 'tst-button', 'Edit suite');
editButton.type = 'button';
editButton.title = 'The repo’s stages';
const runButton = el('button', 'tst-button tst-primary', 'Run');
runButton.type = 'button';
tools.append(editButton, runButton);
const savedIn = el('p', 'tst-saved-in'); // where the suite lives: Petal's folder, never the repo
head.append(suiteTitle, summary, tools, savedIn);

const pickerBox = el('div', 'tst-pickerbox');
const changeBox = el('div', 'tst-changebox');
const note = el('div', 'tst-note');
note.setAttribute('role', 'status');
const confirmBox = el('div', 'tst-confirm');
confirmBox.setAttribute('role', 'alertdialog');
confirmBox.setAttribute('aria-label', 'Confirm the commands to run');
const filterBox = el('div', 'tst-filterbox');
const strip = el('div', 'tst-strip');
const criteriaBox = el('div', 'tst-criteriabox');
const editor = el('div', 'tst-editor');
const body = el('div', 'tst-body');
const main = el('div', 'tst-main');
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
const loopPanel = createLoopPanel({ start: (focus, rounds) => void startLoop(focus, rounds), stop: () => void stopCurrentLoop() });

// A labelled section of the main column.
function zone(label: string, ...children: HTMLElement[]): HTMLElement {
  const box = el('section', 'tst-zone');
  box.setAttribute('aria-label', label);
  box.append(...children);
  return box;
}
const suiteZone = zone('Suite', head, confirmBox, changeBox, filterBox, strip, editor, results);
const scenariosZone = zone('Scenarios & bugs', el('h3', 'tst-zone-title', 'Scenarios & bugs'), criteriaBox);
const agentsZone = zone('Agents', el('h3', 'tst-zone-title', 'Agents'), pickerBox, loopPanel.element); // the lanes follow, below
main.append(suiteZone, scenariosZone, agentsZone);
body.append(main, side);
view.append(title, note, body);

// ---- State, per window.
let data: TestingState | null = null;
let sourceTab: string | null = null; // the tab whose project this shows; a run's own new tab doesn't change it
let selectedRun: string | null = null; // null: the latest result of each stage
let selectedStage: string | null = null;
let draft: RepoSuite | null = null; // set while editing the repo's suite
let confirming: { again: () => Promise<void>; commands: { name: string; command: string; isNew: boolean }[] } | null = null; // again: the same run, confirmed
let message = '';
let folderAllowed = true;
let poll: ReturnType<typeof setInterval> | null = null;
const pickedFor = new Map<string, string>(); // tab id -> the repo of the session she picked there, when the tab is in ~ or outside a repo
const pickerFor = new Set<string>(); // tabs where she chose Change session: the picker, not the repo the tab's session worked in
const expanded = new Set<string>(); // history rows opened to their repeats or other commands
let criteria: Criteria | null = null;
let distillation: DistillRecord[] = []; // the project's stored rounds, from .petal/distillation.jsonl
let loopNote = '';
let loopTick: ReturnType<typeof setInterval> | null = null;
let target: TestTarget | null = null; // the task the loop's agents work for; follows the session's task
let targetPicked = false;
const levels = new Set<Level>(); // her level chips; none picked shows every level
let ticket: string | null = null; // her ticket chip
const optedIn = new Set<string>(); // opt-in stages she turned on for Run

export const isOpen = (): boolean => overlays.isOpen('testing');
const picked = (): string | null => (sourceTab ? pickedFor.get(sourceTab) ?? null : null);
const runById = (id: string | null): SuiteRun | null => data?.runs.find((r) => r.id === id) ?? null;

// ---- The repo's suite and runs; the session's task only for its agents and their rounds.
const shownTask = (): Task | null => (target?.kind === 'task' ? data?.tasks.find((t) => t.id === target?.id) ?? null : null);
const shownPrd = (): Prd | null => {
  const id = prdOf(data?.tasks ?? [], shownTask());
  return data?.prds.find((p) => p.id === id) ?? null;
};
const suite = (): RepoSuite | null => data?.suite.suite ?? null;
const home = (): string | null => data?.suite.home ?? null;
const suiteDir = (): string | null => data?.suite.dir ?? null;
const taskId = (): string | null => shownTask()?.id ?? null;
const repoRuns = (): SuiteRun[] => data?.runs ?? [];
// The checkout's run still going: one at a time, since it runs the one suite.
const taskRunning = (): SuiteRun | null => (data?.running ?? []).map(runById).find((r) => r !== null) ?? null;
const taskDistillation = (): DistillRecord[] => forTask(distillation, taskId());
const filter = () => ({ levels: [...levels], optedIn: [...optedIn] });
const filteredCriteria = (): Criteria | null => (criteria ? filterCriteria(criteria, { ticket, levels: [...levels] }) : null);
const testerName = (): string => agentName(data?.agentNames, 'tester');

function followSessionTask(): void {
  if (!data) return;
  target = keepTarget(targetPicked ? target : null, data, data.sessionTaskId);
}

// The task whose agents the loop lanes show; the suite stays the repo's.
function pick(next: TestTarget): void {
  target = next;
  targetPicked = true;
  draft = null;
  confirming = null;
  message = '';
  drawAll();
  pickerBox.querySelector<HTMLElement>('.tst-task-select')?.focus();
}

// "Agents for": the task whose agents the lanes show; nothing else on the page follows it.
function drawPicker(): void {
  pickerBox.replaceChildren();
  pickerBox.hidden = !folderAllowed || !data?.project || !target;
  if (data?.project && target) pickerBox.append(taskPicker(data, target, pick));
}

// Any session's last change to the repo's suite, with Undo, or why its file was not taken; then the test lock.
function drawChange(): void {
  changeBox.replaceChildren();
  if (!data?.project || draft) { changeBox.hidden = true; return; }
  const line = suiteChangeLine(data.suite.change, data.suite.problem, () => void undoChange());
  if (line) changeBox.append(line);
  const names = { tester: testerName(), fixer: agentName(data.agentNames, 'fixer') };
  changeBox.append(lockBar(data.lock, data.lock.restored, names, { toggle: (on) => void toggleLock(on), dismiss: () => void dismissRestored(), resolve: (path, keep) => void resolveLock(path, keep) }));
  changeBox.hidden = false;
}

// The level and ticket chips, and the opt-in stages she may turn on for Run.
function drawFilters(): void {
  filterBox.replaceChildren();
  const p = suite();
  filterBox.hidden = !data?.project || (!p && !criteria) || draft !== null;
  if (filterBox.hidden) return;
  filterBox.append(filterBar(levels, criteria ? ticketsOf(criteria) : [], ticket, {
    level: (level) => { if (!levels.delete(level)) levels.add(level); selectedStage = null; drawAll(); filterBox.querySelector<HTMLElement>(`.tst-chip.is-${level}`)?.focus(); },
    ticket: (next) => { ticket = next; drawAll(); },
    runTicket: ticket && !taskRunning() ? () => void runScenarios({ ticket: ticket as string }) : null,
  }));
  const optIns = p ? optInList(shownStages(p.stages, [...levels]), optedIn, (id, on) => { if (on) optedIn.add(id); else optedIn.delete(id); drawHead(); }, Boolean(taskRunning())) : null;
  if (optIns) filterBox.append(optIns);
}

// A manual check's Result note she is typing survives the agents' frequent redraws.
const typingIn = (box: HTMLElement): boolean => document.activeElement instanceof HTMLInputElement && box.contains(document.activeElement);

// Scenarios & bugs: her review of new scenarios, the criteria under her filter, and the loop's queue joined to the bugs.
function drawCriteria(): void {
  criteriaBox.replaceChildren();
  criteriaBox.hidden = !folderAllowed || !data?.project || draft !== null;
  scenariosZone.hidden = criteriaBox.hidden;
  if (criteriaBox.hidden) return;
  const awaiting = agents.awaiting();
  criteriaBox.append(criteriaPanel({
    criteria: filteredCriteria(),
    allBugs: criteria?.bugs ?? [],
    queue: agents.facts().record?.queue ?? null,
    review: awaiting.length ? { tester: testerName(), scenarios: awaiting, note: agents.testerNote() } : null,
    tester: testerName(),
  }, {
    save: (name, status, result) => void saveManual(name, status, result),
    run: (name) => void runScenarios({ scenario: name }),
    blocked: (item) => (taskRunning() ? 'A run is still going.' : scenarioBlock(item, new Set(data?.runners ?? []), suite()?.stages.map((s) => s.command) ?? [])),
    editScenarios: () => void agents.editScenarios(),
    approveScenarios: () => void agents.approveScenarios(),
  }));
}

// The newest result for a stage, from the chosen run or across all runs (Claude's land on their matching stage).
function resultOf(stageId: string): { stage: StageResult; run: SuiteRun } | null {
  const runs = selectedRun ? [runById(selectedRun)].filter((r): r is SuiteRun => r !== null) : repoRuns();
  for (const run of runs) {
    const stage = run.stages.find((s) => s.stageId === stageId);
    if (stage) return { stage, run };
  }
  return null;
}

// The suite's stages her level chips show.
const visibleStages = () => shownStages(suite()?.stages ?? [], [...levels]);

// The stage the results pane shows: the chosen one, else the first failed, else the first.
function shownStage(): { stage: StageResult; run: SuiteRun } | null {
  const run = runById(selectedRun);
  if (run && !run.stages.some((s) => suite()?.stages.some((p) => p.id === s.stageId))) return run.stages[0] ? { stage: run.stages[0], run } : null;
  const stages = visibleStages();
  const id = selectedStage ?? stages.find((s) => resultOf(s.id)?.stage.status === 'failed')?.id ?? stages[0]?.id ?? null;
  return id ? resultOf(id) : null;
}

// ---- Drawing.
// The repo, its suite, and where the suite lives when this is a worktree.
function headLine(): string {
  if (!data?.project) return '';
  const p = suite();
  const stages = p ? `${p.stages.length} stage${p.stages.length === 1 ? '' : 's'}` : 'No suite yet';
  const shared = home() && home() !== data.project.root ? `shared from ${home()}` : '';
  return [data.project.name, stages, shared, p?.keepGoing ? 'keeps going after a failure' : '', p?.autoRun ? 'runs after Claude’s edits' : ''].filter(Boolean).join(' · ');
}

function drawHead(): void {
  const p = suite();
  const onTask = Boolean(data?.project);
  summary.replaceChildren(data?.project ? headLine() : '');
  suiteTitle.hidden = !data?.project;
  const shownDir = data?.project ? data.suite.shownDir : null;
  savedIn.textContent = shownDir ? `Saved in Petal · ${shownDir}` : '';
  savedIn.hidden = !shownDir;
  if (data?.project && (picked() || data.elsewhere)) {
    const change = el('button', 'tst-link tst-change-session', 'Change session');
    change.type = 'button';
    change.addEventListener('click', () => { if (sourceTab) { pickedFor.delete(sourceTab); pickerFor.add(sourceTab); } target = null; targetPicked = false; selectedRun = null; selectedStage = null; void load(); });
    summary.append(' · ', change);
  }
  const busy = Boolean(taskRunning());
  const runs = p ? stagesToRun(p.stages, filter()) : [];
  tools.hidden = !onTask;
  runButton.disabled = !runs.length || busy || draft !== null;
  runButton.textContent = busy ? 'Running…' : runs.length === p?.stages.length ? 'Run all' : `Run ${runs.length} stage${runs.length === 1 ? '' : 's'}`;
  runButton.title = 'Runs the stages shown. Opt-in stages run only when turned on.';
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
  const running = taskRunning();
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
  const again = confirming.again;
  go.addEventListener('click', () => { confirming = null; void again(); });
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

function startDraft(next: RepoSuite, note = ''): void {
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
    const fromClaude = stagesFromRuns(repoRuns());
    const drawn = agents.draft();
    strip.append(noSuite({
      tester: testerName(),
      askClaude: () => void askForSuite(task),
      showDraft: drawn ? () => agents.showTerminal('tester') : null,
      draftEnded: drawn?.ended ?? false,
      askAgain: () => void askAgain(task),
      seed: data.seed && 'stages' in data.seed ? () => void seedSuite() : null,
      edit: () => startDraft({ stages: [], keepGoing: false, autoRun: false }),
      fromRuns: fromClaude.length ? () => startDraft({ stages: fromClaude.map(asSuiteStage), keepGoing: false, autoRun: false }, 'Check the commands, then save. Each one still asks before its first run.') : null,
      askEstimate: agentEstimateText(agentTokens(SUITE_SKILL_CHARS + draftRequest(task, shownPrd(), suiteDir()).length, DRAFT_TURNS)),
      scenariosReady: agents.awaiting().length > 0,
    }, data.seed && 'problem' in data.seed ? data.seed.problem : null, Boolean(taskRunning())));
    return;
  }
  const current = shownStage();
  strip.append(suiteStrip({ stages: visibleStages() }, (id) => resultOf(id)?.stage ?? null, current?.stage.stageId ?? null, {
    select: (id) => { selectedStage = id; drawAll(); strip.querySelector<HTMLElement>(`[data-stage="${id}"]`)?.focus(); },
    runStage: (id) => void run(id, false),
  }, Boolean(taskRunning()) || draft !== null));
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
    const level = el('select', 'tst-input tst-edit-level');
    level.setAttribute('aria-label', `Stage ${i + 1} level`);
    level.append(...LEVELS.map((l) => new Option(l, l, false, l === stage.level)));
    level.addEventListener('change', () => { stage.level = level.value as Level; });
    const optIn = el('label', 'tst-edit-optin');
    const optBox = el('input');
    optBox.type = 'checkbox';
    optBox.checked = stage.optIn === true;
    optBox.addEventListener('change', () => { stage.optIn = optBox.checked || undefined; });
    optIn.append(optBox, el('span', null, 'Opt-in'));
    const noteInput = el('input', 'tst-input tst-edit-note');
    Object.assign(noteInput, { value: stage.note ?? '', placeholder: 'Note: why opt-in, or what blocks it', spellcheck: true });
    noteInput.setAttribute('aria-label', `Stage ${i + 1} note`);
    noteInput.addEventListener('input', () => { stage.note = noteInput.value.trim() || undefined; });
    row.append(el('span', 'tst-edit-num', String(i + 1)), name, command, move(-1, 'up', '↑'), move(1, 'down', '↓'), remove, level, optIn, noteInput);
    rows.append(row);
  });
  const add = el('button', 'tst-button', 'Add stage');
  add.type = 'button';
  add.addEventListener('click', () => {
    d.stages.push({ id: slugId('stage', d.stages.map((s) => s.id)), name: 'New stage', command: '', level: 'regression' });
    drawEditor();
    editor.querySelector<HTMLInputElement>('.tst-edit-row:last-child .tst-edit-name')?.select();
  });
  const reset = el('button', 'tst-button', 'Use detected stages');
  reset.type = 'button';
  reset.disabled = !data?.proposed.length;
  reset.addEventListener('click', () => { d.stages = (data?.proposed ?? []).map(asSuiteStage); drawEditor(); });
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
    el('h3', 'tst-section-title', `Edit the suite for ${data?.project?.name ?? 'this repo'}`),
    el('p', 'tst-muted', 'One suite for the repo, shared by its worktrees. Stages run in order in one new tab, each a shell command in this checkout. Opt-in stages run only when turned on, never after Claude’s edits. Save with no stages to remove the suite.'),
    rows, lineA,
    toggle('Keep going after a failure', 'keepGoing', 'Otherwise the suite stops at the first failed stage.'),
    toggle('Run this suite when Claude finishes a turn that changed files', 'autoRun', 'Off by default. Only commands you already confirmed and never opt-in stages, in a new visible tab, never while Claude is mid-turn.'),
    lineB,
  );
}

// A failed test or stage goes to this task's bug fix agent, or with "Ask in this session instead", to this tab's Claude.
function fix(stage: StageResult, test: TestCase | null, where: FixWhere): void {
  const prompt = buildFixPrompt({ stage: stage.name, command: stage.command, tests: test ? [test] : stage.tests, output: stage.output });
  void (where === 'session' ? askFix(prompt) : sendToFixer(sentBug(stage.name, test, prompt)));
}
const fixHandlers = {
  fixTest: (stage: StageResult, test: TestCase, where: FixWhere) => fix(stage, test, where),
  fixStage: (stage: StageResult, where: FixWhere) => fix(stage, null, where),
  fixEstimate: (stage: StageResult): string | null => {
    const task = shownTask();
    if (!task) return null;
    const prompt = buildFixPrompt({ stage: stage.name, command: stage.command, tests: stage.tests, output: stage.output });
    return agentEstimateText(agentTokens(buildSentFixerBrief({ taskId: task.id, taskTitle: task.title, bugName: stage.name, prompt }).length, FIX_TURNS));
  },
};

function drawResults(): void {
  results.replaceChildren();
  if (!folderAllowed || !data) return;
  if (!data.project) {
    results.append(data.elsewhere ? sessionPicker(data.elsewhere.sessions, (id) => void chooseSession(id)) : el('p', 'tst-empty', 'Open a project in this tab first. Testing shows the project of the tab you are on.'));
    return;
  }
  if (!data.tasks.length && !suite()) { results.append(noTasks()); return; } // main gives the tab's Claude session a task, so none means no session
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
  if (sourceTab && result.project) { pickedFor.set(sourceTab, result.project.root); pickerFor.delete(sourceTab); }
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

// Each Claude session's distillation goes under that session's newest row in History, once. The loop's testing agent
// shows its live rounds too, and its threads are asked through main, which resumes it when no claude runs it.
function historyExtras(): (row: RunRow) => HTMLElement | null {
  const groups = new Map(bySession(taskDistillation()).map((g) => [g.sessionId, g.records]));
  const tester = loopDistillation();
  if (tester.sessionId) groups.set(tester.sessionId, tester.distill);
  const placed = new Set<string>();
  return (row) => {
    const sessionId = row.run.by === 'claude' ? row.run.sessionId ?? null : null;
    const records = sessionId ? groups.get(sessionId) : undefined;
    if (!sessionId || !records?.length || placed.has(sessionId)) return null;
    placed.add(sessionId);
    const ask = sessionId === tester.sessionId ? (prompt: string) => void askLoopThread(prompt) : (prompt: string) => void askThread(tabOfSession(sessionId), prompt);
    return distillSection(records, `history:${sessionId}`, ask);
  };
}

const tabOfSession = (sessionId: string): string | null => tabs.ids().find((id) => tabs.get(id)?.update?.sessionId === sessionId) ?? null;

// An open thread's card in Testing: asked in the tab that runs that session, through the reply box's paste path.
async function askThread(tabId: string | null, prompt: string): Promise<void> {
  const tab = tabId ? tabs.get(tabId) : null;
  const say = (text: string) => { message = text; drawNote(); };
  if (!tab || tab.update?.state !== 'live') { say('That session isn’t running in a tab here. Resume it from History, then ask again.'); return; }
  const sent = await composer.pasteToClaude(tab, composer.stripControls(prompt).trim());
  say(sent ? `Asked Claude in ${tab.update?.label || 'its tab'}: ${prompt.length > 80 ? `${prompt.slice(0, 79)}…` : prompt}` : 'Couldn’t reach Claude in that tab. Try again.');
}

// A loop thread's card goes to the testing agent through main, which resumes it if no claude runs it.
async function askLoopThread(prompt: string): Promise<void> {
  loopNote = await agents.askTester(composer.stripControls(prompt).trim());
  drawLoop();
}

function drawHealth(): void {
  healthBox.replaceChildren();
  const p = suite();
  if (!data?.project || !p) return;
  const health = suiteHealth({ runs: repoRuns(), changed: data.changed });
  healthBox.append(el('h3', 'tst-section-title', 'Suite health'), healthPanel(health, p.stages, { addCore: (command) => void addCoreStage(command) }, draft !== null));
}

function drawSide(): void {
  historyBox.replaceChildren();
  stackBox.replaceChildren();
  side.hidden = !data?.project;
  drawHealth();
  if (!data?.project) return;
  historyBox.append(el('h3', 'tst-section-title', 'History'));
  const runs = repoRuns();
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
    historyBox.append(el('p', 'tst-muted', 'No runs in this checkout yet. Your runs of the suite and the tests Claude runs here show up here.'));
  }
  stackBox.append(el('h3', 'tst-section-title', 'What this repo tests with'), stackList(data.stack, insertSkill));
}

// ---- Test loop: the task's testing agent and bug fix agent, working at once (testing-agents.ts).
const agents = createAgents({
  root: () => data?.project?.root ?? null,
  picked: () => picked(),
  tabId: () => tabId(),
  task: () => shownTask(),
  prd: () => shownPrd(),
  scenarios: () => criteria?.scenarios ?? [],
  suite: () => suite(),
  suiteDir: () => suiteDir(),
  stack: () => data?.stack ?? [],
  names: () => data?.agentNames ?? {},
  taskRuns: () => repoRuns(),
  redraw: () => { if (isOpen()) { drawLoop(); if (!typingIn(criteriaBox)) drawCriteria(); } }, // the queue and the scenario review show in Scenarios & bugs
  renamed: () => load(),
  say: (text) => { loopNote = text; drawLoop(); },
  open: () => void open(),
});
agentsZone.append(agents.element);

// The testing agent's distillation: its stored rounds plus any its replies show since the loop started.
function loopDistillation(): { distill: DistillRecord[]; sessionId: string | null } {
  const { record } = agents.facts();
  const sessionId = record?.tester?.sessionId ?? null;
  const live = sessionId ? recordsFromReplies([...agents.testerReplies()], sessionId, record?.startedAt ?? 0) : [];
  const groups = bySession(taskDistillation());
  const stored = sessionId ? groups.find((g) => g.sessionId === sessionId) : groups[0];
  return { distill: mergeRecords(stored?.records ?? [], live), sessionId };
}

function drawLoop(): void {
  loopPanel.element.hidden = !folderAllowed || !data?.project || !suite();
  agents.draw();
  agentsZone.hidden = pickerBox.hidden && loopPanel.element.hidden && agents.element.hidden;
  if (loopPanel.element.hidden) { stopLoopTick(); return; }
  const { record, progress, status, stopping } = agents.facts();
  const stages = suite()?.stages ?? [];
  const names = data?.agentNames ?? {};
  const why = !stages.length ? 'Add stages to the repo’s suite first. The loop runs them each round.'
    : record && !record.stoppedAt && record.fixer && !record.tester ? `Start starts ${agentName(names, 'tester')} in its lane below. ${agentName(names, 'fixer')} keeps fixing what you sent it. Neither commits.`
    : `Start starts two agents, each in its lane below. ${agentName(names, 'tester')} writes and runs tests and files the bugs it finds; ${agentName(names, 'fixer')} fixes them at the same time. Neither commits.`;
  const shownCriteria = filteredCriteria();
  loopPanel.update({
    status, progress, openBugs: shownCriteria ? openBugs(shownCriteria) : null, why,
    canStart: Boolean(stages.length && shownTask()) && !isActive(status) && draft === null,
    stopping,
    note: loopNote,
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
  drawFilters();
  drawLoop();
  drawStrip();
  drawEditor();
  drawCriteria();
  drawResults();
  drawSide();
}

// ---- Actions.
const tabId = (): string | null => (sourceTab && tabs.get(sourceTab) ? sourceTab : tabs.active()?.id ?? null);

// Back to the project's own tab and its reply box, then send or insert.
function toSessionTab(): void {
  const id = data?.sessionTab && tabs.get(data.sessionTab) ? data.sessionTab : tabId();
  if (id && tabs.active()?.id !== id) agentTerms.showTab(id); // never an agent terminal
  overlays.hide('testing');
}

async function askFix(prompt: string): Promise<void> {
  toSessionTab();
  await composer.askClaude(prompt);
}

async function sendToFixer(bug: SentBug): Promise<void> {
  message = await agents.sendToFixer(bug);
  drawNote();
  await refresh(); // its lane and the queue show now
}

function insertSkill(item: StackItem): void {
  if (!item.insert) return;
  toSessionTab();
  composer.insertCommand(item.insert);
}

// Ask Claude to draw one up: starts a testing agent for the session's task in a new tab, shown, on the testing-suite skill.
// Main puts the skill's slash command in front, or its bundled instructions after, depending on the installed copy.
async function askForSuite(task: Task): Promise<void> {
  const id = tabId();
  if (!id) return;
  const prd = data?.prds.find((p) => p.id === prdOf(data?.tasks ?? [], task)) ?? null;
  const prompt = draftRequest(task, prd, suiteDir());
  const reply = await window.pastel.testing.agentStart({ tabId: id, root: picked(), taskId: task.id, prompt });
  const updated = !isIpcError(reply) && 'updatedSkill' in reply && reply.updatedSkill ? 'Updated Petal’s testing skill. ' : '';
  message = isIpcError(reply) ? `Couldn’t start the testing agent: ${reply.error}` : 'note' in reply ? reply.note
    : reply.reused ? `${updated}Sent the request to the testing agent. The repo’s suite shows here when it writes one.` : `${updated}Started a testing agent. The repo’s suite shows here when it writes one.`;
  drawNote();
  await refresh(); // its lane shows now
}

// The testing agent stopped without a suite: its open tab gets a follow-up, else a fresh one starts.
async function askAgain(task: Task): Promise<void> {
  const asked = await agents.askAgain();
  if (asked === 'start') return askForSuite(task);
  message = asked === 'pasted' ? 'Asked the testing agent again.' : 'Couldn’t reach the testing agent. Answer anything it is asking in its terminal first.';
  drawAll();
}

async function run(stageId: string | null, confirmed: boolean): Promise<void> {
  const id = tabId();
  if (!id) return;
  const reply = await window.pastel.testing.run({ tabId: id, root: picked(), taskId: taskId(), stageId, confirmed, ...filter() });
  await started(reply, () => run(stageId, true));
}

// One scenario's tests, or the picked ticket's tested scenarios; staging ones only while the Staging chip is on.
async function runScenarios(which: { scenario: string } | { ticket: string }, confirmed = false): Promise<void> {
  const id = tabId();
  if (!id) return;
  const reply = await window.pastel.testing.runScenarios({ tabId: id, root: picked(), taskId: taskId(), ...which, staging: levels.has('staging'), confirmed });
  await started(reply, () => runScenarios(which, true));
}

// A run's reply: the confirm to show, a note, or the run started.
async function started(reply: Awaited<ReturnType<typeof window.pastel.testing.run>>, again: () => Promise<void>): Promise<void> {
  if (isIpcError(reply)) { message = `Couldn’t start the run: ${reply.error}`; drawAll(); return; }
  if ('confirm' in reply) { confirming = { again, commands: reply.confirm.commands }; message = ''; drawAll(); return; }
  if ('note' in reply) { message = reply.note; drawAll(); return; }
  message = '';
  selectedRun = null;
  await refresh();
}

type SuiteCall = (request: { tabId: string; root: string | null }) => Promise<{ ok: true } | { note: string } | { error: string }>;

// Save, seed or undo for the repo, then reload; false when main said no.
async function suiteCall(call: SuiteCall, done: string): Promise<boolean> {
  const id = tabId();
  if (!id) return false;
  const reply = await call({ tabId: id, root: picked() });
  if (isIpcError(reply) || 'note' in reply) { message = isIpcError(reply) ? reply.error : reply.note; drawNote(); return false; }
  message = done;
  selectedStage = null;
  await load();
  return true;
}

const writeSuite = (next: RepoSuite, done: string): Promise<boolean> =>
  suiteCall((request) => window.pastel.testing.saveSuite({ ...request, suite: next }), done);

async function saveSuite(): Promise<void> {
  if (!draft) return;
  const clean: RepoSuite = { ...draft, stages: draft.stages.map((s) => ({ ...s, name: s.name.trim(), command: s.command.trim() })) };
  const saving = draft;
  draft = null;
  if (await writeSuite(clean, clean.stages.length ? 'Suite saved.' : 'Suite removed.')) editButton.focus();
  else { draft = saving; drawAll(); }
}

// Suite health's core stage, first in the suite; its new command still asks before its first run.
async function addCoreStage(command: string): Promise<void> {
  const p = suite();
  if (!p || draft) return;
  const kept = new Map(p.stages.map((s) => [s.id, s]));
  await writeSuite({ ...p, stages: withCoreStage(p.stages, command).map((s) => kept.get(s.id) ?? { ...asSuiteStage(s), level: 'smoke' }) }, 'Core stage added first. It asks before its first run.');
}

async function toggleLock(on: boolean): Promise<void> {
  const id = tabId();
  if (!id) return;
  const reply = await window.pastel.testing.setLock({ tabId: id, root: picked(), on });
  message = isIpcError(reply) ? reply.error : 'note' in reply ? reply.note : on ? 'Tests are locked: no session may delete, skip or weaken one.' : 'Test lock is off.';
  await load();
}

const dismissRestored = (): Promise<boolean> => suiteCall((request) => window.pastel.testing.dismissRestored(request), '');
const resolveLock = (path: string, keep: boolean): Promise<boolean> =>
  suiteCall((request) => window.pastel.testing.resolveLock({ ...request, path, keep }), keep ? 'Kept your change. It is the locked copy now.' : 'Put the locked copy back.');

const seedSuite = (): Promise<boolean> => suiteCall((request) => window.pastel.testing.seedSuite(request), 'Suite started from the project’s commands. Each one still asks before its first run.');

// Her tick on a manual case, written into the criteria file; the panel shows it on the next refresh.
async function saveManual(name: string, status: ManualStatus, result: string): Promise<void> {
  const id = tabId();
  if (!id) return;
  const reply = await window.pastel.testing.manualResult({ tabId: id, root: picked(), name, status, result });
  message = isIpcError(reply) ? `Couldn’t save it: ${reply.error}` : 'note' in reply ? reply.note : `Marked ${name}: ${status}.`;
  await refresh();
}
const undoChange = (): Promise<boolean> => suiteCall((request) => window.pastel.testing.undoSuite(request), 'Change undone.');

async function load(): Promise<void> {
  const id = tabId();
  if (!id) return;
  const result = await window.pastel.testing.detect(id, picked(), null, Boolean(sourceTab && pickerFor.has(sourceTab)));
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
  if (!data.project) return; // the picker: nothing of a repo to refresh
  const root = picked();
  const result = await window.pastel.testing.history(id, root);
  if (isIpcError(result) || !data || picked() !== root) return; // a session picked or let go meanwhile: this answer is another repo's
  data = { ...data, runs: result.runs, running: result.running, sessionTab: result.sessionTab ?? data.sessionTab, seed: result.seed, suite: result.suite, lock: result.lock, agentNames: result.agentNames, tasks: result.tasks, prds: result.prds, sessionTaskId: result.sessionTaskId };
  followSessionTask();
  criteria = result.criteria;
  distillation = result.distillation;
  if (data.project) agents.adoptAll(data.project.root, result.loops); // lanes rebuild from the saved loops
  void agents.checkDraft(result.suite.problem);
  void agents.refreshLogs().then(() => { if (isOpen()) agents.draw(); }); // logs and tokens follow; the view doesn't wait
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

editButton.addEventListener('click', () => { if (data?.project) startDraft(suite() ?? { stages: [], keepGoing: false, autoRun: false }); });
runButton.addEventListener('click', () => void run(null, false));

window.pastel.testing.onRunUpdate(({ run: updated }) => {
  if (!isOpen() || !data) return;
  const others = data.runs.filter((r) => r.id !== updated.id);
  data = { ...data, runs: [updated, ...others].sort((a, b) => b.startedAt - a.startedAt), running: updated.state === 'running' ? [...new Set([...data.running, updated.id])] : data.running.filter((id) => id !== updated.id) };
  if (!draft) drawAll();
});
// A Loop line or a busy flip in the testing agent's terminal shows at once, not on the next poll.
window.pastel.onReplies((update) => { if (isOpen() && data && update.tabId === agents.testerHost()) queueMicrotask(drawLoop); });
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
export const state = () => ({ target, task: shownTask()?.title ?? null, head: summary.textContent ?? '', sessionTaskId: data?.sessionTaskId ?? null, taskRuns: repoRuns().length, suiteChange: Boolean(data?.suite.change), suiteProblem: data?.suite.problem ?? null, levels: [...levels], ticket, optedIn: [...optedIn], elsewhere: data?.elsewhere ?? null, picked: picked(), sessionTab: data?.sessionTab ?? null, loop: agents.facts().status, distillation: loopDistillation().distill.length, loopProgress: agents.facts().progress, loopTab: agents.testerHost(), agents: agents.state(), project: data?.project?.name ?? null, stages: suite()?.stages.map((s) => s.name) ?? [], runs: data?.runs.length ?? 0, selectedRun, selectedStage, editing: draft !== null, seed: data?.seed ?? null, confirming: confirming?.commands.map((c) => c.command) ?? null, sourceTab });

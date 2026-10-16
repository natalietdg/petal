// Testing: the active tab's project as a pipeline of stages (typecheck, unit, e2e, mobile flows...), each stage's
// results grouped by file with failures first, run history with a trend, and what the project tests with.
// Nothing runs without her click; the first run of any command asks first, and runs go in a new visible tab.
import * as overlays from './overlays';
import * as tabs from './tabs';
import * as composer from './composer';
import { byId, el, isIpcError } from './dom';
import { pipelineStrip, runList, stackList, stageResults, trend } from './testing-view';
import { buildFixPrompt, slugId, type PipelineConfig, type PipelineRun, type StackItem, type StageConfig, type StageResult, type TestCase, type TestingState } from '../shared/testing';

const POLL_MS = 4000; // picks up Claude's runs from the session log while the tab is open

const view = byId('testing');
view.tabIndex = -1;

const head = el('header', 'tst-head');
const title = el('h2', 'tst-title', 'Testing');
const summary = el('p', 'tst-summary');
const tools = el('div', 'tst-tools-bar');
const editButton = el('button', 'tst-button', 'Edit pipeline');
editButton.type = 'button';
const runButton = el('button', 'tst-button tst-primary', 'Run pipeline');
runButton.type = 'button';
tools.append(editButton, runButton);
head.append(title, summary, tools);

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
const stackBox = el('section', 'tst-stackbox');
stackBox.setAttribute('aria-label', 'What this project tests with');
side.append(historyBox, stackBox);
body.append(results, side);
view.append(head, note, confirmBox, strip, editor, body);

// ---- State, per window.
let data: TestingState | null = null;
let sourceTab: string | null = null; // the tab whose project this shows; a run's own new tab doesn't change it
let selectedRun: string | null = null; // null: the latest result of each stage
let selectedStage: string | null = null;
let draft: PipelineConfig | null = null; // set while editing
let confirming: { stageId: string | null; commands: { name: string; command: string; isNew: boolean }[] } | null = null;
let message = '';
let folderAllowed = true;
let poll: ReturnType<typeof setInterval> | null = null;

export const isOpen = (): boolean => overlays.isOpen('testing');
const pipeline = (): PipelineConfig | null => data?.pipeline ?? null;
const runById = (id: string | null): PipelineRun | null => data?.runs.find((r) => r.id === id) ?? null;

// The newest result for a stage, from the chosen run or across all runs (Claude's land on their matching stage).
function resultOf(stageId: string): { stage: StageResult; run: PipelineRun } | null {
  const runs = selectedRun ? [runById(selectedRun)].filter((r): r is PipelineRun => r !== null) : data?.runs ?? [];
  for (const run of runs) {
    const stage = run.stages.find((s) => s.stageId === stageId);
    if (stage) return { stage, run };
  }
  return null;
}

// The stage the results pane shows: the chosen one, else the first failed, else the first.
function shownStage(): { stage: StageResult; run: PipelineRun } | null {
  const run = runById(selectedRun);
  if (run && !run.stages.some((s) => pipeline()?.stages.some((p) => p.id === s.stageId))) return run.stages[0] ? { stage: run.stages[0], run } : null;
  const stages = pipeline()?.stages ?? [];
  const id = selectedStage ?? stages.find((s) => resultOf(s.id)?.stage.status === 'failed')?.id ?? stages[0]?.id ?? null;
  return id ? resultOf(id) : null;
}

// ---- Drawing.
function drawHead(): void {
  const p = pipeline();
  summary.textContent = data?.project ? `${data.project.name} · ${p?.stages.length ?? 0} stage${p?.stages.length === 1 ? '' : 's'}${p?.keepGoing ? ' · keeps going after a failure' : ''}${p?.autoRun ? ' · runs after Claude’s edits' : ''}` : '';
  const busy = Boolean(data?.running);
  runButton.disabled = !p?.stages.length || busy || draft !== null;
  runButton.textContent = busy ? 'Running…' : 'Run pipeline';
  editButton.disabled = !data?.project || draft !== null;
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
    el('p', 'tst-muted', 'They run in this project’s folder, in order. Petal adds a report flag where the runner has one and keeps the output in its own folder. You confirm each command once.'),
    actions,
  );
  go.focus();
}

function drawStrip(): void {
  strip.replaceChildren();
  const p = pipeline();
  if (!data?.project || !p) return;
  if (!p.stages.length) {
    strip.append(el('p', 'tst-empty', 'No stages yet. Edit the pipeline to add the commands this project runs.'));
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
  const toggle = (label: string, key: 'keepGoing' | 'autoRun', hint: string) => {
    const wrap = el('label', 'tst-toggle');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = d[key];
    box.addEventListener('change', () => { d[key] = box.checked; });
    wrap.append(box, el('span', null, label), el('span', 'tst-muted', hint));
    return wrap;
  };
  const save = el('button', 'tst-button tst-primary', 'Save pipeline');
  save.type = 'button';
  save.addEventListener('click', () => void savePipeline());
  const cancel = el('button', 'tst-button', 'Cancel');
  cancel.type = 'button';
  cancel.addEventListener('click', () => { draft = null; message = ''; drawAll(); editButton.focus(); });
  const lineA = el('div', 'tst-actions');
  lineA.append(add, reset);
  const lineB = el('div', 'tst-actions');
  lineB.append(save, cancel);
  editor.append(
    el('h3', 'tst-section-title', 'Edit pipeline'),
    el('p', 'tst-muted', 'Stages run in order in one new tab. Each one is a shell command run in the project folder.'),
    rows, lineA,
    toggle('Keep going after a failure', 'keepGoing', 'Otherwise the pipeline stops at the first failed stage.'),
    toggle('Run the pipeline when Claude finishes a turn that changed files', 'autoRun', 'Off by default. Only commands you already confirmed, in a new visible tab, never while Claude is mid-turn.'),
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
    results.append(el('p', 'tst-empty', 'Open a project in this tab first. Testing shows the project of the tab you are on.'));
    return;
  }
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

function drawSide(): void {
  historyBox.replaceChildren();
  stackBox.replaceChildren();
  if (!data?.project) return;
  historyBox.append(el('h3', 'tst-section-title', 'History'));
  if (data.runs.length) {
    historyBox.append(trend(data.runs, data.pipeline.stages.map((s) => s.id), data.pipeline.stages.map((s) => s.name)), runList(data.runs, selectedRun, (id) => {
      selectedRun = selectedRun === id ? null : id;
      selectedStage = runById(id)?.stages.find((s) => s.status === 'failed')?.stageId ?? runById(id)?.stages[0]?.stageId ?? null;
      drawAll();
      historyBox.querySelector<HTMLElement>(`[data-run="${id}"]`)?.focus();
    }));
  } else {
    historyBox.append(el('p', 'tst-muted', 'No runs yet. Your runs and the tests Claude runs in this project show here.'));
  }
  stackBox.append(el('h3', 'tst-section-title', 'What this project tests with'), stackList(data.stack, insertSkill));
}

function drawAll(): void {
  drawHead();
  drawNote();
  drawConfirm();
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

async function run(stageId: string | null, confirmed: boolean): Promise<void> {
  const id = tabId();
  if (!id) return;
  const reply = await window.pastel.testing.run({ tabId: id, stageId, confirmed });
  if (isIpcError(reply)) { message = `Couldn’t start the run: ${reply.error}`; drawAll(); return; }
  if ('confirm' in reply) { confirming = { stageId, commands: reply.confirm.commands }; message = ''; drawAll(); return; }
  if ('note' in reply) { message = reply.note; drawAll(); return; }
  message = '';
  selectedRun = null;
  await refresh();
}

async function savePipeline(): Promise<void> {
  const id = tabId();
  if (!id || !draft) return;
  const clean: PipelineConfig = { ...draft, stages: draft.stages.map((s: StageConfig) => ({ ...s, name: s.name.trim(), command: s.command.trim() })) };
  const reply = await window.pastel.testing.savePipeline({ tabId: id, pipeline: clean });
  if (isIpcError(reply) || 'note' in reply) { message = isIpcError(reply) ? reply.error : reply.note; drawNote(); return; }
  draft = null;
  message = 'Pipeline saved.';
  await load();
  editButton.focus();
}

async function load(): Promise<void> {
  const id = tabId();
  if (!id) return;
  const result = await window.pastel.testing.detect(id);
  if (isIpcError(result)) { message = `Couldn’t read this project: ${result.error}`; drawAll(); return; }
  data = result;
  folderAllowed = result.allowed;
  drawAll();
}

// Runs only: Claude's new runs and finished stages, cheaply, while the tab is open.
async function refresh(): Promise<void> {
  const id = tabId();
  if (!id || !data) return load();
  const result = await window.pastel.testing.history(id);
  if (isIpcError(result) || !data) return;
  data = { ...data, runs: result.runs, running: result.running };
  if (draft) { drawHead(); drawNote(); drawResults(); drawSide(); return; } // the editor keeps her typing
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
  data = null;
  drawAll();
  await load();
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

editButton.addEventListener('click', () => {
  const p = pipeline();
  if (!p) return;
  draft = { ...p, stages: p.stages.map((s) => ({ ...s })) };
  confirming = null;
  drawAll();
  editor.querySelector<HTMLInputElement>('.tst-edit-name')?.focus();
});
runButton.addEventListener('click', () => void run(null, false));

window.pastel.testing.onRunUpdate(({ run: updated }) => {
  if (!isOpen() || !data) return;
  const others = data.runs.filter((r) => r.id !== updated.id);
  data = { ...data, runs: [updated, ...others].sort((a, b) => b.startedAt - a.startedAt), running: updated.state === 'running' ? updated.id : data.running === updated.id ? null : data.running };
  if (!draft) drawAll();
});
byId('testing-button').addEventListener('click', toggle);

// For the snapshot harness.
export const state = () => ({ project: data?.project?.name ?? null, stages: data?.pipeline.stages.map((s) => s.name) ?? [], runs: data?.runs.length ?? 0, selectedRun, selectedStage, editing: draft !== null, confirming: confirming?.commands.map((c) => c.command) ?? null, sourceTab });

// Testing: the active tab's project as a pipeline of stages (typecheck, unit, e2e, mobile flows...), each stage's
// results grouped by file with failures first, run history with a trend, and what the project tests with.
// Nothing runs without her click; the first run of any command asks first, and runs go in a new visible tab.
import * as overlays from './overlays';
import * as tabs from './tabs';
import * as composer from './composer';
import { byId, el, isIpcError } from './dom';
import { OPEN_TEST_RUN_EVENT } from './conclusion-banner';
import { historyList, pipelineStrip, stackList, stageResults, trend } from './testing-view';
import { historyDays, stagesFromRuns, type RunRow } from '../shared/testing-history';
import { createLoopPanel, type LoopModel } from './testing-loop-view';
import { buildFixPrompt, slugId, type PipelineConfig, type PipelineRun, type StackItem, type StageConfig, type StageResult, type TestCase, type TestingState, type Elsewhere } from '../shared/testing';
import { latestLoop } from '../shared/loop-line';
import { buildLoopBrief, isActive, loopStatus, loopTarget, stopLoop, type Criteria } from '../shared/test-loop';
import { bySession, mergeRecords, recordsFromReplies, type DistillRecord } from '../shared/distillation';
import { suiteHealth, withCoreStage } from '../shared/suite-health';
import { distillSection } from './testing-distill-view';
import { healthPanel } from './testing-health-view';

const POLL_MS = 4000; // picks up Claude's runs from the session log while the tab is open
const LOOP_POLL_MS = 1500; // a running loop's Loop line and criteria refresh faster

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
const healthBox = el('section', 'tst-healthbox');
healthBox.setAttribute('aria-label', 'Suite health');
const stackBox = el('section', 'tst-stackbox');
stackBox.setAttribute('aria-label', 'What this project tests with');
side.append(historyBox, healthBox, stackBox);
body.append(results, side);
const loopPanel = createLoopPanel({ start: (focus, rounds) => void startLoop(focus, rounds), stop: () => void stopCurrentLoop(), askThread: (prompt) => void askThread(loopTabId(), prompt, 'loop') });
view.append(head, note, confirmBox, loopPanel.element, strip, editor, body);

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
const pickedFor = new Map<string, string>(); // tab id -> the project she picked there, when the tab is in ~ or outside a repo
const expanded = new Set<string>(); // history rows opened to their repeats or other commands
let criteria: Criteria | null = null;
let distillation: DistillRecord[] = []; // the project's stored rounds, from .petal/distillation.jsonl
let loopNote = '';
// A loop Petal started or stopped this run, per project root; Claude's Loop lines carry the rest.
interface LoopRecord { tabId: string | null; startedAt: number; stoppedAt: number | null; stopping: boolean }
const loops = new Map<string, LoopRecord>();
let loopTick: ReturnType<typeof setInterval> | null = null;

export const isOpen = (): boolean => overlays.isOpen('testing');
const pipeline = (): PipelineConfig | null => data?.pipeline ?? null;
const picked = (): string | null => (sourceTab ? pickedFor.get(sourceTab) ?? null : null);
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
  summary.replaceChildren(data?.project ? `${data.project.name} · ${p?.stages.length ?? 0} stage${p?.stages.length === 1 ? '' : 's'}${p?.keepGoing ? ' · keeps going after a failure' : ''}${p?.autoRun ? ' · runs after Claude’s edits' : ''}` : '');
  if (data?.project && picked()) {
    const change = el('button', 'tst-link tst-change-project', 'Change project');
    change.type = 'button';
    change.addEventListener('click', () => { if (sourceTab) pickedFor.delete(sourceTab); selectedRun = null; selectedStage = null; void load(); });
    summary.append(' · ', change);
  }
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
  drawClaudePipeline();
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

// The pipeline the testing-suite skill wrote to .petal/pipeline.json: in use as the proposal, offered, or refused.
function drawClaudePipeline(): void {
  const claude = data?.claudePipeline;
  if (!claude || draft) return;
  if (claude.problem !== undefined) {
    note.append(el('span', 'tst-claude-pipeline', `Claude’s .petal/pipeline.json was not used: ${claude.problem}.`));
  } else if (claude.offer) {
    const use = el('button', 'tst-link tst-use-claude', 'Use it');
    use.type = 'button';
    use.title = 'Replaces the saved stages. New commands still ask before their first run.';
    use.addEventListener('click', () => void useClaudePipeline());
    note.append(el('span', 'tst-claude-pipeline', 'Claude drew up a new pipeline ·'), use);
  } else if (claude.proposal) {
    note.append(el('span', 'tst-claude-pipeline', 'This pipeline is the one Claude drew up in .petal/pipeline.json.'));
  }
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
    const fromClaude = stagesFromRuns(data.runs);
    strip.append(el('p', 'tst-empty', fromClaude.length ? `No stages yet. Claude ran ${fromClaude.length} check${fromClaude.length === 1 ? '' : 's'} here you can start from.` : 'No stages yet. Edit the pipeline to add the commands this project runs.'));
    if (fromClaude.length && !draft) {
      const make = el('button', 'tst-button tst-make-pipeline', 'Make a pipeline from these commands');
      make.type = 'button';
      make.title = fromClaude.map((s) => `${s.name}: ${s.command}`).join('\n');
      make.addEventListener('click', () => {
        draft = { ...p, stages: fromClaude.map((s) => ({ ...s })) };
        message = 'Check the commands, then save. Each one still asks before its first run.';
        drawAll();
        editor.querySelector<HTMLInputElement>('.tst-edit-name')?.focus();
      });
      strip.append(make);
    }
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
    results.append(data.elsewhere ? projectPicker(data.elsewhere) : el('p', 'tst-empty', 'Open a project in this tab first. Testing shows the project of the tab you are on.'));
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

// The tab is in ~ or outside a repo: no pipeline for it, just the projects she can look at instead.
function projectPicker(elsewhere: Elsewhere): HTMLElement {
  const box = el('div', 'tst-picker');
  const why = elsewhere.reason === 'home' ? 'This tab is in your home folder, not a project.' : `This tab is in ${elsewhere.folder}, which isn’t inside a git repo.`;
  box.append(el('p', 'tst-picker-title', `${why} Pick a project:`));
  if (!elsewhere.projects.length) {
    box.append(el('p', 'tst-muted', 'No recent projects yet. Open a tab in a repo, or cd into one here.'));
    return box;
  }
  const list = el('ul', 'tst-picker-list');
  for (const project of elsewhere.projects) {
    const item = el('li');
    const button = el('button', 'tst-pick');
    button.type = 'button';
    button.dataset.root = project.root;
    button.title = project.root;
    button.append(el('span', 'tst-pick-name', project.name), el('span', 'tst-pick-path', project.root.replace(/^\/Users\/[^/]+/, '~')));
    button.addEventListener('click', () => {
      if (sourceTab) pickedFor.set(sourceTab, project.root);
      selectedRun = null;
      selectedStage = null;
      void load().then(refresh);
    });
    item.append(button);
    list.append(item);
  }
  box.append(list);
  return box;
}

// Each Claude session's distillation goes under that session's newest row in History, once.
function historyExtras(): (row: RunRow) => HTMLElement | null {
  const groups = new Map(bySession(distillation).map((g) => [g.sessionId, g.records]));
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
  if (!data?.project) return;
  const health = suiteHealth({ runs: data.runs, changed: data.changed });
  healthBox.append(el('h3', 'tst-section-title', 'Suite health'), healthPanel(health, data.pipeline.stages, { addCore: (command) => void addCoreStage(command) }, draft !== null));
}

function drawSide(): void {
  historyBox.replaceChildren();
  stackBox.replaceChildren();
  drawHealth();
  if (!data?.project) return;
  historyBox.append(el('h3', 'tst-section-title', 'History'));
  if (data.runs.length) {
    historyBox.append(trend(data.runs, data.pipeline.stages.map((s) => s.id), data.pipeline.stages.map((s) => s.name)), historyList(historyDays(data.runs), selectedRun, expanded, {
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
    historyBox.append(el('p', 'tst-muted', 'No runs yet. Your runs and the tests Claude runs in this project show here.'));
  }
  stackBox.append(el('h3', 'tst-section-title', 'What this project tests with'), stackList(data.stack, insertSkill));
}

// ---- Test loop.
const isLive = (id: string): boolean => tabs.get(id)?.update?.state === 'live';
const loopRecord = (): LoopRecord | null => (data?.project ? loops.get(data.project.root) ?? null : null);
const loopTabId = (): string | null => {
  const record = loopRecord();
  const id = record?.tabId ?? data?.sessionTab ?? null;
  return id && tabs.get(id) ? id : null;
};

function loopFacts() {
  const record = loopRecord();
  const id = loopTabId();
  const update = id ? tabs.get(id)?.update ?? null : null;
  const progress = latestLoop(update?.replies ?? [], record?.startedAt ?? 0);
  const status = loopStatus({ progress, live: id ? isLive(id) : false, startedAt: record?.startedAt ?? null, stoppedAt: record?.stoppedAt ?? null, now: Date.now() });
  return { record, id, progress, status, ...loopDistillation(update, record?.startedAt ?? 0) };
}

// The loop session's rounds: stored ones plus any its tab shows since the loop started; with no loop tab, the newest stored session's.
function loopDistillation(update: tabs.Tab['update'], since: number): { distill: DistillRecord[]; distillKey: string } {
  const sessionId = update?.sessionId ?? null;
  const live = update ? recordsFromReplies(update.replies, sessionId, since) : [];
  const groups = bySession(distillation);
  const stored = sessionId ? groups.find((g) => g.sessionId === sessionId) : groups[0];
  return { distill: mergeRecords(stored?.records ?? [], live), distillKey: (sessionId ?? stored?.sessionId) || 'none' };
}

// Claude's newest result per stage since the loop started.
function claudeStages(since: number): LoopModel['stages'] {
  const p = pipeline();
  if (!p || !data) return [];
  const claudeRuns = data.runs.filter((r) => r.by === 'claude' && r.startedAt >= since);
  if (!claudeRuns.length) return [];
  return p.stages.map((stage) => ({ name: stage.name, status: claudeRuns.find((r) => r.stages.some((s) => s.stageId === stage.id))?.stages.find((s) => s.stageId === stage.id)?.status ?? 'waiting' }));
}

function drawLoop(): void {
  loopPanel.element.hidden = !folderAllowed || !data?.project;
  if (loopPanel.element.hidden) return;
  const { record, progress, status, distill, distillKey } = loopFacts();
  const stages = pipeline()?.stages ?? [];
  const target = loopTarget(data?.sessionTab ?? null, isLive);
  const why = !stages.length ? 'Add pipeline stages first. The loop runs them each round.'
    : target.kind === 'paste' ? 'Claude in this project’s session writes scenarios as tests, runs the pipeline, fixes real bugs and runs again. It never commits.'
      : 'No Claude is running on this project, so Start opens a new tab with Claude and the brief. It never commits.';
  loopPanel.update({
    status, progress, criteria, why,
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
  const id = tabId();
  const p = pipeline();
  if (!id || !data?.project || !p?.stages.length || isActive(loopFacts().status)) return;
  const root = data.project.root;
  const brief = buildLoopBrief({ focus, rounds, stages: p.stages, stack: data.stack });
  const target = loopTarget(data.sessionTab, isLive);
  const reply = await window.pastel.testing.loopStart({ tabId: id, root: picked(), brief, newTab: target.kind === 'new-tab' });
  if (isIpcError(reply) || 'note' in reply) { loopNote = isIpcError(reply) ? `Couldn’t start the loop: ${reply.error}` : reply.note; drawLoop(); return; }
  if (target.kind === 'paste') {
    const tab = tabs.get(target.tabId);
    if (!tab || !(await composer.pasteToClaude(tab, brief))) { loopNote = 'Couldn’t reach Claude in that tab. Try again.'; drawLoop(); return; }
    loopNote = '';
  } else {
    loopNote = reply.tabId ? 'Claude is starting in a new tab with the brief.' : 'Couldn’t open a new tab for Claude.';
    if (!reply.tabId) { drawLoop(); return; }
  }
  loops.set(root, { tabId: target.kind === 'paste' ? target.tabId : reply.tabId, startedAt: Date.now(), stoppedAt: null, stopping: false });
  await refresh();
}

// Esc interrupts the current step; the stop message follows once that claude is idle.
async function stopCurrentLoop(): Promise<void> {
  const id = loopTabId();
  const root = data?.project?.root;
  if (!id || !root) return;
  const record = loops.get(root) ?? { tabId: id, startedAt: 0, stoppedAt: null, stopping: false };
  if (record.stopping) return;
  record.stopping = true;
  loops.set(root, record);
  loopNote = 'Interrupting Claude, then asking it to stop and summarise.';
  drawLoop();
  await stopLoop({
    sendEsc: () => window.pastel.answerPrompt(id, { kind: 'menu', step: { cancel: true } }),
    isIdle: () => !tabs.get(id)?.update?.busy,
    send: async (text) => { const tab = tabs.get(id); return tab ? composer.pasteToClaude(tab, text) : false; },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
  record.stopping = false;
  record.stoppedAt = Date.now();
  loopNote = 'Asked Claude to stop. Its summary shows in that tab.';
  drawLoop();
}

function drawAll(): void {
  drawHead();
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

async function run(stageId: string | null, confirmed: boolean): Promise<void> {
  const id = tabId();
  if (!id) return;
  const reply = await window.pastel.testing.run({ tabId: id, root: picked(), stageId, confirmed });
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
  const reply = await window.pastel.testing.savePipeline({ tabId: id, root: picked(), pipeline: clean });
  if (isIpcError(reply) || 'note' in reply) { message = isIpcError(reply) ? reply.error : reply.note; drawNote(); return; }
  draft = null;
  message = 'Pipeline saved.';
  await load();
  editButton.focus();
}

// Suite health's core stage, first in the pipeline; its new command still asks before its first run.
async function addCoreStage(command: string): Promise<void> {
  const id = tabId();
  const p = pipeline();
  if (!id || !p || draft) return;
  const next: PipelineConfig = { ...p, stages: withCoreStage(p.stages, command) };
  const reply = await window.pastel.testing.savePipeline({ tabId: id, root: picked(), pipeline: next });
  if (isIpcError(reply) || 'note' in reply) { message = isIpcError(reply) ? reply.error : reply.note; drawNote(); return; }
  message = 'Core stage added first. It asks before its first run.';
  selectedStage = null;
  await load();
}

async function useClaudePipeline(): Promise<void> {
  const id = tabId();
  if (!id) return;
  const reply = await window.pastel.testing.useClaudePipeline(id, picked());
  if (isIpcError(reply) || 'note' in reply) { message = isIpcError(reply) ? reply.error : reply.note; drawNote(); return; }
  message = 'Now using Claude’s pipeline.';
  selectedStage = null;
  await load();
  runButton.focus();
}

async function load(): Promise<void> {
  const id = tabId();
  if (!id) return;
  const result = await window.pastel.testing.detect(id, picked());
  if (isIpcError(result)) { message = `Couldn’t read this project: ${result.error}`; drawAll(); return; }
  data = result;
  folderAllowed = result.allowed;
  drawAll();
}

// Runs only: Claude's new runs and finished stages, cheaply, while the tab is open.
async function refresh(): Promise<void> {
  const id = tabId();
  if (!id || !data) return load();
  const result = await window.pastel.testing.history(id, picked());
  if (isIpcError(result) || !data) return;
  data = { ...data, runs: result.runs, running: result.running, sessionTab: result.sessionTab ?? data.sessionTab, claudePipeline: result.claudePipeline };
  criteria = result.criteria;
  distillation = result.distillation;
  if (draft) { drawHead(); drawNote(); drawLoop(); drawResults(); drawSide(); return; } // the editor keeps her typing
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
// A Loop line or a busy flip in the loop's tab shows at once, not on the next poll.
window.pastel.onReplies((update) => { if (isOpen() && data && update.tabId === loopTabId()) queueMicrotask(drawLoop); });
byId('testing-button').addEventListener('click', toggle);
// A run named in a conclusion's This session line: open Testing on it, when it is this project's.
window.addEventListener(OPEN_TEST_RUN_EVENT, (event) => void openRun(String((event as CustomEvent<string>).detail ?? '')));
export async function openRun(runId: string): Promise<void> {
  await open();
  if (!isOpen() || !runById(runId)) return;
  selectedRun = runId;
  selectedStage = null;
  drawAll();
}

// For the snapshot harness.
export const state = () => ({ elsewhere: data?.elsewhere ?? null, picked: picked(), sessionTab: data?.sessionTab ?? null, loop: loopFacts().status, distillation: loopFacts().distill.length, loopProgress: loopFacts().progress, loopTab: loopTabId(), project: data?.project?.name ?? null, stages: data?.pipeline.stages.map((s) => s.name) ?? [], runs: data?.runs.length ?? 0, selectedRun, selectedStage, editing: draft !== null, claudePipeline: data?.claudePipeline ?? null, confirming: confirming?.commands.map((c) => c.command) ?? null, sourceTab });

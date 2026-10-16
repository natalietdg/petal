// The Testing tab's pieces, built from data: the pipeline strip, a stage's grouped results, history with its trend,
// and what the project tests with. testing.ts owns the state and wires the handlers passed in here.
import { el } from './dom';
import { groupByFile, passRate, type PipelineConfig, type PipelineRun, type StackItem, type StageResult, type StageStatus, type TestCase } from '../shared/testing';

const TREND_RUNS = 24;
const STATUS_WORD: Record<StageStatus, string> = { waiting: 'Not run', running: 'Running', passed: 'Passed', failed: 'Failed', skipped: 'Skipped', stopped: 'Stopped' };

export function duration(ms: number | null): string {
  if (ms === null) return '';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

export function when(at: number, now = Date.now()): string {
  const minutes = Math.round((now - at) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export const byLabel = (run: PipelineRun): string => (run.by === 'claude' ? 'by Claude' : run.trigger === 'auto' ? 'auto, after Claude’s turn' : 'by you');

const dot = (status: string): HTMLElement => {
  const node = el('span', `tst-dot is-${status}`);
  node.setAttribute('aria-hidden', 'true');
  return node;
};

// ---- The pipeline: stage chips left to right, joined by a line.
export interface StripHandlers { select: (stageId: string) => void; runStage: (stageId: string) => void }

export function pipelineStrip(pipeline: PipelineConfig, resultOf: (stageId: string) => StageResult | null, selected: string | null, handlers: StripHandlers, busy: boolean): HTMLElement {
  const list = el('ol', 'tst-pipeline');
  list.setAttribute('aria-label', 'Pipeline stages');
  pipeline.stages.forEach((stage, i) => {
    const result = resultOf(stage.id);
    const status: StageStatus = result?.status ?? 'waiting';
    const item = el('li', `tst-stage-item is-${status}`);
    const chip = el('button', 'tst-stage');
    chip.type = 'button';
    chip.dataset.stage = stage.id;
    chip.setAttribute('aria-pressed', String(stage.id === selected));
    chip.title = stage.command;
    const meta = [STATUS_WORD[status], duration(result?.durationMs ?? null), result && (result.counts.failed || result.counts.passed) ? `${result.counts.failed ? `${result.counts.failed} failed` : `${result.counts.passed} passed`}` : ''].filter(Boolean).join(' · ');
    chip.append(dot(status), el('span', 'tst-stage-text'));
    chip.lastElementChild?.append(el('span', 'tst-stage-name', stage.name), el('span', 'tst-stage-meta', meta));
    chip.setAttribute('aria-label', `Stage ${i + 1}, ${stage.name}: ${meta}`);
    chip.addEventListener('click', () => handlers.select(stage.id));
    const alone = el('button', 'tst-stage-run', 'Run');
    alone.type = 'button';
    alone.disabled = busy;
    alone.setAttribute('aria-label', `Run ${stage.name} alone`);
    alone.title = `Run only ${stage.name}: ${stage.command}`;
    alone.addEventListener('click', () => handlers.runStage(stage.id));
    item.append(chip, alone);
    list.append(item);
  });
  return list;
}

// ---- One stage's results: a summary bar, then groups by file with failures first and open.
export interface ResultHandlers { fixTest: (stage: StageResult, test: TestCase) => void; fixStage: (stage: StageResult) => void }

function summaryBar(stage: StageResult, run: PipelineRun, handlers: ResultHandlers): HTMLElement {
  const bar = el('div', `tst-sumbar is-${stage.status}`);
  const counts = el('div', 'tst-counts');
  const pill = (n: number, word: string, cls: string) => { const p = el('span', `tst-count ${cls}`); p.append(el('strong', null, String(n)), ` ${word}`); return p; };
  counts.append(pill(stage.counts.passed, 'passed', 'is-passed'), pill(stage.counts.failed, 'failed', 'is-failed'), pill(stage.counts.skipped, 'skipped', 'is-skipped'));
  const facts = el('p', 'tst-facts');
  facts.append(el('span', 'tst-status-word', STATUS_WORD[stage.status]), ...[duration(stage.durationMs), when(run.startedAt), byLabel(run)].filter(Boolean).map((t) => el('span', null, t)));
  const command = el('code', 'tst-command', stage.command);
  bar.append(counts, facts, command);
  if (stage.status === 'failed') {
    const fix = el('button', 'tst-fix tst-fix-stage', 'Ask Claude to fix');
    fix.type = 'button';
    fix.title = 'Send the failing tests and their output to Claude in this tab';
    fix.addEventListener('click', () => handlers.fixStage(stage));
    bar.append(fix);
  }
  return bar;
}

function testRow(stage: StageResult, test: TestCase, handlers: ResultHandlers): HTMLElement {
  const row = el('li', `tst-row is-${test.status}`);
  const line = el('div', 'tst-row-line');
  line.append(dot(test.status), el('span', 'tst-row-name', test.name), el('span', 'tst-row-time', duration(test.durationMs)));
  line.querySelector('.tst-dot')?.setAttribute('aria-label', test.status);
  line.querySelector('.tst-dot')?.removeAttribute('aria-hidden');
  line.querySelector('.tst-dot')?.setAttribute('role', 'img');
  row.append(line);
  if (test.status === 'failed') {
    if (test.failure) {
      const pre = el('pre', 'tst-failure');
      pre.append(el('code', null, test.failure));
      pre.tabIndex = 0;
      pre.setAttribute('aria-label', `Failure output for ${test.name}`);
      row.append(pre);
    }
    const fix = el('button', 'tst-fix', 'Ask Claude to fix');
    fix.type = 'button';
    fix.addEventListener('click', () => handlers.fixTest(stage, test));
    row.append(fix);
  }
  return row;
}

export function stageResults(stage: StageResult | null, run: PipelineRun | null, handlers: ResultHandlers): HTMLElement {
  const box = el('div', 'tst-results-body');
  if (!stage || !run) {
    box.append(el('p', 'tst-empty', 'This stage hasn’t run yet. Run it alone or run the whole pipeline.'));
    return box;
  }
  box.append(summaryBar(stage, run, handlers));
  if (stage.status === 'running' || stage.status === 'waiting') box.append(el('p', 'tst-empty', stage.status === 'running' ? 'Running in its tab. Results show here when the stage ends.' : 'Waiting for the stages before it.'));
  const groups = groupByFile(stage.tests);
  for (const group of groups) {
    const details = el('details', `tst-group${group.failed ? ' is-failed' : ''}`);
    details.open = group.failed;
    const summary = el('summary', 'tst-group-head');
    const tally = [group.counts.failed && `${group.counts.failed} failed`, group.counts.passed && `${group.counts.passed} passed`, group.counts.skipped && `${group.counts.skipped} skipped`].filter(Boolean).join(' · ');
    summary.append(dot(group.failed ? 'failed' : group.counts.passed ? 'passed' : 'skipped'), el('span', 'tst-group-file', group.file), el('span', 'tst-group-tally', tally));
    const rows = el('ul', 'tst-rows');
    for (const test of group.tests) rows.append(testRow(stage, test, handlers));
    details.append(summary, rows);
    box.append(details);
  }
  // A typecheck or lint failure has no tests, only output.
  if (!groups.some((g) => g.failed) && stage.status === 'failed' && stage.output) {
    const pre = el('pre', 'tst-failure tst-stage-output');
    pre.tabIndex = 0;
    pre.setAttribute('aria-label', `${stage.name} output`);
    pre.append(el('code', null, stage.output));
    box.append(el('h4', 'tst-sub', 'Output'), pre);
  }
  if (!groups.length && stage.status === 'passed') box.append(el('p', 'tst-empty', 'Passed. No per-test results for this stage.'));
  return box;
}

// ---- History: pass or fail per run and stacked stage durations, oldest left; then the run list.
export function trend(runs: PipelineRun[], stageIds: string[], stageNames: string[] = []): HTMLElement {
  const recent = runs.filter((r) => r.state !== 'running').slice(0, TREND_RUNS).reverse();
  const box = el('div', 'tst-trend');
  box.setAttribute('role', 'img');
  const passed = recent.filter((r) => r.state === 'passed').length;
  box.setAttribute('aria-label', `Last ${recent.length} runs: ${passed} passed, ${recent.length - passed} failed`);
  const rate = el('div', 'tst-bars');
  const times = el('div', 'tst-bars tst-durations');
  const longest = Math.max(1, ...recent.map((r) => r.stages.reduce((sum, s) => sum + (s.durationMs ?? 0), 0)));
  for (const run of recent) {
    const bar = el('span', `tst-bar is-${run.state}`);
    bar.style.height = `${Math.max(10, Math.round(passRate(run) * 100))}%`;
    bar.title = `${when(run.startedAt)} · ${run.state} · ${run.totals.passed} passed, ${run.totals.failed} failed`;
    rate.append(bar);
    const stack = el('span', 'tst-stack');
    for (const stage of run.stages) {
      const part = el('span', `tst-part tone-${Math.max(0, stageIds.indexOf(stage.stageId ?? '')) % 5}`);
      part.style.height = `${((stage.durationMs ?? 0) / longest) * 100}%`;
      part.title = `${stage.name} ${duration(stage.durationMs)}`;
      stack.append(part);
    }
    times.append(stack);
  }
  box.append(el('span', 'tst-trend-label', 'Pass rate'), rate, el('span', 'tst-trend-label', 'Stage time'), times);
  const legend = el('ul', 'tst-legend');
  legend.setAttribute('aria-hidden', 'true'); // the bars' titles and the run list carry the same facts
  stageNames.forEach((name, i) => {
    const item = el('li');
    item.append(el('span', `tst-key tone-${i % 5}`), name);
    legend.append(item);
  });
  if (stageNames.length) box.append(legend);
  return box;
}

export function runList(runs: PipelineRun[], selectedId: string | null, choose: (id: string) => void): HTMLElement {
  const list = el('ul', 'tst-runs');
  list.setAttribute('aria-label', 'Runs, newest first');
  for (const run of runs.slice(0, 40)) {
    const item = el('li');
    const button = el('button', 'tst-run');
    button.type = 'button';
    button.dataset.run = run.id;
    button.setAttribute('aria-pressed', String(run.id === selectedId));
    const label = run.stages.length === 1 ? run.stages[0].name : `Pipeline, ${run.stages.length} stages`;
    const tally = run.totals.failed || run.totals.passed ? `${run.totals.failed ? `${run.totals.failed} failed · ` : ''}${run.totals.passed} passed` : STATUS_WORD[run.state === 'running' ? 'running' : run.state];
    const top = el('span', 'tst-run-top');
    top.append(dot(run.state), el('span', 'tst-run-name', label), el('span', `tst-by${run.by === 'claude' ? ' is-claude' : ''}`, byLabel(run)));
    button.append(top, el('span', 'tst-run-meta', `${when(run.startedAt)} · ${tally}`));
    button.addEventListener('click', () => choose(run.id));
    item.append(button);
    list.append(item);
  }
  return list;
}

// ---- What the project tests with, each with where it was found; skills and agents can go into the reply box.
const KIND_WORD: Record<StackItem['kind'], string> = { unit: 'Tests', e2e: 'End to end', mobile: 'Mobile', load: 'Load', lint: 'Checks', ci: 'CI', skill: 'Skill', agent: 'Agent', command: 'Command' };

export function stackList(stack: StackItem[], insert: (item: StackItem) => void): HTMLElement {
  const box = el('div', 'tst-stack-list');
  const tools = stack.filter((s) => !s.insert);
  const skills = stack.filter((s) => s.insert);
  const section = (title: string, items: StackItem[], empty: string) => {
    box.append(el('h4', 'tst-sub', title));
    if (!items.length) { box.append(el('p', 'tst-muted', empty)); return; }
    const list = el('ul', 'tst-tools');
    for (const item of items) {
      const row = el('li', 'tst-tool');
      const head = el('div', 'tst-tool-head');
      head.append(el('span', 'tst-tool-name', item.label), el('span', 'tst-kind', KIND_WORD[item.kind]));
      row.append(head);
      if (item.detail) row.append(el('p', 'tst-tool-detail', item.detail));
      row.append(el('p', 'tst-found', `found in ${item.foundIn}`));
      if (item.insert) {
        const add = el('button', 'tst-insert', 'Use in reply');
        add.type = 'button';
        add.dataset.insert = item.insert.trim();
        add.setAttribute('aria-label', `Put ${item.insert.trim()} in the reply box`);
        add.addEventListener('click', () => insert(item));
        row.append(add);
      }
      list.append(row);
    }
    box.append(list);
  };
  section('Tools', tools, 'No test tools found in this project’s files.');
  section('Skills and agents', skills, 'No testing skills or agents in your Claude folder or this project.');
  return box;
}

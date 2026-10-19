// Renders a session's "flow of outcomes": step cards on a thin line, each with the decisions logged during it, plus the Mermaid export bar.
import * as diagrams from './diagrams';
import { el, isIpcError } from './dom';
import { decisionsByStep, hasDecision, type StepDecision } from './flow-decisions';
import type { Who } from './ledger-actor';
import type { FlowStep, Outcome, StateChange } from '../main/flow';
import type { FlowView, Guarded } from '../shared/ipc';
import type { FlowTarget } from '../shared/types';

export type FlowResult = Guarded<FlowView | null>;
type StoredView = Extract<FlowView, { steps: FlowStep[] }>;

export interface FlowOptions {
  target: FlowTarget;
  onJump: (step: FlowStep) => void;
  onCreated?: () => void;
}

// The export bar keeps its last chart source on the element, where the snapshot run reads it.
interface ExportBar extends HTMLDivElement {
  lastSource?: string;
}

const TITLES: Record<string, string> = { done: 'Done', decide: 'Decide', watch: 'Watch out', next: 'Next', why: 'Why' };
const WHO: Record<Who, string> = { you: 'you', claude: 'Claude', external: 'someone else' };
const CREATING_RECHECK_MS = 3000;

function outcomeLine({ label, text }: Outcome): HTMLParagraphElement {
  const line = el('p', `flow-outcome callout callout-${label}`);
  line.append(el('span', 'pill', TITLES[label]), document.createTextNode(` ${text}`));
  return line;
}

// One change: "What: from → to". A missing "from" means it's new.
function changeRow({ what, from, to }: StateChange): HTMLDivElement {
  const row = el('div', 'change');
  if (what) row.append(el('span', 'change-what', what));
  const states = el('span', 'change-states');
  if (from) states.append(el('span', 'change-from', from), el('span', 'change-arrow', '→'));
  else if (what) states.append(el('span', 'change-new', 'new'));
  states.append(el('span', 'change-to', to));
  row.append(states);
  return row;
}

// One ledger decision on its step: who made it, its number, and whether a later one replaced it.
function decisionRow(decision: StepDecision): HTMLDivElement {
  const row = el('div', `flow-decision${decision.superseded ? ' superseded' : ''}`);
  const head = el('div', 'flow-decision-head');
  head.append(el('span', `flow-actor actor-${decision.who}`, `Decided by ${WHO[decision.who]}`), el('span', 'flow-decision-tag', `#${decision.n}`));
  if (decision.recommended) head.append(el('span', 'flow-decision-tag', 'Claude recommended'));
  if (decision.superseded) head.append(el('span', 'flow-decision-tag', 'later replaced'));
  row.append(head, el('p', 'flow-decision-what', decision.what));
  return row;
}

// A step card lists what changed and what was decided; the conversation itself lives in Replies.
function stepCard(step: FlowStep, onJump: FlowOptions['onJump'], decisions: StepDecision[] = []): HTMLElement {
  const card = el('article', `flow-step${step.waitingOnYou ? ' waiting' : ''}`);
  card.append(el('span', 'flow-dot'));
  const head = el('button', 'flow-step-head');
  head.type = 'button';
  head.append(el('span', 'flow-step-n', `${step.index}`), el('span', 'flow-title', step.title || step.label));
  head.addEventListener('click', () => onJump(step));
  card.append(head);
  for (const change of step.changes ?? []) card.append(changeRow(change));
  if (decisions.length) card.append(...decisions.map(decisionRow));
  if (step.waitingOnYou) {
    const decide = step.outcomes.filter((o) => o.label === 'decide').at(-1);
    card.append(el('span', 'flow-waiting', 'waiting on you'), ...(decide ? [outcomeLine(decide)] : []));
  }
  return card;
}

// Steps that changed and decided nothing are just talk: they fold away.
const foldsAway = (step: FlowStep): boolean => !hasDecision(step) && (step.quiet || (!(step.changes?.length) && !step.waitingOnYou));

// Runs of quiet steps fold into one "N quiet steps" row that expands on click.
function quietRun(steps: FlowStep[], onJump: FlowOptions['onJump']): HTMLButtonElement {
  const row = el('button', 'flow-quiet', `${steps.length} step${steps.length === 1 ? '' : 's'} with no changes`);
  row.type = 'button';
  row.addEventListener('click', () => row.replaceWith(...steps.map((s) => stepCard(s, onJump))));
  return row;
}

function exportBar(target: FlowTarget): ExportBar {
  const bar: ExportBar = el('div', 'flow-export');
  const status = el('span', 'flow-export-status');
  const preview = el('div', 'flow-export-preview');
  const button = (label: string, action: () => unknown) => {
    const b = el('button', 'flow-button', label);
    b.type = 'button';
    b.addEventListener('click', action);
    return b;
  };
  let all = false;

  async function prepare(): Promise<void> {
    const result = await window.pastel.flow.mermaid(target, all);
    if (!result) return;
    if (isIpcError(result)) {
      status.textContent = `Couldn’t export the chart: ${result.error}`;
      return;
    }
    const valid = await diagrams.validate(result.source);
    bar.dataset.valid = String(valid);
    if (!valid) {
      status.textContent = 'This flow could not be turned into a valid chart.';
      return;
    }
    status.textContent = result.capped
      ? `Chart shows the latest ${result.exported} of ${result.total} steps.`
      : `Chart covers all ${result.total} steps.`;
    actions.replaceChildren(
      button('Copy', async () => {
        const copied = await window.pastel.flow.copyMermaid(target, all);
        if (isIpcError(copied)) status.textContent = `Copy failed: ${copied.error}`;
        else status.textContent = copied.ok ? 'Copied Mermaid source.' : 'Copy failed.';
      }),
      button('Save .mmd', async () => {
        const saved = await window.pastel.flow.saveMermaid(target, all);
        if (isIpcError(saved)) status.textContent = `Couldn’t save: ${saved.error}`;
        else if (saved.ok) status.textContent = `Saved ${saved.filePath}`;
      }),
      button('Preview', () => diagrams.renderSource(preview, result.source)),
      ...(result.capped ? [button('Export all', () => { all = true; prepare(); })] : []),
    );
    bar.lastSource = result.source;
  }

  const actions = el('span', 'flow-export-actions');
  actions.append(button('Export Mermaid', prepare));
  bar.append(actions, status, preview);
  return bar;
}

// Flows are made on demand and stored; this only builds one when she asks.
function createButton(label: string, container: HTMLElement, options: FlowOptions): HTMLButtonElement {
  const button = el('button', 'flow-button', label);
  button.type = 'button';
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'Making the flow…';
    render(container, await window.pastel.flow.create(options.target), options);
    options.onCreated?.();
  });
  return button;
}

function emptyState(container: HTMLElement, options: FlowOptions, creating: boolean): void {
  const box = el('div', 'flow-empty');
  const action = createButton('Create flow', container, options);
  if (creating) {
    // Already being made (a refresh landed mid-create): show progress and check back, never a second button.
    action.disabled = true;
    action.textContent = 'Making the flow…';
    setTimeout(async () => {
      if (container.isConnected) render(container, await window.pastel.flow.get(options.target), options);
    }, CREATING_RECHECK_MS);
  }
  box.append(
    el('p', 'flow-empty-title', creating ? 'Making the flow…' : 'No flow for this session yet'),
    el('p', 'flow-empty-text', 'A flow lays out each thing you asked and what came of it. It’s made once and kept.'),
    action,
  );
  container.replaceChildren(box);
}

function staleNote(flow: StoredView, container: HTMLElement, options: FlowOptions): HTMLDivElement {
  const stale = el('div', 'flow-stale');
  if (flow.stale) {
    stale.append(el('span', '', 'This session has continued since the flow was made. '), createButton('Update flow', container, options));
  }
  return stale;
}

export function render(container: HTMLElement, flow: FlowResult, options: FlowOptions): void {
  const { target, onJump } = options;
  container.classList.add('prose');
  if (!flow) {
    container.replaceChildren(el('p', 'status empty', 'No session to show a flow for.'));
    return;
  }
  if ('error' in flow) {
    container.replaceChildren(el('p', 'history-error', `Couldn’t make or load the flow: ${flow.error}`), createButton('Try again', container, options));
    return;
  }
  if ('empty' in flow) return emptyState(container, options, flow.creating);
  const stale = staleNote(flow, container, options);
  if (!flow.steps.length) {
    container.replaceChildren(stale, el('p', 'status empty', 'No steps in this session yet.'));
    return;
  }
  const decisions = decisionsByStep(flow.steps);
  const line = el('div', 'flow-line');
  let quiet: FlowStep[] = [];
  const flushQuiet = () => {
    if (quiet.length) line.append(quietRun(quiet, onJump));
    quiet = [];
  };
  for (const step of flow.steps) {
    if (foldsAway(step)) { quiet.push(step); continue; }
    flushQuiet();
    line.append(stepCard(step, onJump, decisions.get(step)));
  }
  flushQuiet();
  if (flow.finalNext) {
    const last = outcomeLine(flow.finalNext);
    last.classList.add('flow-final');
    line.append(last);
  }
  container.replaceChildren(stale, exportBar(target), line);
}


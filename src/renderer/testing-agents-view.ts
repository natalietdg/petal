// The two agents of a task's test loop, side by side: a live lane each (her name for it, its tab, what it is doing,
// tokens so far, an action log), the last round's tokens next to the estimate, then the bug queue between them.
// testing-agents.ts owns the state and the handoffs.
import { el } from './dom';
import { when } from './testing-view';
import { BUG_STATES, BUG_STATE_WORDS, queueCounts, type QueuedBug } from '../shared/bug-queue';
import { roundSummaries, type AgentAction } from '../shared/agent-actions';
import { AGENT_NAME_MAX, type AgentRole } from '../shared/agent-names';
import { tokenText, usageText, type RoundEstimate } from '../shared/token-usage';
import { render } from './markdown';
import { chatPlaceholder, type ChatTurn, type LaneReach } from '../shared/agent-chat';
import type { LoopEvent } from '../shared/testing';
import type { CriteriaItem } from '../shared/test-loop';
import { SOURCE_WORD } from './testing-loop-view';

const LOG_PAGE = 20;

export type PetalEvent = LoopEvent;

export interface LaneModel {
  role: AgentRole;
  name: string;
  started: boolean; // Petal started this agent for the task
  tabId: string | null; // its tab, when open here
  reach: LaneReach; // how her message gets to it
  status: string; // what it is doing now
  busy: boolean;
  needsYou: boolean; // a prompt on its screen waits on her
  tokens: Spent | null; // null before it started
  actions: AgentAction[]; // oldest first
  events: PetalEvent[]; // Petal's own: handoffs, queue moves, restores, suite changes
  turns: ChatTurn[]; // the last few turns of its session, oldest first
  startedAt: number; // when the loop started; 0 before
  note: string; // why her last message didn't go, or that it did
  review: { scenarios: CriteriaItem[] } | null; // the testing agent's [todo] scenarios she hasn't approved yet
}

export interface Spent { total: number; cached: number } // cached: the cache reads among them

export interface AgentsModel {
  lanes: LaneModel[];
  queue: QueuedBug[] | null; // null until the loop starts
  estimate: RoundEstimate | null; // tokens per round for both agents
  round: { label: string; tokens: number; cached: number } | null; // the last round's actual tokens, once the loop started
  total: Spent | null; // tokens so far, once an agent started
  close: { count: number; asking: boolean; closing: boolean } | null; // Close agents, once they are idle or the loop is over
  renaming: AgentRole | null;
  logOpen: ReadonlySet<AgentRole>;
  logShown: Partial<Record<AgentRole, number>>; // entries shown, grows with Show older
  view: Partial<Record<AgentRole, 'chat' | 'actions'>>;
  drafts: Partial<Record<AgentRole, string>>;
}

export interface AgentsHandlers {
  rename: (role: AgentRole | null) => void; // start or cancel renaming
  saveName: (role: AgentRole, name: string) => void;
  openTab: (tabId: string) => void;
  reopen: (role: AgentRole) => void; // its saved session in a new tab
  toggleLog: (role: AgentRole) => void;
  showOlder: (role: AgentRole) => void;
  setView: (role: AgentRole, view: 'chat' | 'actions') => void;
  draft: (role: AgentRole, text: string) => void;
  send: (role: AgentRole, text: string) => void;
  askClose: (asking: boolean) => void; // show or cancel the confirm
  close: () => void;
  editScenarios: () => void;
  approveScenarios: () => void;
}

type LogRow = { at: number; text: string; detail: string; kind: string; tokens: number; cached: number };

function nameEditor(lane: LaneModel, on: AgentsHandlers): HTMLElement {
  const form = el('form', 'tst-agent-rename');
  const input = el('input', 'tst-input tst-agent-name-input');
  Object.assign(input, { value: lane.name, maxLength: AGENT_NAME_MAX, spellcheck: false });
  input.setAttribute('aria-label', `Name for the ${lane.role === 'tester' ? 'testing' : 'bug fix'} agent. Empty puts the default back.`);
  const save = el('button', 'tst-link', 'Save');
  save.type = 'submit';
  const cancel = el('button', 'tst-link', 'Cancel');
  cancel.type = 'button';
  cancel.addEventListener('click', () => on.rename(null));
  form.addEventListener('submit', (event) => { event.preventDefault(); on.saveName(lane.role, input.value); });
  input.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.stopPropagation(); on.rename(null); } });
  form.append(input, save, cancel);
  queueMicrotask(() => input.select());
  return form;
}

function logRows(lane: LaneModel): LogRow[] {
  const rows: LogRow[] = [
    ...lane.actions.map((a) => ({ at: a.at, text: a.kind === 'refused' ? a.text.replace(/^Refused: /, `Refused: ${lane.name} `) : a.text, detail: a.detail, kind: a.kind, tokens: a.tokens, cached: a.cached ?? 0 })),
    ...lane.events.map((e) => ({ at: e.at, text: e.text, detail: '', kind: 'petal', tokens: 0, cached: 0 })),
  ];
  return rows.sort((a, b) => b.at - a.at); // newest first
}

// Her messages and the agent's replies, in the reader's style, then a reply box that sends through the reply box's path.
function chat(lane: LaneModel, model: AgentsModel, on: AgentsHandlers): HTMLElement {
  const box = el('div', 'tst-agent-chat');
  const turns = el('ol', 'tst-agent-turns');
  for (const turn of lane.turns) {
    const item = el('li', 'tst-agent-turn');
    item.dataset.turn = turn.id;
    if (turn.prompt) item.append(el('p', 'tst-agent-prompt', turn.prompt.length > 400 ? `${turn.prompt.slice(0, 399)}…` : turn.prompt));
    if (turn.markdown) { const reply = render(turn.markdown); reply.classList.add('tst-agent-reply'); item.append(reply); }
    turns.append(item);
  }
  if (!lane.turns.length) turns.append(el('li', 'tst-muted', lane.tabId ? 'No replies yet.' : lane.started ? 'Its tab isn’t open in this window.' : 'Start the loop to chat with this agent.'));
  const refusal = lane.actions.filter((a) => a.kind === 'refused' && a.at >= lane.startedAt).at(-1); // the newest since the loop started
  const form = el('form', 'tst-agent-send');
  const input = el('textarea', 'tst-input tst-agent-input');
  const reachable = lane.reach === 'tab' || lane.reach === 'reopen';
  Object.assign(input, { rows: 2, value: model.drafts[lane.role] ?? '', placeholder: chatPlaceholder(lane.name, lane.reach) });
  input.setAttribute('aria-label', `Message ${lane.name}`);
  input.disabled = !reachable;
  input.addEventListener('input', () => on.draft(lane.role, input.value));
  input.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); } });
  const send = el('button', 'tst-button tst-agent-send-button', 'Send');
  send.type = 'submit';
  send.disabled = !reachable;
  form.addEventListener('submit', (event) => { event.preventDefault(); on.send(lane.role, input.value); });
  form.append(input, send);
  box.append(turns);
  if (refusal) box.append(el('p', 'tst-agent-refusal', refusal.text.replace(/^Refused: /, `Refused: ${lane.name} `)));
  box.append(form);
  if (lane.note) box.append(el('p', 'tst-muted tst-agent-note', lane.note));
  return box;
}

function actionLog(lane: LaneModel, model: AgentsModel, on: AgentsHandlers): HTMLElement {
  const rows = logRows(lane);
  const box = el('details', 'tst-agent-log');
  box.open = model.logOpen.has(lane.role);
  const summary = el('summary', 'tst-agent-log-head', `Action log · ${rows.length} step${rows.length === 1 ? '' : 's'}`);
  summary.addEventListener('click', (event) => { event.preventDefault(); on.toggleLog(lane.role); });
  box.append(summary);
  if (!box.open) return box;
  const rounds = roundSummaries(lane.actions);
  if (rounds.length) {
    const list = el('ul', 'tst-agent-rounds');
    for (const r of rounds) list.append(el('li', null, r.text));
    box.append(list);
  }
  const shown = model.logShown[lane.role] ?? LOG_PAGE;
  const list = el('ol', 'tst-agent-steps');
  for (const row of rows.slice(0, shown)) {
    const item = el('li', `tst-agent-step is-${row.kind}`);
    const line = el('span', 'tst-agent-step-line');
    line.append(el('span', 'tst-agent-step-time', new Date(row.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })), el('span', 'tst-agent-step-text', row.text));
    if (row.tokens) line.append(el('span', 'tst-agent-step-tokens', usageText(row.tokens, row.cached)));
    if (row.detail) { // a diff, an output tail, the files read
      const more = el('details', 'tst-agent-step-more');
      const head = el('summary');
      head.append(line);
      const pre = el('pre', 'tst-agent-step-detail');
      pre.append(el('code', null, row.detail));
      more.append(head, pre);
      item.append(more);
    } else item.append(line);
    list.append(item);
  }
  box.append(list);
  if (rows.length > shown) {
    const older = el('button', 'tst-link tst-agent-older', 'Show older');
    older.type = 'button';
    older.addEventListener('click', () => on.showOlder(lane.role));
    box.append(older);
  }
  return box;
}

// Scenarios first: the rules tests will be written from, for her to read, edit or accept before their tests exist.
function scenarioReview(lane: LaneModel, scenarios: CriteriaItem[], on: AgentsHandlers): HTMLElement {
  const box = el('div', 'tst-scenario-review');
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', 'Scenarios to review');
  const many = scenarios.length !== 1;
  box.append(el('p', 'tst-scenario-intro', `${scenarios.length} scenario${many ? 's' : ''} from ${lane.name} wait${many ? '' : 's'} for your review. ${many ? 'Their' : 'Its'} tests get written once you say so.`));
  const list = el('ul', 'tst-scenario-list');
  for (const item of scenarios) {
    const row = el('li', 'tst-scenario');
    row.append(el('span', 'tst-scenario-name', item.name));
    if (item.source) row.append(el('span', `tst-crit-tag is-source is-${item.source}`, SOURCE_WORD[item.source]));
    list.append(row);
  }
  const actions = el('div', 'tst-actions');
  const edit = el('button', 'tst-button tst-edit-scenarios', 'Edit scenarios');
  edit.type = 'button';
  edit.title = 'Opens this task’s criteria file in your editor';
  edit.addEventListener('click', () => on.editScenarios());
  const approve = el('button', 'tst-button tst-primary tst-approve-scenarios', 'Looks right · write the tests');
  approve.type = 'button';
  approve.title = `Tells ${lane.name} in its tab to write the tests`;
  approve.addEventListener('click', () => on.approveScenarios());
  actions.append(edit, approve);
  box.append(list, actions);
  if (lane.note) box.append(el('p', 'tst-muted tst-agent-note', lane.note));
  return box;
}

function laneEl(lane: LaneModel, model: AgentsModel, on: AgentsHandlers): HTMLElement {
  const box = el('section', `tst-agent-lane is-${lane.role}${lane.busy ? ' is-busy' : ''}${lane.needsYou ? ' is-needs-you' : ''}`);
  box.dataset.role = lane.role;
  box.setAttribute('aria-label', lane.name);
  const head = el('div', 'tst-agent-head');
  if (model.renaming === lane.role) head.append(nameEditor(lane, on));
  else {
    const name = el('h4', 'tst-agent-name', lane.name);
    const rename = el('button', 'tst-icon tst-agent-rename-button', '✎');
    rename.type = 'button';
    rename.title = 'Rename';
    rename.setAttribute('aria-label', `Rename ${lane.name}`);
    rename.addEventListener('click', () => on.rename(lane.role));
    head.append(name, rename);
  }
  if ((lane.tabId && !lane.needsYou) || lane.reach === 'reopen') { // Needs you has its own Show its tab
    const open = el('button', 'tst-link tst-agent-tab', 'Open tab');
    open.type = 'button';
    open.addEventListener('click', () => (lane.tabId ? on.openTab(lane.tabId) : on.reopen(lane.role)));
    head.append(open);
  }
  const facts = el('p', 'tst-agent-status');
  const dot = el('span', `tst-dot is-${lane.needsYou ? 'needs-you' : lane.busy ? 'running' : 'waiting'}`);
  dot.setAttribute('aria-hidden', 'true');
  facts.append(dot, el('span', lane.needsYou ? 'tst-agent-needs' : null, lane.status));
  if (lane.needsYou && lane.tabId) {
    const show = el('button', 'tst-link tst-agent-show', 'Show its tab');
    show.type = 'button';
    show.addEventListener('click', () => on.openTab(lane.tabId as string));
    facts.append(show);
  }
  if (lane.tokens !== null) facts.append(el('span', 'tst-agent-tokens', usageText(lane.tokens.total, lane.tokens.cached)));
  box.append(head, facts);
  if (!lane.started) return box;
  if (lane.review) { box.append(scenarioReview(lane, lane.review.scenarios, on)); return box; } // her review comes before chat
  const view = model.view[lane.role] ?? 'chat';
  const switcher = el('div', 'tst-agent-views');
  switcher.setAttribute('role', 'group');
  switcher.setAttribute('aria-label', `${lane.name}: chat or actions`);
  for (const [value, label] of [['chat', 'Chat'], ['actions', 'Actions']] as const) {
    const b = el('button', 'tst-agent-view', label);
    b.type = 'button';
    b.dataset.view = value;
    b.setAttribute('aria-pressed', String(view === value));
    b.addEventListener('click', () => on.setView(lane.role, value));
    switcher.append(b);
  }
  box.append(switcher, view === 'chat' ? chat(lane, model, on) : actionLog(lane, model, on));
  return box;
}

function queueEl(queue: QueuedBug[]): HTMLElement {
  const box = el('section', 'tst-queue');
  box.setAttribute('aria-label', 'Bug queue');
  const counts = queueCounts(queue);
  const head = el('p', 'tst-queue-head');
  head.append(el('strong', null, 'Bug queue'), ...BUG_STATES.filter((s) => counts[s] || s !== 'recheck').map((s) => el('span', `tst-queue-count is-${s}`, `${BUG_STATE_WORDS[s]} ${counts[s]}`)));
  box.append(head);
  if (!queue.length) { box.append(el('p', 'tst-muted', 'No bugs yet. Bugs the testing agent files show here.')); return box; }
  const list = el('ul', 'tst-queue-list');
  for (const bug of [...queue].sort((a, b) => BUG_STATES.indexOf(a.state) - BUG_STATES.indexOf(b.state) || a.since - b.since)) {
    const item = el('li', `tst-queue-bug is-${bug.state}`);
    item.dataset.bug = bug.key;
    item.append(el('span', `tst-queue-state is-${bug.state}`, BUG_STATE_WORDS[bug.state]), el('span', 'tst-queue-name', `${bug.name}${bug.rechecked ? ' · rechecked' : ''}`), el('span', 'tst-queue-when', when(bug.since)));
    list.append(item);
  }
  box.append(list);
  return box;
}

export function agentsPanel(model: AgentsModel, on: AgentsHandlers): HTMLElement {
  const box = el('div', 'tst-agents');
  const lanes = el('div', 'tst-agent-lanes');
  for (const lane of model.lanes) lanes.append(laneEl(lane, model, on));
  box.append(lanes);
  const e = model.estimate;
  if (!model.queue && e) box.append(el('p', 'tst-muted tst-agent-estimate', `About ${tokenText(e.tokens)} tokens per round for both agents. ${e.rounds ? `The average of this task’s last ${e.rounds === 1 ? 'round' : `${e.rounds} rounds`}.` : 'A rough estimate from the briefs and the last run’s output.'}`));
  if (model.round) box.append(el('p', 'tst-muted tst-agent-round', `${model.round.label}: ${usageText(model.round.tokens, model.round.cached)} for both agents${e ? ` · about ${tokenText(e.tokens)} estimated per round${e.rounds ? '' : ' (rough)'}` : ''}`));
  if (model.total !== null) box.append(el('p', 'tst-muted tst-agent-total', `${usageText(model.total.total, model.total.cached)} so far${model.queue ? ' for both agents' : ''}`));
  if (model.queue) box.append(queueEl(model.queue));
  if (model.close) box.append(closeRow(model.close, on));
  return box;
}

// Close agents, asking inline first like the Board's Close.
function closeRow(close: NonNullable<AgentsModel['close']>, on: AgentsHandlers): HTMLElement {
  const row = el('div', 'tst-close-agents');
  if (close.asking) {
    row.setAttribute('role', 'group');
    const yes = el('button', 'tst-link tst-close-yes', 'Yes');
    yes.type = 'button';
    yes.addEventListener('click', () => on.close());
    const no = el('button', 'tst-link tst-close-no', 'No');
    no.type = 'button';
    no.addEventListener('click', () => on.askClose(false));
    row.append(el('span', null, close.count === 1 ? 'Close this agent?' : 'Close both agents?'), yes, el('span', 'tst-sep', '·'), no);
    return row;
  }
  const button = el('button', 'tst-button tst-close-agents-button', close.closing ? 'Closing…' : 'Close agents');
  button.type = 'button';
  button.disabled = close.closing;
  button.title = 'Close the agents’ Claude sessions and their tabs';
  button.addEventListener('click', () => on.askClose(true));
  row.append(button);
  return row;
}

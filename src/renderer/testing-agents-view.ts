// The two agents of a task's test loop, side by side: a lane each (her name for it, what it is doing, its conversation
// and message box, its live terminal on demand, tokens so far, an action log), the last round's tokens next to the
// estimate. Their bug queue shows in the Scenarios & bugs list. testing-agents.ts owns the state and the handoffs.
import { el } from './dom';
import { statusDot } from './testing-view';
import type { QueuedBug } from '../shared/bug-queue';
import { roundSummaries, type AgentAction } from '../shared/agent-actions';
import { AGENT_NAME_MAX, type AgentRole } from '../shared/agent-names';
import { tokenText, usageText, type RoundEstimate } from '../shared/token-usage';
import { render } from './markdown';
import type { ChatTurn, LaneTerminal } from '../shared/agent-chat';
import type { AgentState, LoopEvent } from '../shared/testing';

const LOG_PAGE = 20;

export interface LaneModel {
  role: AgentRole;
  name: string;
  started: boolean; // Petal started this agent for the task
  state: AgentState | null; // main's word for it; null before it started
  status: string; // what it is doing now, in her words
  canSend: boolean; // the box is on for every started agent until it is closed
  placeholder: string;
  terminal: LaneTerminal; // where its terminal is
  termOpen: boolean; // she asked to see it in the lane
  termBox: HTMLElement | null; // the box its terminal mounts in, while open
  terminalNote: string | null; // its terminal is in another window or the tab bar
  agentNote: string | null; // main's word on why it can't be reached now
  busy: boolean;
  needsYou: boolean; // a prompt on its screen waits on her
  tokens: Spent | null; // null before it started
  actions: AgentAction[]; // oldest first
  events: LoopEvent[]; // Petal's own: handoffs, queue moves, restores, suite changes
  turns: ChatTurn[]; // the last few turns of its session, oldest first
  startedAt: number; // when the loop started; 0 before
  note: string; // why her last message didn't go, or that it did
}

export interface Spent { total: number; cached: number } // cached: the cache reads among them

export interface AgentsModel {
  lanes: LaneModel[];
  queue: QueuedBug[] | null; // null until the loop starts; listed in Scenarios & bugs
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
  toggleTerminal: (role: AgentRole) => void; // show or hide its terminal in the lane, resumed first if none runs it
  showTerminal: (role: AgentRole) => void;
  popOut: (role: AgentRole) => void; // its terminal to the tab bar
  popIn: (role: AgentRole) => void; // its popped-out terminal back to the lane
  showTab: (role: AgentRole) => void; // its popped-out tab
  toggleLog: (role: AgentRole) => void;
  showOlder: (role: AgentRole) => void;
  setView: (role: AgentRole, view: 'chat' | 'actions') => void;
  draft: (role: AgentRole, text: string) => void;
  send: (role: AgentRole, text: string) => void;
  askClose: (asking: boolean) => void; // show or cancel the confirm
  close: () => void;
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
  turns.dataset.role = lane.role;
  for (const turn of lane.turns) {
    const item = el('li', turn.working ? 'tst-agent-turn is-pending' : 'tst-agent-turn');
    item.dataset.turn = turn.id;
    if (turn.prompt) item.append(el('p', 'tst-agent-prompt', turn.prompt.length > 400 ? `${turn.prompt.slice(0, 399)}…` : turn.prompt));
    if (turn.markdown) { const reply = render(turn.markdown); reply.classList.add('tst-agent-reply'); item.append(reply); }
    if (turn.working) item.append(el('p', 'tst-muted tst-agent-working', 'Working…'));
    turns.append(item);
  }
  if (!lane.turns.length) turns.append(el('li', 'tst-muted', lane.state === 'starting' ? `${lane.name} is starting.` : 'No replies yet.'));
  const refusal = lane.actions.filter((a) => a.kind === 'refused' && a.at >= lane.startedAt).at(-1); // the newest since the loop started
  const form = el('form', 'tst-agent-send');
  const input = el('textarea', 'tst-input tst-agent-input');
  Object.assign(input, { rows: 2, value: model.drafts[lane.role] ?? '', placeholder: lane.placeholder });
  input.setAttribute('aria-label', `Message ${lane.name}`);
  input.disabled = !lane.canSend;
  input.addEventListener('input', () => on.draft(lane.role, input.value));
  input.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); } });
  const send = el('button', 'tst-button tst-agent-send-button', 'Send');
  send.type = 'submit';
  send.disabled = !lane.canSend;
  form.addEventListener('submit', (event) => { event.preventDefault(); on.send(lane.role, input.value); });
  form.append(input, send);
  box.append(turns);
  if (refusal) box.append(el('p', 'tst-agent-refusal', refusal.text.replace(/^Refused: /, `Refused: ${lane.name} `)));
  box.append(form);
  if (lane.agentNote) box.append(el('p', 'tst-muted tst-agent-reach', lane.agentNote));
  if (lane.note) box.append(el('p', 'tst-muted tst-agent-note', lane.note));
  return box;
}

// Each lane's conversation across a redraw: it follows the newest turn, unless she scrolled up to read and nothing new came.
export function keepTurnsScroll(box: HTMLElement): () => void {
  const lists = (): HTMLElement[] => [...box.querySelectorAll<HTMLElement>('.tst-agent-turns')];
  const newest = (list: HTMLElement): string => (list.lastElementChild as HTMLElement | null)?.dataset.turn ?? '';
  const before = new Map(lists().map((list) => [list.dataset.role, { top: list.scrollTop, reading: list.scrollTop + list.clientHeight < list.scrollHeight - 8, newest: newest(list) }]));
  return () => {
    for (const list of lists()) {
      const was = before.get(list.dataset.role);
      list.scrollTop = was?.reading && was.newest === newest(list) ? was.top : list.scrollHeight;
    }
  };
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

// Terminal shows or hides its live terminal in the lane; Pop out moves it to the tab bar; Back to lane returns it.
function terminalButtons(lane: LaneModel, on: AgentsHandlers): HTMLElement[] {
  const link = (cls: string, text: string, onClick: () => void): HTMLButtonElement => {
    const b = el('button', `tst-link ${cls}`, text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  };
  if (lane.terminal === 'tab-bar') return [link('tst-agent-tab', 'Show its tab', () => on.showTab(lane.role)), link('tst-agent-popin', 'Back to lane', () => on.popIn(lane.role))];
  if (lane.terminal !== 'here' && lane.terminal !== 'resume') return [];
  const toggle = link('tst-agent-terminal', lane.termOpen ? 'Hide terminal' : 'Terminal', () => on.toggleTerminal(lane.role));
  toggle.setAttribute('aria-pressed', String(lane.termOpen));
  if (lane.terminal === 'resume') toggle.title = 'Resumes its session to show its terminal';
  return lane.terminal === 'here' ? [toggle, link('tst-agent-popout', 'Pop out', () => on.popOut(lane.role))] : [toggle];
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
  const controls = terminalButtons(lane, on);
  if (controls.length) {
    const group = el('span', 'tst-agent-controls');
    group.append(...controls);
    head.append(group);
  }
  const facts = el('p', 'tst-agent-status');
  facts.append(statusDot(lane.needsYou ? 'needs-you' : lane.busy ? 'running' : 'waiting'), el('span', lane.needsYou ? 'tst-agent-needs' : null, lane.status));
  if (lane.needsYou && !lane.termOpen && lane.terminal !== 'elsewhere') { // the prompt waits in its terminal
    const show = el('button', 'tst-link tst-agent-show', 'Show terminal');
    show.type = 'button';
    show.addEventListener('click', () => (lane.terminal === 'tab-bar' ? on.showTab(lane.role) : on.showTerminal(lane.role)));
    facts.append(show);
  }
  if (lane.tokens !== null) facts.append(el('span', 'tst-agent-tokens', usageText(lane.tokens.total, lane.tokens.cached)));
  box.append(head, facts);
  if (!lane.started) return box;
  if (lane.terminalNote) box.append(el('p', 'tst-muted tst-agent-where', lane.terminalNote));
  if (lane.termBox) box.append(lane.termBox);
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

export function agentsPanel(model: AgentsModel, on: AgentsHandlers): HTMLElement {
  const box = el('div', 'tst-agents');
  const lanes = el('div', 'tst-agent-lanes');
  for (const lane of model.lanes) lanes.append(laneEl(lane, model, on));
  box.append(lanes);
  const e = model.estimate;
  if (!model.queue && e) box.append(el('p', 'tst-muted tst-agent-estimate', `About ${tokenText(e.tokens)} tokens per round for both agents. ${e.rounds ? `The average of this task’s last ${e.rounds === 1 ? 'round' : `${e.rounds} rounds`}.` : 'A rough estimate from the briefs and the last run’s output.'}`));
  if (model.round) box.append(el('p', 'tst-muted tst-agent-round', `${model.round.label}: ${usageText(model.round.tokens, model.round.cached)} for both agents${e ? ` · about ${tokenText(e.tokens)} estimated per round${e.rounds ? '' : ' (rough)'}` : ''}`));
  if (model.total !== null) box.append(el('p', 'tst-muted tst-agent-total', `${usageText(model.total.total, model.total.cached)} so far${model.queue ? ' for both agents' : ''}`));
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
  button.title = 'Close the agents’ Claude sessions and their terminals';
  button.addEventListener('click', () => on.askClose(true));
  row.append(button);
  return row;
}

// The Agents view over the reader: the shown session's subagents, then one agent's live timeline. Esc steps back.
import * as overlays from './overlays';
import * as sessionsPanel from './sessions-panel';
import { appendItems, settle } from './agents-timeline';
import { byId, el, isIpcError } from './dom';
import { agentsChipText } from '../shared/ipc';
import type { AgentSummary } from '../main/agents';
import type { TimelineItem } from '../main/agent-steps';

const view = byId('agents');
const chip = byId<HTMLButtonElement>('agents-chip');
const FOLLOW_SLACK_PX = 48; // this close to the bottom still counts as following

let sessionId: string | null = null; // null: the reader's own session
let agents: AgentSummary[] = [];
let openId: string | null = null;
let timeline: HTMLOListElement | null = null;
let finished = false;

function elapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
const statusOf = (agent: AgentSummary): string => (agent.id === openId && finished ? 'finished' : agent.status);
const metaText = (agent: AgentSummary): string =>
  `${elapsed((statusOf(agent) === 'finished' ? agent.updatedAt : Date.now()) - agent.startedAt)} · ${plural(agent.toolCalls, 'tool call')}`;

function agentRow(agent: AgentSummary): HTMLLIElement {
  const item = el('li', 'agents-item');
  const button = el('button', 'agents-row');
  button.type = 'button';
  button.dataset.agentId = agent.id;
  const head = el('span', 'agents-row-head');
  head.append(el('span', 'agents-row-task', agent.task), el('span', `agent-status ${agent.status}`, agent.status));
  button.append(head, el('span', 'agents-row-meta', metaText(agent)), el('span', 'agents-row-step', agent.step));
  button.addEventListener('click', () => openAgent(sessionId, agent.id));
  item.append(button);
  return item;
}

function renderList(): void {
  const list = el('ul', 'agents-list');
  list.append(...agents.map(agentRow));
  const parts: HTMLElement[] = [el('h2', 'agents-heading', 'Agents'), el('p', 'agents-hint', 'Running first, then finished today. Esc goes back.')];
  parts.push(agents.length ? list : el('p', 'agents-empty', 'No agents in this session today.'));
  const card = el('div', 'agents-card');
  card.append(...parts);
  view.replaceChildren(card);
}

function timelineHead(agent: AgentSummary | undefined): HTMLElement {
  const head = el('header', 'agent-head');
  const back = el('button', 'agent-back flow-button', '‹ All agents');
  back.type = 'button';
  back.addEventListener('click', () => stepBack());
  head.append(back, el('h2', 'agent-title', agent?.task ?? 'Agent'));
  if (agent) head.append(el('p', 'agent-meta', `${statusOf(agent)} · ${metaText(agent)}`));
  return head;
}

const atBottom = (): boolean => view.scrollHeight - view.scrollTop - view.clientHeight < FOLLOW_SLACK_PX;

function append(items: readonly TimelineItem[]): void {
  if (!timeline) return;
  const follow = atBottom();
  appendItems(timeline, items);
  if (finished) settle(timeline);
  if (follow) view.scrollTop = view.scrollHeight;
}

async function refreshList(): Promise<void> {
  const result = await window.pastel.agents.list(sessionId);
  if (isIpcError(result)) return;
  agents = result.agents;
  if (!overlays.isOpen('agents')) return;
  if (openId) view.querySelector('.agent-head')?.replaceWith(timelineHead(agents.find((a) => a.id === openId)));
  else renderList();
}

export async function openList(forSession: string | null = null): Promise<void> {
  sessionId = forSession;
  closeTimeline();
  overlays.show('agents');
  view.replaceChildren(el('p', 'agents-hint', 'Reading agents…'));
  view.focus();
  await refreshList();
}

export async function openAgent(forSession: string | null, agentId: string): Promise<void> {
  sessionId = forSession;
  overlays.show('agents');
  const own = forSession ?? (await window.pastel.agents.list(null).then((r) => (isIpcError(r) ? null : r.sessionId)));
  const result = own ? await window.pastel.agents.open(own, agentId) : { missing: true as const };
  openId = agentId;
  timeline = el('ol', 'agent-timeline');
  const card = el('div', 'agents-card agent-card');
  card.append(timelineHead(agents.find((a) => a.id === agentId)), timeline);
  view.replaceChildren(card);
  view.focus();
  if (isIpcError(result) || 'missing' in result) {
    timeline.append(el('li', 'agents-empty', 'This agent’s transcript isn’t there any more.'));
    return;
  }
  finished = result.finished;
  if (result.dropped) timeline.append(el('li', 'agents-hint', `${plural(result.dropped, 'earlier row')} not shown.`));
  append(result.items);
  view.scrollTop = view.scrollHeight;
  await refreshList();
}

function closeTimeline(): void {
  if (openId) void window.pastel.agents.close();
  openId = null;
  timeline = null;
  finished = false;
}

// Esc or the back button: timeline to list, then list to the reader.
function stepBack(): boolean {
  if (!openId) return false;
  closeTimeline();
  renderList();
  view.focus();
  void refreshList();
  return true;
}

window.pastel.agents.onTimeline((update) => {
  if (update.agentId !== openId) return;
  const justFinished = update.finished && !finished;
  finished = update.finished;
  append(update.items);
  if (justFinished) void refreshList(); // the header says finished now, not on the next tick
});

// The header chip and the open view ride the Sessions tick; no timer of their own.
sessionsPanel.onView(({ here }) => {
  chip.hidden = here.total === 0;
  chip.textContent = agentsChipText(here);
  chip.classList.toggle('has-running', here.running > 0);
  if (!overlays.isOpen('agents')) return;
  if (openId) void window.pastel.agents.poll();
  void refreshList();
});

overlays.onBack('agents', stepBack);
overlays.onClose('agents', closeTimeline);
chip.addEventListener('click', () => openList(null));
window.addEventListener('petal:open-agent', (event) => {
  const { sessionId: id, agentId } = (event as CustomEvent<{ sessionId: string; agentId: string }>).detail;
  void openAgent(id, agentId);
});

export const openAgentId = (): string | null => openId;

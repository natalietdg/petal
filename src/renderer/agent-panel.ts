// One agent's live timeline in the reader's right panel, the slot Notes uses. Notes' button takes the slot back.
import * as notesPanel from './notes-panel';
import * as overlays from './overlays';
import * as sessionsPanel from './sessions-panel';
import { appendItems, settle } from './agents-timeline';
import { dotStatus, duration } from './agents-menu-rows';
import { byId, el, isIpcError } from './dom';
import { setSessionName } from './session-name';
import type { AgentSummary } from '../main/agents';
import type { TimelineItem } from '../main/agent-steps';

const FOLLOW_SLACK_PX = 48; // this close to the bottom still counts as following

const aside = byId('agent-panel');
aside.classList.add('notes-panel', 'agent-panel'); // the Notes panel's frame, head and grip
aside.setAttribute('aria-label', 'Agent timeline');
const grip = el('div', 'notes-panel-grip');
grip.setAttribute('role', 'separator');
grip.setAttribute('aria-orientation', 'vertical');
const head = el('div', 'notes-panel-head agent-panel-head');
const titles = el('div', 'agent-panel-titles');
const title = el('span', 'notes-panel-title agent-panel-title');
const meta = el('span', 'agent-panel-meta');
const sessionName = el('span', 'agent-panel-session'); // which session the agent works for, by its shared name
const close = el('button', 'notes-panel-close', 'Close');
close.type = 'button';
close.addEventListener('click', () => hide());
titles.append(title, meta, sessionName);
head.append(titles, close);
const body = el('div', 'agent-panel-body');
aside.append(grip, head, body);
notesPanel.dragToResize(grip, aside);

// Same top as the Notes panel: the fixed header's, just under the dock.
const readerHead = byId('reader-head');
new ResizeObserver(() => { aside.style.top = `${readerHead.offsetTop}px`; }).observe(byId('reader'));

let sessionId: string | null = null; // null: the reader's own session
let openId: string | null = null;
let summary: AgentSummary | undefined;
let timeline: HTMLOListElement | null = null;
let finished = false;

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

function renderHead(): void {
  title.textContent = summary?.task ?? 'Agent';
  if (!summary) {
    meta.textContent = '';
    return;
  }
  const shown = finished ? { ...summary, status: 'finished' as const } : summary; // the live tail can know first
  meta.textContent = `${dotStatus(shown)} · ${duration(shown, Date.now())} · ${plural(summary.toolCalls, 'tool call')}`;
}

const atBottom = (): boolean => body.scrollHeight - body.scrollTop - body.clientHeight < FOLLOW_SLACK_PX;

function append(items: readonly TimelineItem[]): void {
  if (!timeline) return;
  const follow = atBottom();
  appendItems(timeline, items);
  if (finished) settle(timeline);
  if (follow) body.scrollTop = body.scrollHeight;
}

async function refreshHead(): Promise<void> {
  const result = await window.pastel.agents.list(sessionId);
  if (isIpcError(result) || !openId) return;
  summary = result.agents.find((a) => a.id === openId) ?? summary;
  if (result.sessionLabel) setSessionName(sessionName, result.sessionLabel);
  sessionName.hidden = !result.sessionLabel;
  renderHead();
}

export async function show(forSession: string | null, agentId: string): Promise<void> {
  const current = overlays.current();
  if (current) overlays.hide(current); // the panel sits beside the replies
  if (openId) void window.pastel.agents.close();
  sessionId = forSession;
  openId = agentId;
  summary = undefined;
  finished = false;
  timeline = el('ol', 'agent-timeline');
  body.replaceChildren(timeline);
  renderHead();
  aside.hidden = false;
  notesPanel.lendReaderSlot(hide);
  void refreshHead(); // the name shows while the transcript loads
  const own = forSession ?? (await window.pastel.agents.list(null).then((r) => (isIpcError(r) ? null : r.sessionId)));
  const result = own ? await window.pastel.agents.open(own, agentId) : { missing: true as const };
  if (openId !== agentId) return; // another agent was picked meanwhile
  if (isIpcError(result) || 'missing' in result) {
    timeline.append(el('li', 'agents-empty', 'This agent’s transcript isn’t there any more.'));
    return;
  }
  finished = result.finished;
  if (result.dropped) timeline.append(el('li', 'agents-hint', `${plural(result.dropped, 'earlier row')} not shown.`));
  append(result.items);
  body.scrollTop = body.scrollHeight;
  await refreshHead();
}

export function hide(): void {
  if (!openId) return;
  void window.pastel.agents.close();
  openId = null;
  timeline = null;
  aside.hidden = true;
  body.replaceChildren();
  notesPanel.lendReaderSlot(null);
}

window.pastel.agents.onTimeline((update) => {
  if (update.agentId !== openId) return;
  const justFinished = update.finished && !finished;
  finished = update.finished;
  append(update.items);
  if (justFinished) void refreshHead(); // the header says done now, not on the next tick
});

// The open panel rides the Sessions tick; no timer of its own.
sessionsPanel.onView(() => {
  if (!openId) return;
  void window.pastel.agents.poll();
  void refreshHead();
});

// A Sessions panel row opens that session's agent here.
window.addEventListener('petal:open-agent', (event) => {
  const { sessionId: id, agentId } = (event as CustomEvent<{ sessionId: string; agentId: string }>).detail;
  void show(id, agentId);
});

export const openAgentId = (): string | null => openId;

// Docked monitor of every live Claude session. The reader stays pinned to this pty.
// Each row can close its Claude after an inline confirm; recently closed ones can be reopened.
import * as tabs from './tabs';
import * as composer from './composer';
import * as overlays from './overlays';
import { byId, el, isIpcError } from './dom';
import type { SessionRow, SubagentRow } from '../main/sessions-monitor';
import type { ClosedSession } from '../main/closed-store';
import { agentsBadgeText, sessionsPillText, type SessionsView } from '../shared/ipc';
import { limitReached, limitText, overLimit } from '../shared/session-limit';

const OPEN_REFRESH_MS = 2000;
const COLLAPSED_REFRESH_MS = 5000;
const MINUTE_MS = 60_000;
const AGENTS_SHOWN = 4;

const pill = byId('sessions-pill');
const addButton = byId('add-session-button');
const panel = byId('sessions-panel');
export const expandedIds = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;

// Where the inline confirm is open ('row' or 'limit'), which session is closing, and per-session notes.
let confirming: { sessionId: string; where: 'row' | 'limit' } | null = null;
let closingId: string | null = null;
const notes = new Map<string, string>();
// Set when Add Session was refused at the limit, so the panel shows why.
let addBlocked = false;

export const isOpen = (): boolean => !panel.hidden;

// "updated 5m ago"; with no verb, just "5m ago".
function sinceText(ms: number | null, verb = ''): string {
  if (!ms) return '';
  const minutes = Math.round((Date.now() - ms) / MINUTE_MS);
  const hours = Math.round(minutes / 60);
  const ago = minutes < 1 ? 'just now'
    : minutes < 60 ? `${minutes}m ago`
      : hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
  return verb ? `${verb} ${ago}` : ago;
}


function renderPill(view: SessionsView): void {
  const { counts, maxOpen } = view;
  const over = overLimit(view);
  pill.classList.toggle('has-busy', counts.busy > 0);
  pill.classList.toggle('over-limit', over);
  pill.replaceChildren(el('span', 'dot'), el('span', '', sessionsPillText(counts)));
  if (over) pill.append(el('span', 'pill-limit', `your limit is ${maxOpen}`));
}

function textButton(label: string, className: string, onClick: () => unknown): HTMLButtonElement {
  const b = el('button', className, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

async function closeNow(sessionId: string): Promise<void> {
  confirming = null;
  closingId = sessionId;
  notes.delete(sessionId);
  refresh();
  const result = await window.pastel.closeSession(sessionId);
  closingId = null;
  if (isIpcError(result)) notes.set(sessionId, `Couldn’t close it: ${result.error}`);
  else if (!result.closed) notes.set(sessionId, result.note);
  refresh();
}

// "Close this Claude? Yes · No", in place of the control that asked.
function confirmLine(sessionId: string, question: string): HTMLParagraphElement {
  const line = el('p', 'session-confirm');
  line.setAttribute('role', 'group');
  line.append(
    el('span', '', question),
    textButton('Yes', 'session-link session-yes', () => closeNow(sessionId)),
    el('span', 'session-sep', '·'),
    textButton('No', 'session-link session-no', () => { confirming = null; refresh(); }),
  );
  return line;
}

function rowDetail(row: SessionRow): HTMLDivElement {
  const detail = el('div', 'session-detail');
  const lines = row.recent.length ? row.recent : ['No recent activity'];
  const recent = el('ul', 'session-recent');
  detail.append(recent);
  for (const line of lines) recent.append(el('li', '', line));
  return detail;
}

// Under every row with active agents, expanded or not: task · what it is doing now · when it last wrote.
function agentList(agents: SubagentRow[]): HTMLUListElement {
  const list = el('ul', 'session-agents');
  for (const agent of agents.slice(0, AGENTS_SHOWN)) {
    const item = el('li', 'session-agent');
    item.dataset.agentId = agent.id;
    item.append(
      el('span', 'agent-task', agent.task),
      el('span', 'agent-activity', `· ${agent.activity ?? 'Working'}`),
      el('span', 'agent-since', `· ${sinceText(agent.updatedAt)}`),
    );
    list.append(item);
  }
  const more = agents.length - AGENTS_SHOWN;
  if (more > 0) list.append(el('li', 'session-agent agent-more', `+${more} more`));
  return list;
}

function renderRow(row: SessionRow): HTMLLIElement {
  const item = el('li', `session-row${row.isOwn ? ' own' : ''}`);
  item.dataset.sessionId = row.sessionId;
  const head = el('button', 'session-head');
  head.type = 'button';
  head.setAttribute('aria-expanded', String(expandedIds.has(row.sessionId)));

  const title = el('span', 'session-title');
  title.append(el('span', 'session-name', row.name));
  if (row.isOwn) title.append(el('span', 'session-own', 'this window'));
  if (row.subagents.length) {
    const badge = el('span', 'session-agents-badge', agentsBadgeText(row.subagents.length));
    badge.title = 'Background agents active in the last 2 min';
    title.append(badge);
  }
  title.append(el('span', `session-status ${row.status}`, row.status));

  const meta = el('span', 'session-meta', [row.cwd, row.kind === 'bg' ? 'background' : '', sinceText(row.updatedAt, 'updated')].filter(Boolean).join(' · '));
  head.append(title, meta);
  if (row.activity) head.append(el('span', 'session-activity', row.activity));

  head.addEventListener('click', () => {
    if (expandedIds.has(row.sessionId)) expandedIds.delete(row.sessionId); else expandedIds.add(row.sessionId);
    refresh();
  });

  // A sibling of the head button, never inside it.
  const closing = closingId === row.sessionId;
  const close = textButton(closing ? 'Closing…' : 'Close', 'session-link session-close', () => { confirming = { sessionId: row.sessionId, where: 'row' }; refresh(); });
  close.disabled = closing;
  close.setAttribute('aria-label', `Close ${row.name}`);
  item.append(head, close);

  if (confirming?.where === 'row' && confirming.sessionId === row.sessionId) item.append(confirmLine(row.sessionId, 'Close this Claude?'));
  const note = notes.get(row.sessionId);
  if (note) item.append(el('p', 'session-note', note));
  if (row.subagents.length) item.append(agentList(row.subagents));
  if (expandedIds.has(row.sessionId)) item.append(rowDetail(row));
  return item;
}

// Shown only when more are open than her limit. Suggests, never closes on its own.
function limitBanner(view: SessionsView, rows: SessionRow[]): HTMLDivElement {
  const banner = el('div', 'sessions-limit');
  banner.setAttribute('role', 'status');
  banner.append(el('p', 'sessions-limit-text', limitText(view.counts.total, view.maxOpen)));
  if (addBlocked) banner.append(el('p', 'sessions-limit-hint sessions-add-blocked', 'Close one to add a session.'));
  const oldest = rows.find((r) => r.sessionId === view.oldestIdleId);
  if (!oldest) {
    banner.append(el('p', 'sessions-limit-hint', 'None of them are idle right now.'));
  } else if (confirming?.where === 'limit' && confirming.sessionId === oldest.sessionId) {
    banner.append(confirmLine(oldest.sessionId, `Close the oldest idle Claude, “${oldest.name}”?`));
  } else {
    banner.append(textButton('Close oldest idle', 'flow-button sessions-limit-close', () => { confirming = { sessionId: oldest.sessionId, where: 'limit' }; refresh(); }));
  }
  return banner;
}

async function reopen(entry: ClosedSession, confirmFork: boolean): Promise<void> {
  notes.set(entry.sessionId, 'Opening…');
  refresh();
  const result = await window.pastel.history.resume(entry.sessionId, confirmFork);
  if (isIpcError(result)) notes.set(entry.sessionId, `Couldn’t reopen it: ${result.error}`);
  else if ('confirm' in result) notes.set(entry.sessionId, result.confirm);
  else if ('note' in result) notes.set(entry.sessionId, result.note);
  else notes.delete(entry.sessionId);
  refresh();
}

function renderClosed(entry: ClosedSession): HTMLLIElement {
  const item = el('li', 'closed-row');
  item.dataset.sessionId = entry.sessionId;
  const text = el('div', 'closed-text');
  text.append(el('span', 'session-name', entry.title), el('span', 'session-meta', [entry.cwd, sinceText(entry.closedAt, 'closed')].filter(Boolean).join(' · ')));
  item.append(text, textButton('Reopen', 'flow-button closed-reopen', () => reopen(entry, false)));
  const note = notes.get(entry.sessionId);
  if (note) item.append(el('p', 'session-note', note));
  return item;
}

function renderPanel(view: SessionsView): void {
  const rows = view.rows ?? [];
  const list = el('ul', 'session-list');
  list.append(...rows.map(renderRow));
  const parts: HTMLElement[] = [
    textButton('Add Session', 'flow-button sessions-add', () => addSession()),
    el('p', 'sessions-heading', 'Claude sessions on this Mac'),
  ];
  if ((addBlocked && limitReached(view)) || overLimit(view)) parts.push(limitBanner(view, rows));
  parts.push(list);
  if (view.closed?.length) {
    const closed = el('ul', 'session-list closed-list');
    closed.append(...view.closed.map(renderClosed));
    parts.push(el('p', 'sessions-heading closed-heading', 'Recently closed'), closed);
  }
  const { scrollTop } = panel; // keep her place across refreshes
  panel.replaceChildren(...parts);
  panel.scrollTop = scrollTop;
}

// The panel may not grow past the reader pane, whatever the split.
const area = byId('reader-area');
new ResizeObserver(() => area.style.setProperty('--reader-area-height', `${area.clientHeight}px`)).observe(area);

// auto: a timer tick, which leaves an open confirm alone so its buttons never move under her cursor.
export async function refresh(auto = false): Promise<void> {
  const open = isOpen();
  const result = await window.pastel.getSessions({ detailed: open, expandedIds: [...expandedIds] });
  if (isIpcError(result)) {
    pill.replaceChildren(el('span', 'dot'), el('span', '', 'Sessions · unavailable'));
    if (open) panel.replaceChildren(el('p', 'sessions-heading', `Couldn’t read Claude sessions: ${result.error}`));
  } else {
    renderPill(result);
    if (open && result.rows && !(auto && confirming)) renderPanel(result);
  }
  schedule();
}

function schedule(): void {
  clearTimeout(timer);
  timer = setTimeout(() => refresh(true), isOpen() ? OPEN_REFRESH_MS : COLLAPSED_REFRESH_MS);
}

export function setOpen(open: boolean): void {
  panel.hidden = !open;
  pill.setAttribute('aria-expanded', String(open));
  if (!open) { confirming = null; addBlocked = false; }
  refresh();
}

// The one limit check for every path that starts a Claude: the limit note, or null when there's room.
export async function sessionLimitNote(): Promise<string | null> {
  return limitReached(await window.pastel.getSessions({ detailed: false, expandedIds: [] }));
}

// New-tab paths (Add Session, ⌘T, +): at her limit, open this panel with the note and report no room.
export async function roomForSession(): Promise<boolean> {
  addBlocked = (await sessionLimitNote()) !== null;
  if (addBlocked) setOpen(true);
  return !addBlocked;
}

// A new tab the ⌘T way, then the reply box, so she can type the first message. At her limit, the panel says why instead.
export async function addSession(): Promise<void> {
  if (!(await roomForSession())) return;
  const open = overlays.current();
  if (open) overlays.hide(open);
  if (isOpen()) setOpen(false);
  tabs.create();
  composer.focus();
}

// Why a session can't start from History right now, or null; the action names what she tried.
export async function limitNote(action: string): Promise<string | null> {
  const note = await sessionLimitNote();
  return note && `${note}. Close one to ${action}.`;
}

pill.addEventListener('click', () => setOpen(!isOpen()));
addButton.addEventListener('click', () => addSession());
refresh();

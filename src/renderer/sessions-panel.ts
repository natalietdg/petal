// Docked monitor of every live Claude session. The reader stays pinned to this pty.
// Each row can close its Claude after an inline confirm; recently closed ones can be reopened.
import { byId, el, isIpcError } from './dom';
import type { SessionCounts, SessionRow } from '../main/sessions-monitor';
import type { ClosedSession } from '../main/closed-store';
import type { SessionsView } from '../shared/ipc';

const OPEN_REFRESH_MS = 2000;
const COLLAPSED_REFRESH_MS = 5000;
const MINUTE_MS = 60_000;

const pill = byId('sessions-pill');
const panel = byId('sessions-panel');
export const expandedIds = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;

// Where the inline confirm is open ('row' or 'limit'), which session is closing, and per-session notes.
let confirming: { sessionId: string; where: 'row' | 'limit' } | null = null;
let closingId: string | null = null;
const notes = new Map<string, string>();

export const isOpen = (): boolean => !panel.hidden;

function sinceText(ms: number | null, verb: string): string {
  if (!ms) return '';
  const minutes = Math.round((Date.now() - ms) / MINUTE_MS);
  if (minutes < 1) return `${verb} just now`;
  if (minutes < 60) return `${verb} ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${verb} ${hours}h ago` : `${verb} ${Math.round(hours / 24)}d ago`;
}

const overLimit = ({ total }: SessionCounts, maxOpen: number): boolean => total > maxOpen;
const limitText = (total: number, maxOpen: number) => `${total} open, your limit is ${maxOpen}`;

function renderPill({ counts, maxOpen }: SessionsView): void {
  const over = overLimit(counts, maxOpen);
  pill.classList.toggle('has-busy', counts.busy > 0);
  pill.classList.toggle('over-limit', over);
  pill.replaceChildren(el('span', 'dot'), el('span', '', `Sessions · ${counts.busy} busy · ${counts.total} open`));
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
  for (const agent of row.subagents) {
    detail.append(el('p', 'session-subagent', `Subagent ${agent.id.slice(0, 6)} · ${agent.activity}`));
  }
  return detail;
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
  if (expandedIds.has(row.sessionId)) item.append(rowDetail(row));
  return item;
}

// Shown only when more are open than her limit. Suggests, never closes on its own.
function limitBanner(view: SessionsView, rows: SessionRow[]): HTMLDivElement {
  const banner = el('div', 'sessions-limit');
  banner.setAttribute('role', 'status');
  banner.append(el('p', 'sessions-limit-text', limitText(view.counts.total, view.maxOpen)));
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
  const parts: HTMLElement[] = [el('p', 'sessions-heading', 'Claude sessions on this Mac')];
  if (overLimit(view.counts, view.maxOpen)) parts.push(limitBanner(view, rows));
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
  if (!open) confirming = null;
  refresh();
}

pill.addEventListener('click', () => setOpen(!isOpen()));
refresh();

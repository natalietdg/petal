// Docked, read-only monitor of every live Claude session. The reader stays pinned to this pty.
import { byId, el, isIpcError } from './dom';
import type { SessionCounts, SessionRow } from '../main/sessions-monitor';

const OPEN_REFRESH_MS = 2000;
const COLLAPSED_REFRESH_MS = 5000;

const pill = byId('sessions-pill');
const panel = byId('sessions-panel');
export const expandedIds = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;

export const isOpen = (): boolean => !panel.hidden;

function ago(ms: number | null): string {
  if (!ms) return '';
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 1) return 'updated just now';
  if (minutes < 60) return `updated ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `updated ${hours}h ago` : `updated ${Math.round(hours / 24)}d ago`;
}

function renderPill({ busy, total }: SessionCounts): void {
  pill.classList.toggle('has-busy', busy > 0);
  pill.replaceChildren(el('span', 'dot'), el('span', '', `Sessions · ${busy} busy · ${total} open`));
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
  const head = el('button', 'session-head');
  head.type = 'button';
  head.setAttribute('aria-expanded', String(expandedIds.has(row.sessionId)));

  const title = el('span', 'session-title');
  title.append(el('span', 'session-name', row.name));
  if (row.isOwn) title.append(el('span', 'session-own', 'this window'));
  title.append(el('span', `session-status ${row.status}`, row.status));

  const meta = el('span', 'session-meta', [row.cwd, row.kind === 'bg' ? 'background' : '', ago(row.updatedAt)].filter(Boolean).join(' · '));
  head.append(title, meta);
  if (row.activity) head.append(el('span', 'session-activity', row.activity));

  head.addEventListener('click', () => {
    if (expandedIds.has(row.sessionId)) expandedIds.delete(row.sessionId); else expandedIds.add(row.sessionId);
    refresh();
  });
  item.append(head);
  if (expandedIds.has(row.sessionId)) item.append(rowDetail(row));
  return item;
}

function renderPanel(rows: SessionRow[]): void {
  const list = el('ul', 'session-list');
  list.append(...rows.map(renderRow));
  const { scrollTop } = panel; // keep her place across refreshes
  panel.replaceChildren(el('p', 'sessions-heading', 'Claude sessions on this Mac'), list);
  panel.scrollTop = scrollTop;
}

// The panel may not grow past the reader pane, whatever the split.
const area = byId('reader-area');
new ResizeObserver(() => area.style.setProperty('--reader-area-height', `${area.clientHeight}px`)).observe(area);

export async function refresh(): Promise<void> {
  const open = isOpen();
  const result = await window.pastel.getSessions({ detailed: open, expandedIds: [...expandedIds] });
  if (isIpcError(result)) {
    pill.replaceChildren(el('span', 'dot'), el('span', '', 'Sessions · unavailable'));
    if (open) panel.replaceChildren(el('p', 'sessions-heading', `Couldn’t read Claude sessions: ${result.error}`));
  } else {
    renderPill(result.counts);
    if (open && result.rows) renderPanel(result.rows);
  }
  schedule();
}

function schedule(): void {
  clearTimeout(timer);
  timer = setTimeout(refresh, isOpen() ? OPEN_REFRESH_MS : COLLAPSED_REFRESH_MS);
}

export function setOpen(open: boolean): void {
  panel.hidden = !open;
  pill.setAttribute('aria-expanded', String(open));
  refresh();
}

pill.addEventListener('click', () => setOpen(!isOpen()));
refresh();

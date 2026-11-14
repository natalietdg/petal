// The Sessions pill and the session limit. The pill opens the Board, which shows every session as a card;
// this puts the limit banner and Recently closed on the Board and runs the sessions tick others ride.
import * as overlays from './overlays';
import * as repos from './repos';
import { byId, el, isIpcError } from './dom';
import { sessionNameEl } from './session-name';
import { sessionLabelText } from '../shared/session-label';
import type { SessionRow, SubagentRow } from '../main/sessions-monitor';
import { childAgentId, type ChildRow } from '../shared/subsessions';
import type { ClosedSession } from '../main/closed-store';
import { closeNote, sessionsPillText, type SessionsView } from '../shared/ipc';
import { limitReached, limitText, overLimit } from '../shared/session-limit';

const OPEN_REFRESH_MS = 2000;
const COLLAPSED_REFRESH_MS = 5000;
const MINUTE_MS = 60_000;
const AGENTS_SHOWN = 4;

const pill = byId('sessions-pill');
const addButton = byId('add-session-button');
const board = byId('board');
// On the Board: the limit banner above the cards, Recently closed below them.
const panel = el('div', 'sessions-panel');
panel.id = 'sessions-panel';
panel.hidden = true;
const closedBox = el('div', 'board-closed');
export const limitElement = (): HTMLElement => panel;
export const closedElement = (): HTMLElement => closedBox;
export const expandedIds = new Set<string>(); // kept for callers; Board cards show each session's digest instead
let timer: ReturnType<typeof setTimeout> | undefined;

// Whether the limit banner's inline confirm is open, and per-session notes.
let confirming: { sessionId: string } | null = null;
const notes = new Map<string, string>();
// Set when Add Session was refused at the limit, so the panel shows why.
let addBlocked = false;
// Set while the Board is open: it rides this tick for detailed rows with reply digests.
let boardOpen = false;

// "Open" now means the Board is up; the pill and every setOpen go there.
export const isOpen = (): boolean => !board.hidden;

// "updated 5m ago"; with no verb, just "5m ago".
export function sinceText(ms: number | null, verb = ''): string {
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

// The one Close path, shared with the Board: main's sessions:close, answered as a note or null once closed.
export const closeSession = async (sessionId: string): Promise<string | null> => closeNote(await window.pastel.closeSession(sessionId));

async function closeNow(sessionId: string): Promise<void> {
  confirming = null;
  notes.delete(sessionId);
  refresh();
  const note = await closeSession(sessionId);
  if (note) notes.set(sessionId, note);
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

// The agent panel's own show(), registered by agent-panel.ts; it imports this file, so this one cannot import it back.
type OpenAgent = (sessionId: string, agentId: string) => void;
let openAgent: OpenAgent | null = null;
export const onOpenAgent = (open: OpenAgent): void => { openAgent = open; };

function pickAgent(sessionId: string, agentId: string): void {
  setOpen(false);
  openAgent?.(sessionId, agentId);
}

// Waiting's click on a stuck child: the agent panel on that child.
export const openAgentFor = (sessionId: string, agentId: string): void => pickAgent(sessionId, agentId);

function agentItem(sessionId: string, agentId: string): HTMLLIElement {
  const item = el('li', 'session-agent opens-agent');
  item.dataset.agentId = agentId;
  item.title = 'Open what this agent is doing';
  item.tabIndex = 0;
  item.setAttribute('role', 'button');
  item.addEventListener('click', (event) => { if (!(event.target as Element).closest('.agent-open-session')) pickAgent(sessionId, agentId); });
  item.addEventListener('keydown', (event) => {
    if (event.target !== item || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    pickAgent(sessionId, agentId);
  });
  return item;
}

// What a child row says after its name: what stopped it, or its latest step.
export const childActivity = (child: ChildRow): string =>
  child.ask ? 'Needs you' : child.status === 'stalled' ? 'Stalled' : child.status === 'finished' ? 'Finished' : child.step;

// A headless child: name · headless · what it is doing · when, and "Open as session" to resume it into a tab on purpose.
function childItem(sessionId: string, child: ChildRow, openAsSession: ((childId: string) => void) | null): HTMLLIElement {
  const item = agentItem(sessionId, childAgentId(child.sessionId));
  item.classList.add('agent-child', `agent-child-${child.ask ? 'waiting' : child.status}`);
  item.append(
    el('span', 'agent-task', child.name),
    el('span', 'agent-headless', 'headless'),
    el('span', 'agent-activity', `· ${childActivity(child)}`),
    el('span', 'agent-since', `· ${sinceText(child.updatedAt)}`),
  );
  if (openAsSession) {
    const open = el('button', 'session-link agent-open-session', 'Open as session');
    open.type = 'button';
    open.setAttribute('aria-label', `Open ${child.name} as a session`);
    open.addEventListener('click', () => openAsSession(child.sessionId));
    item.append(open);
  }
  return item;
}

// Under a Board card with active agents: task · what it is doing now · when it last wrote. Children waiting on her lead.
export function agentList(sessionId: string, agents: SubagentRow[], children: readonly ChildRow[] = [], openAsSession: ((childId: string) => void) | null = null): HTMLUListElement {
  const list = el('ul', 'session-agents');
  const ordered = [...children].sort((a, b) => Number(Boolean(b.ask)) - Number(Boolean(a.ask)));
  for (const child of ordered) list.append(childItem(sessionId, child, openAsSession));
  for (const agent of agents.slice(0, Math.max(0, AGENTS_SHOWN - ordered.length))) {
    const item = agentItem(sessionId, agent.id);
    item.append(
      el('span', 'agent-task', agent.task),
      el('span', 'agent-activity', `· ${agent.activity ?? 'Working'}`),
      el('span', 'agent-since', `· ${sinceText(agent.updatedAt)}`),
    );
    list.append(item);
  }
  const more = agents.length - Math.max(0, AGENTS_SHOWN - ordered.length);
  if (more > 0) list.append(el('li', 'session-agent agent-more', `+${more} more`));
  return list;
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
  } else if (confirming?.sessionId === oldest.sessionId) {
    banner.append(confirmLine(oldest.sessionId, `Close the oldest idle Claude, “${sessionLabelText(oldest.name)}”?`));
  } else {
    banner.append(textButton('Close oldest idle', 'flow-button sessions-limit-close', () => { confirming = { sessionId: oldest.sessionId }; refresh(); }));
  }
  return banner;
}

async function reopen(entry: ClosedSession, confirmFork: boolean): Promise<void> {
  const limited = await limitNote('reopen one');
  if (limited) {
    notes.set(entry.sessionId, limited);
    refresh();
    return;
  }
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
  text.append(sessionNameEl('span', 'session-name', entry.title), el('span', 'session-meta', [entry.cwd, sinceText(entry.closedAt, 'closed')].filter(Boolean).join(' · ')));
  item.append(text, textButton('Reopen', 'flow-button closed-reopen', () => reopen(entry, false)));
  const note = notes.get(entry.sessionId);
  if (note) item.append(el('p', 'session-note', note));
  return item;
}

function renderPanel(view: SessionsView): void {
  const rows = view.rows ?? [];
  const showLimit = (addBlocked && limitReached(view)) || overLimit(view);
  panel.replaceChildren(...(showLimit ? [limitBanner(view, rows)] : []));
  const closed = el('ul', 'session-list closed-list');
  closed.append(...(view.closed ?? []).map(renderClosed));
  closedBox.replaceChildren(...(view.closed?.length ? [el('h3', 'board-lane-title', 'Recently closed'), closed] : []));
}

// auto: a timer tick, which leaves an open confirm alone so its buttons never move under her cursor.
export async function refresh(auto = false): Promise<void> {
  const result = await window.pastel.getSessions({ detailed: boardOpen, expandedIds: [...expandedIds], board: boardOpen });
  if (isIpcError(result)) {
    pill.replaceChildren(el('span', 'dot'), el('span', '', 'Sessions · unavailable'));
    if (boardOpen) panel.replaceChildren(el('p', 'sessions-heading', `Couldn’t read Claude sessions: ${result.error}`));
  } else {
    renderPill(result);
    if (boardOpen && result.rows && !(auto && confirming)) renderPanel(result);
    for (const listener of viewListeners) listener(result);
  }
  schedule();
}

// Others ride this tick instead of running their own timer (the Agents chip and view).
const viewListeners: ((view: SessionsView) => void)[] = [];
export const onView = (listener: (view: SessionsView) => void): void => { viewListeners.push(listener); };

function schedule(): void {
  clearTimeout(timer);
  timer = setTimeout(() => refresh(true), boardOpen ? OPEN_REFRESH_MS : COLLAPSED_REFRESH_MS);
}

// The Board calls this as it opens and closes; the pill and the limit banner follow it.
export function setBoardOpen(open: boolean): void {
  boardOpen = open;
  panel.hidden = !open;
  pill.setAttribute('aria-expanded', String(open));
  if (!open) { confirming = null; addBlocked = false; }
  refresh();
}

// Opens or closes the Board; kept so every old "open the Sessions panel" path still works.
export function setOpen(open: boolean): void {
  if (open && !isOpen()) window.dispatchEvent(new Event('petal:open-board'));
  else if (open) void refresh(); // already up: show the limit note now
  else overlays.hide('board');
}

// The one limit check for every path that starts a Claude: the limit note, or null when there's room.
export async function sessionLimitNote(): Promise<string | null> {
  return limitReached(await window.pastel.getSessions({ detailed: false, expandedIds: [] }));
}

// New-tab paths (Add Session, ⌘T, +): at her limit, open the Board with the note and report no room.
export async function roomForSession(): Promise<boolean> {
  addBlocked = (await sessionLimitNote()) !== null;
  if (addBlocked) setOpen(true);
  return !addBlocked;
}

// Add Session asks where the new Claude should work, then opens its tab. At her limit, the Board says why instead.
export async function addSession(): Promise<void> {
  if (!(await roomForSession())) return;
  const open = overlays.current();
  if (open) overlays.hide(open);
  repos.openForNewSession();
}

// Why a session can't start from History right now, or null; the action names what she tried.
export async function limitNote(action: string): Promise<string | null> {
  const note = await sessionLimitNote();
  return note && `${note}. Close one to ${action}.`;
}

pill.addEventListener('click', () => setOpen(!isOpen()));
addButton.addEventListener('click', () => addSession());
refresh();

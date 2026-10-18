// Sessions board (⌘⇧O, or Board in the Sessions panel): every open Claude session as a card, at a glance.
// It rides the Sessions panel's 2s tick; the card model lives in shared/sessions-board.ts.
import * as overlays from './overlays';
import * as tabs from './tabs';
import * as sessionsPanel from './sessions-panel';
import * as favorites from './favorites';
import * as stopClaude from './stop-claude';
import * as boardMessage from './board-message';
import * as coord from './coord';
import * as boardTasks from './board-tasks';
import * as boardActivity from './board-activity';
import * as reader from './reader';
import * as distillCard from './distill-card';
import * as testing from './testing';
import { byId, el, isIpcError } from './dom';
import { sessionNameEl } from './session-name';
import { folderName } from '../shared/session-label';
import { screenIsAsking } from '../shared/prompt-answer';
import { STATUS_KEYS, STATUS_TITLES } from '../shared/status-lines';
import { agentsBadgeText, type SessionsView } from '../shared/ipc';
import { TASK_STATUS_WORDS } from '../shared/tasks';
import type { ActivityEvent } from '../shared/activity';
import {
  BOARD_FILTERS, EMPTY_DIGEST, FILTER_WORDS, STATUS_WORDS, digestReplies, filterCards, lastUpdate, matchesFilter, sortCards, toCard,
  type BoardCard, type BoardFilter, type BoardSource,
} from '../shared/sessions-board';

const view = byId('board');
const head = el('header', 'board-head');
const title = el('h2', 'board-title', 'Board'); // matches the header button; "Sessions" is the pill beside it
const summary = el('p', 'board-summary');
const filterRow = el('div', 'board-filters');
filterRow.setAttribute('role', 'group');
filterRow.setAttribute('aria-label', 'Show');
view.tabIndex = -1; // focusable, so Esc reaches the overlay with no card to focus
const grid = el('ul', 'board-grid');
grid.setAttribute('aria-label', 'Open Claude sessions');
// Sessions (cards and the project's tasks) or Activity (the shared feed); one branch filter for both.
type BoardView = 'sessions' | 'activity';
const viewTabs = el('div', 'board-views');
viewTabs.setAttribute('role', 'tablist');
viewTabs.setAttribute('aria-label', 'Board view');
const viewButtons = (['sessions', 'activity'] as const).map((id) => {
  const b = el('button', 'board-view', id === 'sessions' ? 'Sessions' : 'Activity');
  b.type = 'button';
  b.dataset.view = id;
  b.setAttribute('role', 'tab');
  b.addEventListener('click', () => setView(id));
  return b;
});
viewTabs.append(...viewButtons);
const branchSelect = el('select', 'board-branch');
branchSelect.setAttribute('aria-label', 'Branch');
branchSelect.addEventListener('change', () => { branchFilter = branchSelect.value || null; boardActivity.setBranch(branchFilter); render(true); });
head.append(title, viewTabs, summary, branchSelect, filterRow);
view.append(head, boardTasks.element(), grid, boardActivity.element());

let filter: BoardFilter = 'all';
let boardView: BoardView = 'sessions';
let branchFilter: string | null = null;
let givingFor: string | null = null; // the card whose Give task list is open
let lastView: SessionsView | null = null;
let folderAllowed = true;
let shownKey = '';
let following = false; // asking the sessions tick for digests
const notes = new Map<string, string>(); // per session: why it couldn't open
const confirms = new Map<string, string>(); // per session: "still running elsewhere, open here as well?"

export const isOpen = (): boolean => overlays.isOpen('board');

// A question, permission prompt or Claude Code menu on the tab's screen, read the same way the prompt dock reads it.
const isAsking = (tab: tabs.Tab): boolean => screenIsAsking(tabs.screenLines(tab));

// This window's tabs with a live Claude first, then every other live session the panel lists.
export function sources(rows: SessionsView['rows'] = []): BoardSource[] {
  const rowOf = new Map(rows.map((row) => [row.sessionId, row]));
  const seen = new Set<string>();
  const out: BoardSource[] = [];
  for (const tabId of tabs.ids()) {
    const tab = tabs.get(tabId);
    const update = tab?.update;
    if (!tab || !update?.sessionId || update.state !== 'live' || seen.has(update.sessionId)) continue;
    seen.add(update.sessionId);
    const row = rowOf.get(update.sessionId);
    const digest = digestReplies(update.replies);
    out.push({
      sessionId: update.sessionId,
      tabId,
      name: update.label,
      place: update.repo ?? row?.board?.place ?? folderName(update.cwd),
      busy: update.busy,
      asking: isAsking(tab),
      updatedAt: lastUpdate(row?.updatedAt, digest.at),
      digest,
      conclusion: update.conclusion,
      agents: row?.subagents.length ?? 0,
      starred: favorites.isFavorite(update.sessionId),
    });
  }
  for (const row of rows) {
    if (seen.has(row.sessionId)) continue;
    seen.add(row.sessionId); // one card per session, even when two processes resumed it
    const digest = row.board?.digest ?? EMPTY_DIGEST;
    out.push({
      sessionId: row.sessionId,
      tabId: null,
      name: row.name,
      place: row.board?.place ?? row.cwd,
      busy: row.status === 'busy',
      asking: false, // only this window's screens can be read
      updatedAt: lastUpdate(row.updatedAt, digest.at),
      digest,
      conclusion: row.board?.conclusion ?? null,
      agents: row.subagents.length,
      starred: favorites.isFavorite(row.sessionId),
    });
  }
  return out;
}

function statusLine(card: BoardCard): HTMLSpanElement {
  const top = el('span', 'board-card-top');
  const status = el('span', `board-status ${card.status}`);
  status.append(el('span', 'board-dot'), el('span', 'board-status-word', STATUS_WORDS[card.status]));
  top.append(status);
  if ((card.status === 'idle' || card.status === 'concluded') && card.updatedAt) top.append(el('span', 'board-since', `· ${sessionsPanel.sinceText(card.updatedAt)}`));
  if (card.agents) top.append(el('span', 'board-agents', agentsBadgeText(card.agents)));
  if (card.starred) {
    const star = el('span', 'board-star');
    star.innerHTML = favorites.STAR_SVG;
    star.title = 'In Favorites';
    star.setAttribute('role', 'img');
    star.setAttribute('aria-label', 'Favorite');
    top.append(star);
  }
  return top;
}

function labelled(className: string, label: string, text: string): HTMLSpanElement {
  const line = el('span', className);
  line.append(el('span', 'board-label', label), el('span', 'board-text', text));
  line.title = `${label}: ${text}`;
  return line;
}

function cardElement(card: BoardCard): HTMLLIElement {
  const item = el('li', 'board-item');
  const button = el('button', `board-card ${card.status}`);
  button.type = 'button';
  button.dataset.sessionId = card.sessionId;
  if (card.tabId) button.dataset.tabId = card.tabId;
  const name = sessionNameEl('span', 'board-name', card.name);
  button.append(statusLine(card), name, el('span', 'board-place', card.tabId ? `${card.place} · this window` : card.place));
  if (card.digest.headline) button.append(el('span', 'board-headline', card.digest.headline));
  const lines = STATUS_KEYS.flatMap((key) => (card.digest.lines[key] ? [labelled(`board-line board-${key}`, STATUS_TITLES[key], card.digest.lines[key] ?? '')] : []));
  if (lines.length) {
    const block = el('span', 'board-lines');
    block.append(...lines);
    button.append(block);
  }
  if (card.conclusion) button.append(labelled('board-conclusion', 'Conclusion', card.conclusion));
  const info = coord.session(card.sessionId);
  if (info?.task) button.append(labelled(`board-task ${info.task.status}`, 'Task', `${info.task.title} · ${TASK_STATUS_WORDS[info.task.status]}`));
  const clash = info?.clashes[0];
  if (clash) {
    const chip = el('span', 'board-clash', `Clash · ${clash.file}`);
    chip.title = info.clashes.map((c) => `Also being edited in ${c.otherName}: ${c.file}`).join('\n');
    button.append(chip);
  }
  button.addEventListener('click', () => void choose(card, false));
  item.append(button);
  const needsYou = card.tabId && card.status !== 'working' ? distillCard.card(card.tabId, 'board') : null;
  if (needsYou) { button.classList.add('needs-you'); item.append(needsYou); }
  const tasks = card.tabId ? boardTasks.giveable(info?.root ?? null) : [];
  if (card.tabId && tasks.length) acceptTaskDrops(button, card.tabId);
  if (card.tabId && tasks.length) item.append(giveControls(card.sessionId, card.tabId, tasks));
  // A working session in this window: Stop sits on the card's corner, outside the card's own button.
  const stop = card.tabId ? stopClaude.control(card.tabId, 'board') : null;
  if (stop) { item.classList.add('has-stop'); item.append(stop); }
  const message = boardMessage.control(card);
  if (message) item.append(message);

  const confirm = confirms.get(card.sessionId);
  if (confirm) {
    const line = el('p', 'board-confirm');
    const yes = el('button', 'session-link', 'Open here');
    yes.type = 'button';
    yes.addEventListener('click', () => void choose(card, true));
    const no = el('button', 'session-link', 'Cancel');
    no.type = 'button';
    no.addEventListener('click', () => { confirms.delete(card.sessionId); render(true); });
    line.append(el('span', '', confirm), yes, el('span', 'session-sep', '·'), no);
    item.append(line);
  }
  const note = notes.get(card.sessionId);
  if (note) item.append(el('p', 'board-note', note));
  return item;
}

// A tab here: switch to it. Elsewhere: History's resume, which focuses its Petal window or asks before forking it.
async function choose(card: BoardCard, confirmFork: boolean): Promise<void> {
  if (card.tabId && tabs.get(card.tabId)) {
    close();
    tabs.activate(card.tabId);
    return;
  }
  confirms.delete(card.sessionId);
  const limited = confirmFork ? await sessionsPanel.limitNote('open one here') : null;
  if (limited) {
    notes.set(card.sessionId, limited);
    render(true);
    return;
  }
  notes.set(card.sessionId, 'Opening…');
  render(true);
  const result = await window.pastel.history.resume(card.sessionId, confirmFork);
  notes.delete(card.sessionId);
  if (isIpcError(result)) notes.set(card.sessionId, `Couldn’t open it: ${result.error}`);
  else if ('confirm' in result) confirms.set(card.sessionId, result.confirm);
  else if ('note' in result) notes.set(card.sessionId, result.note);
  else return close();
  render(true);
}

// A task dragged from the Tasks list onto a card gives it to that session.
function acceptTaskDrops(button: HTMLElement, tabId: string): void {
  const carriesTask = (event: DragEvent) => event.dataTransfer?.types.includes(boardTasks.TASK_DRAG_TYPE) ?? false;
  button.addEventListener('dragover', (event) => {
    if (!carriesTask(event)) return;
    event.preventDefault();
    button.classList.add('drop-target');
  });
  button.addEventListener('dragleave', () => button.classList.remove('drop-target'));
  button.addEventListener('drop', (event) => {
    button.classList.remove('drop-target');
    const taskId = event.dataTransfer?.getData(boardTasks.TASK_DRAG_TYPE);
    if (!taskId) return;
    event.preventDefault();
    void boardTasks.give(taskId, tabId);
  });
}

// Give task: the project's unfinished tasks, one click each; a task someone else holds says who.
function giveControls(sessionId: string, tabId: string, tasks: ReturnType<typeof boardTasks.giveable>): HTMLElement {
  const box = el('div', 'board-give');
  const toggle = el('button', 'session-link board-give-toggle', givingFor === sessionId ? 'Close' : 'Give task');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', String(givingFor === sessionId));
  toggle.addEventListener('click', () => { givingFor = givingFor === sessionId ? null : sessionId; render(true); });
  box.append(toggle);
  if (givingFor === sessionId) {
    const list = el('ul', 'board-give-list');
    for (const task of tasks) {
      const li = el('li');
      const pick = el('button', 'board-give-task', task.title);
      pick.type = 'button';
      pick.dataset.taskId = task.id;
      const held = task.owner && task.owner.sessionId !== sessionId ? task.owner.name : task.owner ? 'already this session’s' : null;
      if (held) pick.append(el('span', 'board-give-owner', held.startsWith('already') ? ` · ${held}` : ` · with ${held}`));
      pick.addEventListener('click', () => { givingFor = null; void boardTasks.give(task.id, tabId); });
      li.append(pick);
      list.append(li);
    }
    box.append(list);
  }
  return box;
}

// An Activity item: its tab here (and reply), Testing for a run, else the session as a card click opens it.
function jump(event: ActivityEvent): void {
  if (event.target?.runId) {
    close();
    void testing.open();
    return;
  }
  const source = event.sessionId ? sources(lastView?.rows).find((s) => s.sessionId === event.sessionId) : null;
  if (!source) return;
  if (source.tabId && tabs.get(source.tabId)) {
    close();
    tabs.activate(source.tabId);
    const replyId = event.target?.replyId;
    if (replyId) setTimeout(() => reader.showReply([replyId]), 0);
    return;
  }
  setView('sessions');
  void choose(toCard(source), false);
}

function setView(next: BoardView): void {
  boardView = next;
  givingFor = null;
  boardActivity.show(next === 'activity');
  render(true);
}

function branchOptions(cards: readonly BoardCard[]): void {
  const branches = new Set<string>();
  for (const card of cards) { const b = coord.session(card.sessionId)?.branch; if (b) branches.add(b); }
  for (const e of boardActivity.all()) if (e.branch) branches.add(e.branch);
  if (branchFilter) branches.add(branchFilter);
  const options = [['', 'All branches'], ...[...branches].sort().map((b) => [b, b])];
  const key = JSON.stringify(options);
  if (branchSelect.dataset.key !== key) {
    branchSelect.replaceChildren(...options.map(([value, label]) => Object.assign(el('option', null, label), { value })));
    branchSelect.dataset.key = key;
  }
  branchSelect.value = branchFilter ?? '';
  branchSelect.hidden = branches.size === 0;
}

const onBranch = (card: BoardCard): boolean => !branchFilter || coord.session(card.sessionId)?.branch === branchFilter;

function filterButtons(cards: readonly BoardCard[]): HTMLButtonElement[] {
  return BOARD_FILTERS.map((id) => {
    const count = cards.filter((c) => matchesFilter(c, id)).length;
    const button = el('button', 'board-filter', `${FILTER_WORDS[id]} ${count}`);
    button.type = 'button';
    button.dataset.filter = id;
    button.setAttribute('aria-pressed', String(id === filter));
    button.addEventListener('click', () => { filter = id; render(true); });
    return button;
  });
}

function folderOffNote(): HTMLElement {
  const note = el('div', 'board-empty board-folder-off');
  const allow = el('button', 'flow-button board-allow', 'Allow');
  allow.type = 'button';
  allow.addEventListener('click', () => window.dispatchEvent(new Event('petal:allow-folder')));
  note.append(el('p', null, 'Petal isn’t reading your Claude folder, so the board can’t see your sessions.'), allow);
  return note;
}

const summaryText = (cards: readonly BoardCard[]): string => {
  const waiting = cards.filter((c) => c.status === 'waiting').length;
  const open = `${cards.length} open`;
  return waiting ? `${open} · ${waiting} waiting on you` : open;
};

// Keeps the focused card focused across a re-render, so a 2s tick never drops her place.
function render(force = false): void {
  if (!isOpen()) return;
  if (!folderAllowed) {
    summary.textContent = '';
    filterRow.replaceChildren();
    grid.replaceChildren(folderOffNote());
    shownKey = 'folder-off';
    return;
  }
  const all = sortCards(sources(lastView?.rows).map(toCard));
  branchOptions(all);
  const cards = all.filter(onBranch);
  const shown = filterCards(cards, filter);
  const stops = cards.map((c) => (c.tabId ? stopClaude.phaseOf(c.tabId) : 'hidden'));
  for (const b of viewButtons) b.setAttribute('aria-selected', String(b.dataset.view === boardView));
  const sessionsView = boardView === 'sessions';
  filterRow.hidden = !sessionsView;
  grid.hidden = !sessionsView;
  boardTasks.element().hidden = !sessionsView;
  title.textContent = sessionsView ? 'Sessions' : 'Activity';
  const key = JSON.stringify([filter, boardView, branchFilter, givingFor, cards, cards.map((c) => sessionsPanel.sinceText(c.updatedAt)), [...notes], [...confirms], stops, coord.current(), boardTasks.current(), distillCard.stateKey(cards.map((c) => c.tabId))]);
  if (!force && key === shownKey) return;
  shownKey = key;
  const focusedId = (document.activeElement as HTMLElement | null)?.closest('.board-card')?.getAttribute('data-session-id');
  const focusedFilter = (document.activeElement as HTMLElement | null)?.closest('.board-filter')?.getAttribute('data-filter');
  summary.textContent = summaryText(cards);
  filterRow.replaceChildren(...filterButtons(cards));
  const empty = cards.length ? `Nothing ${FILTER_WORDS[filter].toLowerCase()} right now.` : lastView ? 'No Claude sessions are open.' : 'Looking for sessions…';
  grid.replaceChildren(...(shown.length ? shown.map(cardElement) : [el('li', 'board-empty', empty)]));
  if (focusedId) grid.querySelector<HTMLElement>(`.board-card[data-session-id="${CSS.escape(focusedId)}"]`)?.focus();
  else if (focusedFilter) filterRow.querySelector<HTMLElement>(`[data-filter="${focusedFilter}"]`)?.focus();
}

// Arrow keys move between cards by the grid's own columns; Enter opens (it is a button).
grid.addEventListener('keydown', (event) => {
  const cards = [...grid.querySelectorAll<HTMLElement>('.board-card')];
  const at = cards.indexOf(event.target as HTMLElement);
  if (at === -1) return;
  const top = cards[0]?.offsetTop;
  const columns = Math.max(1, cards.filter((c) => c.offsetTop === top).length);
  const moves: Record<string, number> = { ArrowRight: at + 1, ArrowLeft: at - 1, ArrowDown: at + columns, ArrowUp: at - columns, Home: 0, End: cards.length - 1 };
  const next = moves[event.key];
  if (next === undefined) return;
  event.preventDefault();
  cards[Math.min(Math.max(next, 0), cards.length - 1)]?.focus();
});

export function open(): void {
  if (!overlays.show('board')) return;
  shownKey = '';
  void boardTasks.load();
  boardActivity.show(boardView === 'activity');
  render(true);
  following = true;
  sessionsPanel.setBoardOpen(true); // fresh rows now, then every 2s while open
  (grid.querySelector<HTMLElement>('.board-card') ?? filterRow.querySelector<HTMLElement>('.board-filter') ?? view).focus();
}

export function close(): void {
  overlays.hide('board');
}

export const toggle = (): void => (isOpen() ? close() : open());

// Snapshot harness: what the Board shows, and back to its defaults between steps.
export const filters = () => ({ filter, boardView, branchFilter, givingFor, activity: boardActivity.filterState() });
export function resetFilters(): void {
  filter = 'all';
  boardView = 'sessions';
  branchFilter = null;
  givingFor = null;
  shownKey = '';
  boardActivity.resetFilters();
}

// Follows her folder choice; Allow fills an open board on the next tick.
export function setFolderAllowed(allowed: boolean): void {
  folderAllowed = allowed;
  render(true);
}

sessionsPanel.onView((next) => {
  lastView = next;
  render();
});
favorites.onChange(() => render());
coord.onChange(() => render());
boardTasks.init(() => render(true));
boardActivity.init(jump);
// The overlay can close by Esc or by another view opening: stop asking for digests then.
new MutationObserver(() => {
  if (!view.hidden || !following) return;
  following = false;
  sessionsPanel.setBoardOpen(false);
  notes.clear();
  confirms.clear();
  givingFor = null;
})
  .observe(view, { attributes: true, attributeFilter: ['hidden'] });
window.addEventListener('petal:open-board', open);
window.addEventListener(stopClaude.CHANGED_EVENT, () => render(true));
window.addEventListener(distillCard.CHANGED_EVENT, () => render(true));
window.pastel.onToggleBoard(toggle);
byId('board-button').addEventListener('click', toggle);

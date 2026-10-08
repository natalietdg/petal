import * as markdown from './markdown';
import * as diagrams from './diagrams';
import * as flow from './flow';
import { byId, query } from './dom';
import * as notesPanel from './notes-panel';
import { timeOf } from './format';
import { promptBubble } from './prompt-bubble';
import type { PendingEcho } from './pending-echo';
import type { ReaderState, Reply, WaitingPrompt } from '../shared/types';

export type ReaderView = 'replies' | 'flow' | 'decisions';
type ShownUpdate = { state: ReaderState; replies: Reply[]; waiting?: WaitingPrompt[]; pending?: PendingEcho[]; busy?: boolean; repo?: string | null; sessionId?: string | null; tabId?: string };

const latest = byId('latest');
const older = byId('older');
const status = byId('reader-status');
const repoLine = byId('reader-repo');
const scroller = byId('reader');
let latestId: string | null | undefined = null;
const FLOW_REFRESH_DELAY_MS = 1500; // let a burst of reply updates settle before redrawing the flow
const FLASH_MS = 1600;
// The conversation reads top to bottom: earlier turns first, the newest reply last.
status.before(older);

const timeOfReply = (iso: string | undefined): string => (iso ? timeOf(iso) : '');

const youBubble = (prompt: string): HTMLDivElement => promptBubble('reader-you', prompt);

// Sent from the reply box, not yet in Claude's log.
function pendingBubble(echo: PendingEcho): HTMLDivElement {
  const bubble = youBubble(echo.text);
  bubble.classList.add('pending');
  bubble.dataset.pendingKey = String(echo.key);
  return bubble;
}

const writingLine = (): HTMLParagraphElement => Object.assign(document.createElement('p'), { className: 'reader-writing', textContent: 'Claude is writing…' });

// Her messages after Claude's newest reply: from the log first, then reply-box sends still on their way.
interface OpenTurn {
  id: string;
  time: string;
  bubbles: HTMLElement[];
}

function openTurn(waiting: WaitingPrompt[], pending: PendingEcho[]): OpenTurn | null {
  const first = waiting[0];
  const firstEcho = pending[0];
  if (!first && !firstEcho) return null;
  return {
    id: first ? `prompt:${first.id}` : `echo:${firstEcho?.key}`,
    time: first?.timestamp ?? new Date(firstEcho?.sentAt ?? Date.now()).toISOString(),
    bubbles: [...waiting.map((w) => youBubble(w.prompt)), ...pending.map(pendingBubble)],
  };
}

// An earlier turn in full: her message, then Claude's whole reply.
function olderTurn(reply: Reply): HTMLElement {
  const turn = document.createElement('article');
  turn.className = 'reply older-turn';
  turn.dataset.replyId = reply.id;
  const time = Object.assign(document.createElement('p'), { className: 'older-time', textContent: timeOfReply(reply.timestamp) });
  const body = markdown.render(reply.markdown);
  turn.append(time, ...(reply.prompt ? [youBubble(reply.prompt)] : []), body);
  diagrams.render(body);
  return turn;
}

const column = query(byId('reader'), '.reader-column');

function showMessage(html: string): void {
  status.classList.add('empty');
  status.innerHTML = html;
  latest.replaceChildren();
  older.replaceChildren();
  latestId = null;
}

// state: 'none' (no claude in the pty), 'live', or 'ended' (claude exited, replies kept).
let lastUpdate: ShownUpdate | null = null;
let claudeMissing = false;

// Theme switch: rebuild so diagrams pick up the new colours.
export function rerender(): void {
  if (lastUpdate) update(lastUpdate);
}

export function update(shown: ShownUpdate): void {
  lastUpdate = shown;
  followNotesSession(shown);
  const { state, replies, waiting = [], pending = [], busy = false, repo = null } = shown;
  repoLine.textContent = repo ?? '';
  repoLine.hidden = !repo;
  column.classList.toggle('ended', state === 'ended');
  const live = state === 'live';
  const open = live ? openTurn(waiting, pending) : null;
  const writing = live && (busy || pending.length > 0) ? [writingLine()] : [];
  if (open) {
    showOpenTurn(open, replies, writing);
    return;
  }
  const [newest, ...rest] = replies;
  if (!newest) {
    showMessage(state === 'live'
      ? 'Claude is running. Its replies will appear here.'
      : claudeMissing
        ? 'Claude Code isn’t installed yet. Install it, then run <code>claude</code> below.'
        : 'No conversation yet.');
    return;
  }
  status.classList.remove('empty');
  status.textContent = state === 'ended'
    ? `Session ended · last reply ${timeOfReply(newest.timestamp)}`
    : `Latest reply · ${timeOfReply(newest.timestamp)}`;
  // Chat-style: what she asked sits in a quiet bubble above Claude's reply.
  latest.replaceChildren(...(newest.prompt ? [youBubble(newest.prompt)] : []), markdown.render(newest.markdown), ...writing);
  latest.dataset.replyId = newest.id;
  older.replaceChildren(...[...rest].reverse().map(olderTurn)); // oldest first
  diagrams.render(latest);
  bringIntoView(newest.id);
  if (view === 'flow') scheduleFlowRefresh();
}

// She has spoken since Claude's newest reply: every reply moves up, and her message leads the page.
function showOpenTurn(open: OpenTurn, replies: Reply[], writing: HTMLElement[]): void {
  status.classList.remove('empty');
  status.textContent = `You · ${timeOfReply(open.time)}`;
  latest.replaceChildren(...open.bubbles, ...writing);
  delete latest.dataset.replyId;
  older.replaceChildren(...[...replies].reverse().map(olderTurn)); // oldest first
  bringIntoView(open.id);
  if (view === 'flow') scheduleFlowRefresh();
}

// A new turn or reply: bring it into view once; the same one updating keeps her place.
function bringIntoView(id: string | undefined): void {
  if (id !== latestId) status.scrollIntoView({ block: 'start' });
  latestId = id;
}

let flowTimer: ReturnType<typeof setTimeout> | undefined;
const scheduleFlowRefresh = (): void => {
  clearTimeout(flowTimer);
  flowTimer = setTimeout(refreshFlow, FLOW_REFRESH_DELAY_MS);
};

// Links open in the default browser, never inside the app.
scroller.addEventListener('click', (event) => {
  const link = (event.target as Element).closest<HTMLAnchorElement>('a[href]');
  if (!link) return;
  event.preventDefault();
  window.pastel.openLink(link.href);
});

// Replies | Flow | Decisions toggle for this window's session.
const repliesView = byId('replies-view');
const flowView = byId('flow-view');
const decisionsView = byId('decisions-view');
const toggles = [...document.querySelectorAll<HTMLButtonElement>('#reader-head .view-toggle button')];
let view: ReaderView = 'replies';

export async function refreshFlow(): Promise<void> {
  const result = await window.pastel.flow.get({ kind: 'current' });
  const container = view === 'decisions' ? decisionsView : flowView;
  const draw = view === 'decisions' ? flow.renderDecisions : flow.render;
  draw(container, result, { target: { kind: 'current' }, onJump: (step) => showReply(step.replyIds) });
}

const isView = (value: string | undefined): value is ReaderView => value === 'replies' || value === 'flow' || value === 'decisions';

export function setView(next: ReaderView): void {
  view = next;
  repliesView.hidden = view !== 'replies';
  flowView.hidden = view !== 'flow';
  decisionsView.hidden = view !== 'decisions';
  for (const button of toggles) button.setAttribute('aria-selected', String(button.dataset.view === view));
  if (view !== 'replies') refreshFlow();
}

// The notes panel follows the shown tab's Claude session; a tab whose session id changed (/clear) says where the old notes went.
let notesSession: string | null | undefined;
const sessionByTab = new Map<string, string | null>();
const clearedTabs = new Set<string>();

function followNotesSession({ tabId, sessionId = null }: ShownUpdate): void {
  if (tabId) {
    const before = sessionByTab.get(tabId);
    if (before && sessionId && before !== sessionId) clearedTabs.add(tabId);
    sessionByTab.set(tabId, sessionId);
  }
  if (sessionId === notesSession) return;
  notesSession = sessionId;
  const hint = tabId && clearedTabs.has(tabId) ? 'This tab started a new Claude session. Earlier notes stay with the old one, in History.' : undefined;
  notesPanel.reader.mount({ sessionId, hint });
}
for (const button of toggles) {
  button.addEventListener('click', () => { if (isView(button.dataset.view)) setView(button.dataset.view); });
}

// Jump from a flow step to its reply; only the newest 20 replies are kept on screen.
function showReply(replyIds: readonly (string | undefined)[]): void {
  setView('replies');
  const target = [...replyIds].reverse().map((id) => document.querySelector<HTMLElement>(`[data-reply-id="${CSS.escape(String(id))}"]`)).find(Boolean);
  if (!target) {
    status.textContent = 'That reply is older than the 20 kept on screen.';
    return;
  }
  if (target instanceof HTMLDetailsElement) target.open = true;
  target.scrollIntoView({ block: 'start' });
  target.classList.add('flash');
  setTimeout(() => target.classList.remove('flash'), FLASH_MS);
}

export const setClaudeMissing = (missing: boolean): void => { claudeMissing = missing; rerender(); };

// A standing line above the replies, for startup reads from main that failed; reply updates leave it alone.
const notice = Object.assign(document.createElement('p'), { className: 'status reader-notice', hidden: true });
notice.setAttribute('role', 'alert');
older.before(notice);
export function showNotice(text: string): void {
  notice.textContent = text;
  notice.hidden = false;
}

export const currentView = (): ReaderView => view;

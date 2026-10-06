import * as markdown from './markdown';
import * as diagrams from './diagrams';
import * as flow from './flow';
import { byId, query } from './dom';
import { timeOf } from './format';
import type { ReaderState, Reply } from '../shared/types';

export type ReaderView = 'replies' | 'flow' | 'decisions';
type ShownUpdate = { state: ReaderState; replies: Reply[] };

const latest = byId('latest');
const older = byId('older');
const status = byId('reader-status');
const scroller = byId('reader');
let latestId: string | null | undefined = null;
// The conversation reads top to bottom: earlier turns first, the newest reply last.
status.before(older);

const timeOfReply = (iso: string | undefined): string => (iso ? timeOf(iso) : '');

const youBubble = (prompt: string): HTMLDivElement => Object.assign(document.createElement('div'), { className: 'reader-you', textContent: prompt });

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

export function update({ state, replies }: ShownUpdate): void {
  lastUpdate = { state, replies };
  column.classList.toggle('ended', state === 'ended');
  const [newest, ...rest] = replies;
  if (!newest) {
    showMessage(state === 'live'
      ? 'Claude is running. Its replies will appear here.'
      : claudeMissing
        ? 'Claude Code isn’t installed yet. Install it, then run <code>claude</code> below.'
        : 'Run <code>claude</code> below and replies will appear here.');
    return;
  }
  status.classList.remove('empty');
  status.textContent = state === 'ended'
    ? `Session ended · last reply ${timeOfReply(newest.timestamp)}`
    : `Latest reply · ${timeOfReply(newest.timestamp)}`;
  // Chat-style: what she asked sits in a quiet bubble above Claude's reply.
  latest.replaceChildren(...(newest.prompt ? [youBubble(newest.prompt)] : []), markdown.render(newest.markdown));
  latest.dataset.replyId = newest.id;
  older.replaceChildren(...[...rest].reverse().map(olderTurn)); // oldest first
  diagrams.render(latest);
  if (newest.id !== latestId) status.scrollIntoView({ block: 'start' }); // new reply: bring it into view
  latestId = newest.id;
  if (view === 'flow') scheduleFlowRefresh();
}

let flowTimer: ReturnType<typeof setTimeout> | undefined;
const scheduleFlowRefresh = (): void => {
  clearTimeout(flowTimer);
  flowTimer = setTimeout(refreshFlow, 1500);
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
const toggles = [...document.querySelectorAll<HTMLButtonElement>('#reader .reader-column > .view-toggle button')];
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
for (const button of toggles) {
  button.addEventListener('click', () => { if (isView(button.dataset.view)) setView(button.dataset.view); });
}

// Jump from a flow step to its reply; only the newest 20 replies are kept on screen.
export function showReply(replyIds: readonly (string | undefined)[]): void {
  setView('replies');
  const target = [...replyIds].reverse().map((id) => document.querySelector<HTMLElement>(`[data-reply-id="${CSS.escape(String(id))}"]`)).find(Boolean);
  if (!target) {
    status.textContent = 'That reply is older than the 20 kept on screen.';
    return;
  }
  if (target instanceof HTMLDetailsElement) target.open = true;
  target.scrollIntoView({ block: 'start' });
  target.classList.add('flash');
  setTimeout(() => target.classList.remove('flash'), 1600);
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

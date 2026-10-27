import * as diagrams from './diagrams';
import * as flow from './flow';
import { byId, query } from './dom';
import { setSessionName } from './session-name';
import * as notesPanel from './notes-panel';
import { timeOf } from './format';
import { promptBubble } from './prompt-bubble';
import { createStrip, paintStrip } from './status-strip';
import { paintConclusion } from './conclusion-banner';
import { infoFor, onInfo } from './conclusion-info';
import * as banners from './reader-banners';
import * as prsTab from './prs-tab';
import * as stopClaude from './stop-claude';
import { noticeLines } from './reader-notice';
import * as mentions from './mentions';
import * as setupHints from './reader-setup-hints';
import * as distillCard from './distill-card';
import { forgetAll, renderedReply, type RenderedReply } from './reply-cache';
import * as codeReviewTab from './code-review-tab';
import type { PendingEcho } from './pending-echo';
import type { ReaderNotice, ReaderState, Reply, WaitingPrompt } from '../shared/types';
import { conclusionIsLatest, type Conclusion } from '../shared/conclusion';
import { emptyLine } from '../shared/reader-empty';

export type ReaderView = 'replies' | 'flow';
type ShownUpdate = { state: ReaderState; replies: Reply[]; cwd?: string | null; waiting?: WaitingPrompt[]; pending?: PendingEcho[]; busy?: boolean; repo?: string | null; sessionId?: string | null; label?: string; tabId?: string; conclusion?: Conclusion | null; notice?: ReaderNotice | null };

const latest = byId('latest');
const older = byId('older');
const status = byId('reader-status');
const repoLine = byId('reader-repo');
const sessionLine = byId('reader-session');
const scroller = byId('reader');
const strip = createStrip();
strip.id = 'reader-status-strip';
query(byId('reader-head'), '.reader-head-column').append(strip);
let latestId: string | null | undefined = null;
const FLOW_REFRESH_DELAY_MS = 1500; // let a burst of reply updates settle before redrawing the flow
const FLASH_MS = 1600;
// The conversation reads top to bottom: earlier turns first, the newest reply last.
status.before(older);
// A concluded session: its one-line summary pinned at the top while she scrolls, the full conclusion after the newest reply.
const conclusionPin = Object.assign(document.createElement('div'), { id: 'reader-conclusion-pin', hidden: true });
const conclusionSlot = Object.assign(document.createElement('div'), { id: 'reader-conclusion', hidden: true });
older.before(conclusionPin);
latest.after(conclusionSlot);
conclusionPin.after(prsTab.slot); // the PRs tab sits right under the pinned conclusion
banners.attach(strip, conclusionPin, prsTab.slot);
prsTab.afterPaint(banners.paint);

// The conclusion shown, and its session, so a This session line that lands later repaints only the banners.
let pinned: { sessionId: string; conclusion: Conclusion } | null = null;
function paintPinned(): void {
  paintConclusion(conclusionPin, conclusionSlot, pinned?.conclusion, pinned ? infoFor(pinned.sessionId, pinned.conclusion.at ?? '') : null);
}
onInfo((sessionId) => { if (pinned?.sessionId === sessionId) paintPinned(); });

const timeOfReply = (iso: string | undefined): string => (iso ? timeOf(iso) : '');

// Which reply a fold state belongs to; a reply without an id falls back to its opening words.
const foldKey = (reply: Reply): string => reply.id ?? `text:${reply.markdown.slice(0, 120)}`;

const youBubble = (prompt: string): HTMLDivElement => promptBubble('reader-you', prompt);

// Claude's text for one turn, from the cache unless it changed; a text written after a sectioned one is its own block.
// A reply ending in a `**To @<session>:**` line gets its Send to button after the text; Copy comes last.
function replyParts(reply: Reply): RenderedReply {
  const rendered = renderedReply(reply, foldKey(reply), lastUpdate?.cwd ?? null);
  const send = mentions.replyAction(reply, lastUpdate?.tabId ?? null); // fresh each draw: the target tab may have started or stopped
  if (send) rendered.send?.replaceWith(send);
  rendered.send = send;
  return rendered;
}

const replyBody = (rendered: RenderedReply): HTMLElement[] => [...rendered.blocks, ...(rendered.send ? [rendered.send] : []), rendered.copy];

// Mermaid draws into the cached blocks, so each reply's diagrams render once.
function drawDiagrams(rendered: RenderedReply): void {
  if (rendered.diagramsDrawn) return;
  rendered.diagramsDrawn = true;
  for (const block of rendered.blocks) void diagrams.render(block);
}

// Leaves the container alone when it already holds exactly these nodes, so a redraw keeps layout and scroll.
function placeChildren(container: Element, nodes: Node[]): void {
  const children = container.childNodes;
  if (children.length === nodes.length && nodes.every((node, i) => children[i] === node)) return;
  container.replaceChildren(...nodes);
}

// Sent from the reply box, not yet in Claude's log.
function pendingBubble(echo: PendingEcho): HTMLDivElement {
  const bubble = youBubble(echo.text);
  bubble.classList.add('pending');
  bubble.dataset.pendingKey = String(echo.key);
  return bubble;
}

const writingLine = Object.assign(document.createElement('p'), { className: 'reader-writing', textContent: 'Claude is writing…' });

// A picker on the terminal: Claude has stopped to wait on her, which the log won't show until she answers.
type Asking = 'question' | 'permission' | 'menu' | 'terminal' | null;
const ASKING_TEXT = {
  question: 'Claude is asking you something · answer below',
  permission: 'Claude needs your permission · answer below',
  menu: 'Claude Code is showing a menu · pick below',
  terminal: 'Claude is asking in the terminal',
};
let asking: Asking = null;
const askingLine = Object.assign(document.createElement('p'), { className: 'reader-writing reader-asking' });
const askingLineFor = (kind: NonNullable<Asking>): HTMLParagraphElement => Object.assign(askingLine, { textContent: ASKING_TEXT[kind] });

export function setAsking(next: Asking): void {
  if (next === asking) return;
  asking = next;
  redraw();
}

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

// An earlier turn in full: her message, then Claude's whole reply. Built once, then reused while the reply is unchanged.
function olderTurn(reply: Reply): HTMLElement {
  const rendered = replyParts(reply);
  rendered.turn ??= {
    article: Object.assign(document.createElement('article'), { className: 'reply older-turn' }),
    time: Object.assign(document.createElement('p'), { className: 'older-time', textContent: timeOfReply(reply.timestamp) }),
  };
  const { article: turn, time } = rendered.turn;
  turn.dataset.replyId = reply.id;
  const body = replyBody(rendered);
  placeChildren(turn, [time, ...(rendered.bubble ? [rendered.bubble] : []), ...body]);
  codeReviewTab.attach(turn, body, reviewSource(), { replyId: reply.id });
  drawDiagrams(rendered);
  return turn;
}

// The tab's own session, for its replies' Code review tabs.
const reviewSource = (): { tabId: string } | null => (lastUpdate?.tabId ? { tabId: lastUpdate.tabId } : null);

const column = query(byId('reader'), '.reader-column');

// An empty reader's line, with one button under it when there's something to do.
interface EmptyAction { label: string; event: string }
function showMessage(html: string, action: EmptyAction | null = null, extra: HTMLElement[] = []): void {
  status.classList.add('empty');
  status.innerHTML = html;
  status.append(...extra);
  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'flow-button status-action';
    button.textContent = action.label;
    button.addEventListener('click', () => window.dispatchEvent(new Event(action.event)));
    status.append(document.createElement('br'), button);
  }
  latest.replaceChildren();
  older.replaceChildren();
  latestId = null;
}

// state: 'none' (no claude in the pty), 'live', or 'ended' (claude exited, replies kept).
let lastUpdate: ShownUpdate | null = null;
let claudeMissing = false;
let claudeSetup = false; // a new user: Claude Code's first-run screens, not replies, are what's next
let folderAllowed = true; // set at startup; off means no replies can arrive, whatever the state
const GET_STARTED: EmptyAction = { label: 'Get started', event: 'petal:get-started' };
const SHOW_TERMINAL: EmptyAction = { label: 'Show the terminal', event: 'petal:show-terminal' };
const ALLOW_FOLDER: EmptyAction = { label: 'Allow reading your Claude folder', event: 'petal:allow-folder' };

// Theme switch: rebuild so diagrams pick up the new colours.
export function rerender(): void {
  forgetAll();
  redraw();
}

// A reader state changed (asking, setup, folder): draw again from the cached replies.
function redraw(): void {
  if (lastUpdate) update(lastUpdate);
}

export function update(shown: ShownUpdate): void {
  switchedTab = lastUpdate !== null && shown.tabId !== lastUpdate.tabId;
  lastUpdate = shown;
  followNotesSession(shown);
  const { state, replies, waiting = [], pending = [], busy = false, repo = null, conclusion = null } = shown;
  const stillLatest = conclusion && conclusionIsLatest(conclusion, [replies[0]?.timestamp, waiting.at(-1)?.timestamp]); // a resumed session moved on
  pinned = notesSession && replies.length && stillLatest && conclusion ? { sessionId: notesSession, conclusion } : null; // notesSession outlives an ended claude
  paintPinned();
  prsTab.paint(notesSession ?? null, `${replies.length}:${replies[0]?.id}:${replies[0]?.markdown.length ?? 0}:${waiting.length}`);
  paintStrip(strip, replies.map((r) => r.markdown));
  banners.paint();
  repoLine.textContent = repo ?? '';
  repoLine.hidden = !repo;
  const named = Boolean(shown.sessionId && shown.label); // the tab's own session name, the same one its tab and History show
  if (named) setSessionName(sessionLine, shown.label ?? ''); else sessionLine.textContent = '';
  sessionLine.hidden = !named;
  column.classList.toggle('ended', state === 'ended');
  const live = state === 'live';
  const open = live ? openTurn(waiting, pending) : null;
  const writing = !live ? [] : asking ? [askingLineFor(asking)] : busy || pending.length > 0 ? [writingLine] : [];
  if (open) {
    showOpenTurn(open, replies, writing);
    return;
  }
  const [newest, ...rest] = replies;
  const empty = emptyLine({ hasReply: Boolean(newest), live, claudeSetup, folderAllowed, claudeMissing });
  if (empty === 'folder-off') showMessage('Petal isn’t reading your Claude folder, so replies won’t show here. The terminal below works as usual.', ALLOW_FOLDER);
  else if (empty === 'setting-up') showMessage('Claude Code is setting up in the terminal below. Pick your options there (arrow keys and Enter).', SHOW_TERMINAL);
  else if (empty === 'running') showLive(noticeLines(shown.notice, shown.tabId));
  else if (empty === 'not-installed') showMessage('Claude Code isn’t installed yet. Install it with this command:', GET_STARTED, setupHints.installSteps());
  else if (empty === 'start') showMessage('No conversation yet. Start here: click Add Session, and Claude starts in the new tab.', GET_STARTED);
  if (empty || !newest) return;
  status.classList.remove('empty');
  status.textContent = state === 'ended'
    ? `Session ended · last reply ${timeOfReply(newest.timestamp)}`
    : `Latest reply · ${timeOfReply(newest.timestamp)}`;
  appendStop();
  // Chat-style: what she asked sits in a quiet bubble above Claude's reply.
  const needsYou = live && !busy ? distillCard.card(shown.tabId ?? null, 'reader') : null; // a test-loop round waiting on her
  const rendered = replyParts(newest);
  const body = replyBody(rendered);
  placeChildren(latest, [...(rendered.bubble ? [rendered.bubble] : []), ...body, ...(needsYou ? [needsYou] : []), ...writing]);
  codeReviewTab.attach(latest, body, reviewSource(), { replyId: newest.id });
  latest.dataset.replyId = newest.id;
  placeChildren(older, [...rest].reverse().map(olderTurn)); // oldest first
  drawDiagrams(rendered);
  bringIntoView(newest.id);
  if (view === 'flow') scheduleFlowRefresh();
}

// An older Claude Code may add an update hint, or ask which log is this tab's (then the running line goes).
function showLive(notice: HTMLElement[] | null): void {
  const choosing = notice?.some((line) => line.classList.contains('notice-choices'));
  showMessage(choosing ? '' : 'Claude is running. Its replies will appear here.');
  if (notice) status.append(...notice);
}

// She has spoken since Claude's newest reply: every reply moves up, and her message leads the page.
function showOpenTurn(open: OpenTurn, replies: Reply[], writing: HTMLElement[]): void {
  status.classList.remove('empty');
  status.textContent = `You · ${timeOfReply(open.time)}`;
  appendStop();
  latest.replaceChildren(...open.bubbles, ...writing);
  delete latest.dataset.replyId;
  placeChildren(older, [...replies].reverse().map(olderTurn)); // oldest first
  bringIntoView(open.id);
  if (view === 'flow') scheduleFlowRefresh();
}

// The streaming reply's own Stop, at the end of its header line.
function appendStop(): void {
  const control = lastUpdate?.tabId ? stopClaude.control(lastUpdate.tabId, 'reader') : null;
  if (control) status.append(control);
}

// Switching tabs lands at the end of the newest reply; a new turn in the same tab lands at its start.
let switchedTab = false;
const PIN_TO_END_MS = 2000; // long enough for diagrams and images to settle; later jumps (find, Flow) are left alone
let pinnedUntil = 0;
function bringIntoView(id: string | undefined): void {
  if (switchedTab) {
    pinnedUntil = Date.now() + PIN_TO_END_MS;
    latest.scrollIntoView({ block: 'end' });
  } else if (id !== latestId) {
    pinnedUntil = 0;
    status.scrollIntoView({ block: 'start' });
  }
  latestId = id;
}
new ResizeObserver(() => { if (Date.now() < pinnedUntil) latest.scrollIntoView({ block: 'end' }); }).observe(latest);
for (const type of ['wheel', 'pointerdown', 'touchstart', 'keydown'] as const) {
  scroller.addEventListener(type, () => { pinnedUntil = 0; }, { passive: true });
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

// Replies | Flow toggle for this window's session.
const repliesView = byId('replies-view');
const flowView = byId('flow-view');
const toggles = [...document.querySelectorAll<HTMLButtonElement>('#reader-head .view-toggle button')];
let view: ReaderView = 'replies';

export async function refreshFlow(): Promise<void> {
  const result = await window.pastel.flow.get({ kind: 'current' });
  flow.render(flowView, result, { target: { kind: 'current' }, onJump: (step) => showReply(step.replyIds) });
}

const isView = (value: string | undefined): value is ReaderView => value === 'replies' || value === 'flow';

export function setView(next: ReaderView): void {
  view = next;
  repliesView.hidden = view !== 'replies';
  flowView.hidden = view !== 'flow';
  for (const button of toggles) button.setAttribute('aria-selected', String(button.dataset.view === view));
  if (view !== 'replies') refreshFlow();
}

// The notes panel follows the shown tab's Claude session, or the last one it had once Claude ends;
// a tab whose session id changed (/clear) says where the old notes went.
let notesSession: string | null | undefined;
const sessionByTab = new Map<string, string>();
const clearedTabs = new Set<string>();

function followNotesSession({ tabId, sessionId: live = null }: ShownUpdate): void {
  let sessionId = live;
  if (tabId) {
    const before = sessionByTab.get(tabId);
    if (before && live && before !== live) clearedTabs.add(tabId);
    if (live) sessionByTab.set(tabId, live);
    else sessionId = before ?? null;
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
  setTimeout(() => target.classList.remove('flash'), FLASH_MS);
}

export const setClaudeMissing = (missing: boolean): void => { claudeMissing = missing; redraw(); };
export const setClaudeSetup = (setup: boolean): void => { if (setup !== claudeSetup) { claudeSetup = setup; redraw(); } };
export const setFolderAllowed = (allowed: boolean): void => { folderAllowed = allowed; redraw(); };

// A standing line above the replies, for startup reads from main that failed; reply updates leave it alone.
const notice = Object.assign(document.createElement('p'), { className: 'status reader-notice', hidden: true });
notice.setAttribute('role', 'alert');
older.before(notice);
notice.after(setupHints.pathTipLine);
export const setPathTip = setupHints.setPathTip;
export function showNotice(text: string): void {
  notice.textContent = text;
  notice.hidden = false;
}

export const currentView = (): ReaderView => view;

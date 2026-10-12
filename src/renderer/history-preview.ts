// History's preview pane: the hovered session's header and its whole conversation, flow or decisions; notes sit beside it.
// Replies end in a reply box; once a tab answers for the session, the conversation follows that tab live.
import * as diagrams from './diagrams';
import * as flow from './flow';
import { el } from './dom';
import { sessionNameEl, setSessionName } from './session-name';
import { timeOf } from './format';
import { dayLabel, hooks, notesAside, openNote, preview, railTitle, replyDock, selectedSession, state, titleOf, view, type Session } from './history-state';
import { createPanel } from './notes-panel';
import * as favorites from './favorites';
import * as overlays from './overlays';
import * as reply from './history-reply';
import { createStrip, paintStrip } from './status-strip';
import { limitNote } from './sessions-panel';
import { liveTab, liveTail, liveThread, paintStatus, replyBox, turnCard, type Turn } from './history-reply-view';
import { paintConclusion } from './conclusion-banner';

// A title that landed while the preview is up: rename it in place instead of reloading the replies.
export function repaintTitle(): void {
  const session = selectedSession();
  const heading = preview.querySelector<HTMLElement>('.history-preview-title');
  if (!session) return;
  setSessionName(railTitle, titleOf(session));
  if (heading && preview.dataset.sessionId === session.sessionId) setSessionName(heading, titleOf(session));
}

export async function renderPreview(): Promise<void> {
  const session = selectedSession();
  if (openNote.dataset.sessionId !== session?.sessionId) openNote.replaceChildren(); // the banner speaks for one session
  if (!session) {
    preview.replaceChildren(el('p', 'status empty', 'Pick a session to preview it.'));
    replyDock.replaceChildren();
    return;
  }
  setSessionName(railTitle, titleOf(session));
  const head = el('header', 'history-preview-head');
  const titleRow = el('div', 'history-preview-title-row');
  titleRow.append(sessionNameEl('h2', 'history-preview-title', titleOf(session)), favorites.star(session.sessionId, 'history-preview-star'));
  head.append(titleRow,
    el('p', 'status', `${session.shortCwd} · ${dayLabel(session.lastAt)} ${timeOf(session.lastAt)}`));

  const note = el('p', 'history-note');
  const resume = el('button', 'flow-button resume-button', 'Open');
  resume.type = 'button';
  resume.addEventListener('click', () => doResume(session.sessionId, note, false));
  const toggle = el('div', 'view-toggle');
  for (const mode of ['replies', 'flow', 'decisions'] as const) {
    const b = el('button', '', { replies: 'Replies', flow: 'Flow', decisions: 'Decisions' }[mode]);
    b.type = 'button';
    b.setAttribute('aria-selected', String(mode === state.previewMode));
    b.addEventListener('click', () => { state.previewMode = mode; renderPreview(); });
    toggle.append(b);
  }
  const send = el('button', 'flow-button resume-button', 'Send to Claude');
  send.type = 'button';
  send.title = 'Let the Claude in this window read this session';
  send.addEventListener('click', () => doSend(session.sessionId, note));
  const notesToggle = el('button', 'notes-toggle', 'Notes');
  notesToggle.type = 'button';
  notesToggle.title = 'Your notes for this session, beside the preview';
  const views = el('div', 'history-preview-views');
  views.append(toggle, notesToggle);
  const strip = createStrip();
  head.append(resume, send, note, views, strip);

  const conclusion = el('div', 'history-conclusion');
  paintConclusion(conclusion, session.sessionId, session.conclusion);
  const body = el('div', 'history-preview-body');
  preview.replaceChildren(head, conclusion, body);
  preview.dataset.sessionId = session.sessionId; // which session the heading names, for repaintTitle
  replyDock.replaceChildren(...(state.previewMode === 'replies' ? [replyBox(session)] : []));
  notes.bindToggle(notesToggle); // once in the page: the panel forgets toggles that are not
  showNotes(session);
  await Promise.all([renderBody(session, body), fillStrip(session, strip)]);
}

// A re-list brought a new conclusion: swap the banner only, so her place in the preview stays.
export function repaintConclusion(): void {
  const session = selectedSession();
  const slot = preview.querySelector<HTMLElement>('.history-conclusion');
  if (session && slot) paintConclusion(slot, session.sessionId, session.conclusion);
}

// The session's newest replies: the live tab's when one follows it, else the log on disk.
async function fillStrip(session: Session, strip: HTMLElement): Promise<void> {
  const tab = liveTab(session);
  if (tab) {
    paintStrip(strip, (tab.update?.replies ?? []).map((r) => r.markdown));
    return;
  }
  try {
    const page = await window.pastel.history.conversation(session.sessionId);
    paintStrip(strip, 'error' in page ? [] : [...page.turns].reverse().map((turn) => turn.reply));
  } catch {
    paintStrip(strip, []); // the body already shows the read error
  }
}

async function renderBody(session: Session, body: HTMLElement): Promise<void> {
  try {
    if (state.previewMode !== 'replies') await renderFlowBody(session, body);
    else {
      const tab = liveTab(session);
      if (tab) body.append(liveThread(tab));
      else await renderRepliesBody(session, body);
      body.append(liveTail(session));
    }
  } catch (error) {
    showError(body, error);
  }
}

let redraws = 0;
// The tab replying to the shown session changed: redraw its replies only, so the head and reply box keep her place.
async function redrawFollowed(tabId: string | null): Promise<void> {
  const session = selectedSession();
  if (!session || !overlays.isOpen('history') || state.previewMode !== 'replies') return;
  if (tabId !== null && reply.tabFor(session.sessionId)?.id !== tabId) return;
  const ticket = ++redraws;
  const atEnd = preview.scrollHeight - preview.scrollTop - preview.clientHeight < 80;
  const fresh = el('div', 'history-preview-body');
  await renderBody(session, fresh);
  if (ticket !== redraws || selectedSession() !== session) return; // a newer redraw or another session won
  preview.querySelector('.history-preview-body')?.replaceWith(fresh);
  const strip = preview.querySelector<HTMLElement>('.history-preview-head .status-strip');
  if (strip) void fillStrip(session, strip);
  repaintFollowed();
  if (atEnd) preview.scrollTop = preview.scrollHeight;
}

function repaintFollowed(): void {
  const session = selectedSession();
  const box = replyDock.querySelector<HTMLElement>('.history-reply-box');
  if (session && box) paintStatus(box, session);
}

reply.hooks.redraw = (tabId) => void redrawFollowed(tabId);
reply.hooks.repaint = (tabId) => { if (reply.tabFor(selectedSession()?.sessionId ?? '')?.id === tabId) repaintFollowed(); };

// Failures show as a line in the pane, never as a blank preview.
function showError(body: HTMLElement, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  body.replaceChildren(el('p', 'history-error', `Couldn’t show this session: ${message}`));
}

const notes = createPanel(notesAside, view);
let notesFor: string | null = null;

// The panel follows the previewed session; saving updates the row's notes badge and what search finds.
function showNotes(session: Session): void {
  if (session.sessionId === notesFor) return;
  notesFor = session.sessionId;
  notes.mount({ sessionId: session.sessionId, onSaved: (text) => { session.notes = text; hooks.renderList(); } });
}

async function renderFlowBody(session: Session, body: HTMLElement): Promise<void> {
  const target = { kind: 'history', sessionId: session.sessionId } as const;
  const draw = state.previewMode === 'decisions' ? flow.renderDecisions : flow.render;
  draw(body, await window.pastel.flow.get(target), {
    target,
    onJump: () => { state.previewMode = 'replies'; renderPreview(); },
    onCreated: () => { session.hasFlow = true; hooks.renderList(); },
  });
}

// The whole conversation in order, newest at the bottom; "Show earlier" pages back through older turns.
async function renderRepliesBody(session: Session, body: HTMLElement): Promise<void> {
  const first = await window.pastel.history.conversation(session.sessionId);
  if ('error' in first) {
    showError(body, first.error);
    return;
  }
  if (!first.turns.length) {
    body.append(el('p', 'status', 'No messages in this session yet.'));
    return;
  }
  const thread = el('div', 'history-thread');
  const earlier = el('button', 'flow-button history-earlier', '');
  earlier.type = 'button';
  let start = first.start;
  const updateEarlier = () => {
    earlier.hidden = start === 0;
    earlier.textContent = `Show earlier · ${start} more`;
  };
  const append = (turns: Turn[], where: 'top' | 'bottom') => {
    const cards = turns.map((turn) => turnCard(turn));
    if (where === 'top') thread.prepend(...cards);
    else thread.append(...cards);
    cards.forEach((card) => diagrams.render(card));
  };
  earlier.addEventListener('click', async () => {
    const scroller = body.closest<HTMLElement>('.history-preview') ?? body;
    const fromBottom = scroller.scrollHeight - scroller.scrollTop;
    const page = await window.pastel.history.conversation(session.sessionId, start);
    if ('error' in page) return;
    start = page.start;
    append(page.turns, 'top');
    updateEarlier();
    scroller.scrollTop = scroller.scrollHeight - fromBottom; // keep her place
  });
  append(first.turns, 'bottom');
  updateEarlier();
  body.append(earlier, thread);
  const scroller = body.closest<HTMLElement>('.history-preview') ?? body;
  requestAnimationFrame(() => { scroller.scrollTop = scroller.scrollHeight; }); // open at the newest turn
}

export async function doResume(sessionId: string, note: HTMLElement, confirmFork: boolean): Promise<void> {
  // A session already in a tab just gets focused; anything else starts a Claude, so her limit applies.
  note.dataset.sessionId = sessionId;
  const limited = reply.tabFor(sessionId) ? null : await limitNote('open it here');
  if (limited) {
    note.textContent = limited;
    return;
  }
  const result = await window.pastel.history.resume(sessionId, confirmFork);
  note.replaceChildren();
  if ('ok' in result) {
    hooks.close();
    return;
  }
  if ('error' in result) {
    note.textContent = `Couldn’t open it: ${result.error}`;
    return;
  }
  if ('confirm' in result) {
    const again = el('button', 'flow-button', 'Open anyway');
    again.type = 'button';
    again.addEventListener('click', () => doResume(sessionId, note, true));
    note.append(document.createTextNode(`${result.confirm} `), again);
    return;
  }
  note.textContent = result.note;
}

async function doSend(sessionId: string, note: HTMLElement): Promise<void> {
  note.textContent = 'Preparing…';
  const result = await window.pastel.history.send(sessionId);
  if ('ok' in result) {
    note.replaceChildren();
    hooks.close(); // back to the terminal, where the "read this" line is waiting for her question
    return;
  }
  note.textContent = 'error' in result ? result.error : result.note;
}

// Preview without re-rendering the list, so hovering never steals the row under the mouse.
export function hoverPreview(sessionId: string): void {
  if (sessionId === state.selectedId) return;
  if (document.activeElement?.matches(':is(#history-reply-dock, #history-notes) textarea')) return; // never swap the session she's typing into
  state.selectedId = sessionId;
  state.previewMode = 'replies'; // a newly picked session always opens on its replies
  for (const r of document.querySelectorAll<HTMLElement>('.history-row')) r.classList.toggle('selected', r.dataset.sessionId === sessionId);
  renderPreview();
}

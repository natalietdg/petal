// History's preview pane: the hovered session's header, its whole conversation, or its flow and decisions.
import * as markdown from './markdown';
import * as diagrams from './diagrams';
import * as flow from './flow';
import { el } from './dom';
import { timeOf } from './format';
import { dayLabel, hooks, preview, selectedSession, state, titleOf, type Session } from './history-state';
import { attachPreviewTags } from './history-tags';
import { createNotesEditor, type NotesEditor } from './notes';

type Turn = { index: number; prompt: string; reply: string };

export async function renderPreview(): Promise<void> {
  const session = selectedSession();
  if (!session) {
    preview.replaceChildren(el('p', 'status empty', 'Pick a session to preview it.'));
    return;
  }
  const head = el('header', 'history-preview-head');
  head.append(el('h2', 'history-preview-title', titleOf(session)),
    el('p', 'status', `${session.shortCwd} · ${dayLabel(session.lastAt)} ${timeOf(session.lastAt)}`));
  const tagLine = el('div', 'history-preview-tags');
  head.append(tagLine);
  attachPreviewTags(tagLine);

  const note = el('p', 'history-note');
  const resume = el('button', 'flow-button resume-button', 'Open');
  resume.type = 'button';
  resume.addEventListener('click', () => doResume(session.sessionId, note, false));
  const toggle = el('div', 'view-toggle');
  for (const mode of ['replies', 'flow', 'decisions', 'notes'] as const) {
    const b = el('button', '', { replies: 'Replies', flow: 'Flow', decisions: 'Decisions', notes: 'Notes' }[mode]);
    b.type = 'button';
    b.setAttribute('aria-selected', String(mode === state.previewMode));
    b.addEventListener('click', () => { state.previewMode = mode; renderPreview(); });
    toggle.append(b);
  }
  const send = el('button', 'flow-button resume-button', 'Send to Claude');
  send.type = 'button';
  send.title = 'Let the Claude in this window read this session';
  send.addEventListener('click', () => doSend(session.sessionId, note));
  head.append(resume, send, note, toggle);

  const body = el('div', 'history-preview-body');
  void notesEditor?.flush(); // typing in the last notes is saved before they go
  notesEditor = null;
  preview.replaceChildren(head, body);
  try {
    if (state.previewMode === 'notes') renderNotesBody(session, body);
    else await (state.previewMode === 'replies' ? renderRepliesBody(session, body) : renderFlowBody(session, body));
  } catch (error) {
    showError(body, error);
  }
}

// Failures show as a line in the pane, never as a blank preview.
function showError(body: HTMLElement, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  body.replaceChildren(el('p', 'history-error', `Couldn’t show this session: ${message}`));
}

let notesEditor: NotesEditor | null = null;

// Saving updates the row's notes badge and what search finds.
function renderNotesBody(session: Session, body: HTMLElement): void {
  notesEditor = createNotesEditor(session.sessionId, {
    onSaved: (text) => { session.notes = text; hooks.renderList(); },
  });
  body.append(notesEditor.element);
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

// One turn: what she asked, then Claude's reply rendered like the reader.
function turnCard(turn: Turn): HTMLElement {
  const card = el('article', 'history-turn');
  card.dataset.turn = String(turn.index);
  card.append(el('p', 'history-you-label', 'You'), el('div', 'history-you', turn.prompt));
  if (turn.reply) {
    const reply = el('div', 'history-reply');
    reply.append(markdown.render(turn.reply));
    card.append(reply);
  }
  return card;
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
    const cards = turns.map(turnCard);
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
  if (document.activeElement?.matches('#history-preview textarea')) return; // never swap the session she's typing into
  state.selectedId = sessionId;
  state.previewMode = 'replies'; // a newly picked session always opens on its replies
  for (const r of document.querySelectorAll<HTMLElement>('.history-row')) r.classList.toggle('selected', r.dataset.sessionId === sessionId);
  renderPreview();
}

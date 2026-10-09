// What History's preview shows for a reply: the box itself, the tab's live replies, and her messages on their way.
import * as markdown from './markdown';
import * as diagrams from './diagrams';
import * as tabs from './tabs';
import * as reply from './history-reply';
import { el } from './dom';
import { promptBubble } from './prompt-bubble';
import { hooks, type Session } from './history-state';
import { parsePermissionPrompt, parseQuestionPicker } from '../shared/prompt-answer';
import type { Tab } from './tabs';

export type Turn = { index: number; prompt: string; reply: string };

const drafts = new Map<string, string>(); // sessionId -> unsent text, so switching sessions loses nothing

// One turn: what she asked, then Claude's reply rendered like the reader.
export function turnCard(turn: Turn, youClass = ''): HTMLElement {
  const card = el('article', 'history-turn');
  card.dataset.turn = String(turn.index);
  card.append(el('p', 'history-you-label', youClass === 'queued' ? 'You · waiting for Claude to start' : 'You'),
    promptBubble(`history-you ${youClass}`.trim(), turn.prompt));
  if (turn.reply) {
    const body = el('div', 'history-reply');
    // Keyed by its opening words, which a streaming reply never rewrites, so redraws keep what she opened.
    body.append(markdown.render(turn.reply, { fold: `history:${turn.index}:${turn.reply.slice(0, 120)}` }));
    card.append(body);
  }
  return card;
}

// The tab has replies of its own once Claude is up there; until then the log on disk is the conversation.
export const liveTab = (session: Session): Tab | null => {
  const tab = reply.tabFor(session.sessionId);
  return tab?.update && tab.update.state !== 'none' && tab.update.replies.length ? tab : null;
};

export function liveThread(tab: Tab): HTMLElement {
  const { replies = [], waiting = [] } = tab.update ?? {};
  const thread = el('div', 'history-thread');
  [...replies].reverse().forEach((r, i) => thread.append(turnCard({ index: i, prompt: r.prompt, reply: r.markdown })));
  waiting.forEach((w, i) => thread.append(turnCard({ index: replies.length + i, prompt: w.prompt, reply: '' })));
  thread.querySelectorAll<HTMLElement>('.history-turn').forEach((card) => diagrams.render(card));
  return thread;
}

// Her messages not yet in Claude's log: queued for a Claude still starting, then sent and echoed.
export function liveTail(session: Session): HTMLElement {
  const tail = el('div', 'history-thread history-live-tail');
  const tab = reply.tabFor(session.sessionId);
  reply.queuedFor(session.sessionId).forEach((text) => tail.append(turnCard({ index: -1, prompt: text, reply: '' }, 'queued')));
  tab?.pending.forEach((echo) => tail.append(turnCard({ index: -1, prompt: echo.text, reply: '' }, 'pending')));
  if (tab?.update?.state === 'live' && (tab.update.busy || tab.pending.length)) tail.append(el('p', 'reader-writing', 'Claude is writing…'));
  return tail;
}

function openInFull(session: Session): void {
  const tab = reply.tabFor(session.sessionId);
  if (!tab) return;
  hooks.close();
  tabs.activate(tab.id);
}

const fullButton = (session: Session): HTMLButtonElement => {
  const button = el('button', 'flow-button history-open-full', 'Open in full');
  button.type = 'button';
  button.addEventListener('click', () => openInFull(session));
  return button;
};

// A question or permission picker in that tab: permissions answer here, questions open in full.
export function paintStatus(box: HTMLElement, session: Session): void {
  const status = box.querySelector<HTMLElement>('.history-reply-status');
  const tab = reply.tabFor(session.sessionId);
  box.querySelector<HTMLElement>('.history-reply-row .history-open-full')?.toggleAttribute('hidden', !tab);
  if (!status) return;
  status.replaceChildren();
  if (!tab) return;
  const screen = tabs.screenLines(tab);
  if (parseQuestionPicker(screen)) {
    status.append(el('span', '', 'Claude is asking something ·'), fullButton(session));
    return;
  }
  const permission = parsePermissionPrompt(screen);
  if (!permission) return;
  status.append(el('span', '', `${permission.title} · ${permission.question}`));
  for (const option of permission.options) {
    const button = el('button', 'flow-button', `${option.number}. ${option.label}`);
    button.type = 'button';
    button.addEventListener('click', () => {
      window.pastel.answerPrompt(tab.id, { kind: 'permission', option: option.number });
      status.replaceChildren(el('span', '', 'Sent · waiting for Claude'));
    });
    status.append(button);
  }
}

async function submit(session: Session, input: HTMLTextAreaElement, note: HTMLElement, confirmFork: boolean): Promise<void> {
  if (!input.value.trim()) return;
  note.textContent = 'Sending…';
  const outcome = await reply.sendReply(session.sessionId, input.value, confirmFork);
  if ('sent' in outcome) {
    input.value = '';
    drafts.delete(session.sessionId);
    note.textContent = '';
  } else if ('confirm' in outcome) {
    const again = el('button', 'flow-button', 'Open anyway');
    again.type = 'button';
    again.addEventListener('click', () => submit(session, input, note, true));
    note.replaceChildren(document.createTextNode(`${outcome.confirm} `), again);
  } else {
    note.textContent = outcome.note;
  }
}

// The reply box under the preview; Enter sends, Shift+Enter adds a line.
export function replyBox(session: Session): HTMLFormElement {
  const form = el('form', 'history-reply-box');
  form.autocomplete = 'off';
  const input = el('textarea', 'history-reply-input');
  input.rows = 2;
  input.placeholder = 'Reply to this session…';
  input.setAttribute('aria-label', 'Reply to this session');
  input.value = drafts.get(session.sessionId) ?? '';
  const send = el('button', 'flow-button history-reply-send', 'Send');
  send.type = 'submit';
  const row = el('div', 'history-reply-row');
  row.append(input, send, fullButton(session));
  const note = el('p', 'history-note history-reply-note');
  note.setAttribute('aria-live', 'polite');
  form.append(el('div', 'history-reply-status'), row, note);

  input.addEventListener('input', () => drafts.set(session.sessionId, input.value));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void submit(session, input, note, false);
  });
  paintStatus(form, session);
  return form;
}

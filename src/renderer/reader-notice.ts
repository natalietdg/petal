// The empty reader's extra lines for an older Claude Code: the update hint, and "which log is this tab's".
// Also the launch card for the last quit's resume notes.
import { el, isIpcError } from './dom';
import { timeOf } from './format';
import { oldClaudeHint, SHARED_FOLDER_LINE, UPDATE_COMMAND } from '../shared/reader-notice';
import type { ReaderNotice, SessionChoice } from '../shared/types';
import type { ResumeNotesSet } from '../shared/ipc';

const COPIED_MS = 1600;

function copyButton(text: string): HTMLButtonElement {
  const button = el('button', 'flow-button status-action notice-copy', 'Copy');
  button.type = 'button';
  button.addEventListener('click', async () => {
    const copied = await navigator.clipboard.writeText(text).then(() => true, () => false);
    button.textContent = copied ? 'Copied' : 'Copy failed';
    setTimeout(() => { button.textContent = 'Copy'; }, COPIED_MS);
  });
  return button;
}

// The hint as text, with the command set as code.
function hintLine(version: string): HTMLParagraphElement {
  const line = el('p', 'notice-update');
  const [before, after] = oldClaudeHint(version).split(`\`${UPDATE_COMMAND}\``);
  line.append(before, el('code', null, UPDATE_COMMAND), after ?? '', ' ', copyButton(UPDATE_COMMAND));
  return line;
}

const choiceLabel = ({ startedAt, prompt }: SessionChoice): string =>
  [startedAt ? `Started ${timeOf(startedAt)}` : 'Session', prompt ? `“${prompt.length > 60 ? `${prompt.slice(0, 60)}…` : prompt}”` : null].filter(Boolean).join(' · ');

function choiceButton(choice: SessionChoice, tabId: string): HTMLButtonElement {
  const button = el('button', 'flow-button status-action notice-choice', choiceLabel(choice));
  button.type = 'button';
  button.dataset.sessionId = choice.sessionId;
  button.addEventListener('click', () => window.pastel.pickSession(tabId, choice.sessionId));
  return button;
}

// The lines to show under (or instead of) "Claude is running", or null when there's nothing to say.
export function noticeLines(notice: ReaderNotice | null | undefined, tabId: string | null | undefined): HTMLElement[] | null {
  if (!notice) return null;
  const lines: HTMLElement[] = [];
  if (notice.choices.length && tabId) {
    const pick = el('div', 'notice-choices');
    pick.append(el('p', null, SHARED_FOLDER_LINE), ...notice.choices.map((c) => choiceButton(c, tabId)));
    lines.push(pick);
  }
  if (notice.oldVersion) lines.push(hintLine(notice.oldVersion));
  return lines.length ? lines : null;
}

// ── Where you left off: the newest quit's resume notes, offered once on launch ──

const RESUME_ROWS = 5; // more are in the notes themselves

async function resumeFromNote(sessionId: string, button: HTMLButtonElement): Promise<void> {
  button.disabled = true;
  let result = await window.pastel.history.resume(sessionId);
  if (!isIpcError(result) && 'confirm' in result) {
    result = window.confirm(result.confirm) ? await window.pastel.history.resume(sessionId, true) : { note: '' };
  }
  const note = isIpcError(result) ? `Couldn’t resume it: ${result.error}` : 'note' in result ? result.note : null;
  button.textContent = note === null ? 'Opened' : 'Resume';
  button.disabled = note === null;
  if (note) button.title = note;
}

function sessionRow({ title, sessionId, running }: ResumeNotesSet['sessions'][number]): HTMLLIElement {
  const row = el('li', 'resume-notice-row');
  const resume = el('button', 'flow-button resume-notice-open', 'Resume');
  resume.type = 'button';
  resume.addEventListener('click', () => void resumeFromNote(sessionId, resume));
  row.append(el('span', 'resume-notice-title', running ? `${title} (Claude was mid-reply)` : title), resume);
  return row;
}

export function resumeCard(set: ResumeNotesSet): HTMLElement {
  const card = el('div', 'status resume-notice');
  card.setAttribute('role', 'status');
  const count = set.notes === 1 ? 'a note' : `${set.notes} notes`;
  card.append(el('p', 'resume-notice-line', `When Petal last quit (${set.when}) it saved ${count} on where each session stopped.`));
  if (set.sessions.length) {
    const list = el('ul', 'resume-notice-list');
    list.append(...set.sessions.slice(0, RESUME_ROWS).map(sessionRow));
    card.append(list);
  }
  const actions = el('div', 'resume-notice-actions');
  const reveal = el('button', 'flow-button resume-notice-reveal', 'Show notes in Finder');
  reveal.type = 'button';
  reveal.addEventListener('click', () => void window.pastel.resumeNotes.reveal(set.stamp));
  const dismiss = el('button', 'cz-quiet-button resume-notice-dismiss', 'Dismiss');
  dismiss.type = 'button';
  dismiss.addEventListener('click', () => card.remove());
  actions.append(reveal, dismiss);
  card.append(actions);
  return card;
}

// Once per quit: main marks the set shown as it hands it over, so a second window or launch gets nothing.
export async function offerResumeNotes(): Promise<void> {
  const set = await window.pastel.resumeNotes.latest();
  if (isIpcError(set) || !set) return;
  document.querySelector('.reader-notice')?.after(resumeCard(set));
}

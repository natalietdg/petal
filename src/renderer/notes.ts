// Her private notes for one Claude session: a calm textarea that saves itself, with a rendered view to read them back.
// Notes go to Petal's own folder through main; nothing here ever reaches the terminal or Claude.
import * as markdown from './markdown';
import { el, isIpcError } from './dom';
import { PR_NOTE_FIELDS, PR_NOTE_LABELS, type PrNotes } from '../shared/session-prs';

const SAVE_DELAY_MS = 600;
const SAVED_EVENT = 'petal:notes-saved';
interface SavedNotes { sessionId: string; text: string; from: HTMLElement }
export const PR_NOTES_SAVED_EVENT = 'petal:pr-notes-saved'; // detail: the session id

export interface NotesEditor {
  element: HTMLElement;
  flush: () => Promise<void>; // saves any unsaved typing now
}

interface Options {
  hint?: string; // one quiet line under the toolbar
  onSaved?: (text: string) => void;
  onLoaded?: (text: string) => void; // the saved notes, once read
}

const noSession = (): NotesEditor => ({
  element: el('p', 'status empty notes-empty', 'No Claude session in this tab yet'),
  flush: async () => {},
});

export function createNotesEditor(sessionId: string | null, { hint, onSaved, onLoaded }: Options = {}): NotesEditor {
  if (!sessionId) return noSession();
  const root = el('section', 'notes');
  root.dataset.sessionId = sessionId;
  const bar = el('div', 'notes-bar');
  const status = el('span', 'notes-status', 'Loading…');
  const mode = el('button', 'flow-button notes-mode', 'Read');
  mode.type = 'button';
  bar.append(el('span', 'notes-private', 'Only you see these. Claude never does.'), status, mode);
  const input = el('textarea', 'notes-editor');
  input.placeholder = 'Your notes for this session…';
  input.setAttribute('aria-label', 'Your notes for this session');
  input.disabled = true;
  const rendered = el('div', 'notes-rendered');
  rendered.hidden = true;
  const prs = el('section', 'notes-prs');
  prs.hidden = true;
  root.append(bar, ...(hint ? [el('p', 'notes-hint', hint)] : []), input, rendered, prs);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let saved = '';
  const save = async (): Promise<void> => {
    clearTimeout(timer);
    const text = input.value;
    if (text === saved) return;
    status.textContent = 'Saving…';
    const result = await window.pastel.notes.save(sessionId, text);
    if (isIpcError(result) || 'note' in result) {
      status.textContent = `Couldn’t save: ${isIpcError(result) ? result.error : result.note}`;
      return;
    }
    saved = text;
    status.textContent = 'Saved';
    onSaved?.(text);
    window.dispatchEvent(new CustomEvent<SavedNotes>(SAVED_EVENT, { detail: { sessionId, text, from: root } }));
  };

  // The same session's notes open elsewhere (reader and History) take her latest save unless she is typing here.
  const takeSave = (event: Event): void => {
    if (!root.isConnected) return window.removeEventListener(SAVED_EVENT, takeSave);
    const { detail } = event as CustomEvent<SavedNotes>;
    if (detail.sessionId !== sessionId || detail.from === root || document.activeElement === input) return;
    input.value = saved = detail.text;
    status.textContent = 'Saved';
  };
  window.addEventListener(SAVED_EVENT, takeSave);

  // PR notes are edited in the PRs tab; here they are read back after each save there.
  const takePrSave = (event: Event): void => {
    if (!root.isConnected) return window.removeEventListener(PR_NOTES_SAVED_EVENT, takePrSave);
    if ((event as CustomEvent<string>).detail !== sessionId) return;
    void window.pastel.notes.get(sessionId).then((result) => { if (!isIpcError(result)) paintPrNotes(prs, result.prs); });
  };
  window.addEventListener(PR_NOTES_SAVED_EVENT, takePrSave);

  input.addEventListener('input', () => {
    status.textContent = 'Editing';
    clearTimeout(timer);
    timer = setTimeout(save, SAVE_DELAY_MS);
  });
  input.addEventListener('blur', () => void save());
  mode.addEventListener('click', () => {
    const reading = rendered.hidden;
    if (reading) rendered.replaceChildren(markdown.render(input.value || '_No notes yet._'));
    rendered.hidden = !reading;
    input.hidden = reading;
    mode.textContent = reading ? 'Edit' : 'Read';
    if (!reading) input.focus();
  });

  void window.pastel.notes.get(sessionId).then((result) => {
    if (isIpcError(result)) {
      status.textContent = `Couldn’t read notes: ${result.error}`;
      return;
    }
    saved = result.text;
    input.value = result.text;
    input.disabled = false;
    status.textContent = result.text ? 'Saved' : '';
    paintPrNotes(prs, result.prs);
    onLoaded?.(result.text);
  });

  return { element: root, flush: save };
}

// PR #12 from a GitHub or Azure DevOps url, else the url itself.
const prLabel = (url: string): string => {
  const number = /\/(?:pull|pullrequest)\/(\d+)/.exec(url)?.[1];
  const repo = /\/([^/]+)\/(?:pull|pullrequest)\//.exec(url)?.[1];
  return number && repo ? `${repo} PR ${number}` : url;
};

// Read-only: each PR with notes, and only the headers she filled in.
function paintPrNotes(box: HTMLElement, all: Record<string, PrNotes>): void {
  const filled = Object.entries(all).filter(([, notes]) => PR_NOTE_FIELDS.some((field) => notes[field].trim()));
  box.hidden = !filled.length;
  box.replaceChildren(el('h3', 'notes-prs-title', 'PR notes'), ...filled.map(([url, notes]) => {
    const pr = el('div', 'notes-pr');
    pr.append(el('p', 'notes-pr-name', prLabel(url)));
    for (const field of PR_NOTE_FIELDS) {
      if (notes[field].trim()) pr.append(el('p', 'notes-pr-field', `${PR_NOTE_LABELS[field]}: ${notes[field].trim()}`));
    }
    return pr;
  }));
}

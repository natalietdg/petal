// Her private notes for one Claude session: a calm textarea that saves itself, with a rendered view to read them back.
// Notes go to Petal's own folder through main; nothing here ever reaches the terminal or Claude.
import * as markdown from './markdown';
import { el, isIpcError } from './dom';

const SAVE_DELAY_MS = 600;

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
  element: el('p', 'status empty notes-empty', 'Notes belong to a Claude session. Start Claude in this tab and its notes show here.'),
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
  root.append(bar, ...(hint ? [el('p', 'notes-hint', hint)] : []), input, rendered);

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
  };

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
    onLoaded?.(result.text);
  });

  return { element: root, flush: save };
}

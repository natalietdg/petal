// Her notes on one PR under fixed headers, saved as she types. Each editor is built once per session and PR
// and reused, so a repaint while she types never takes her cursor away.
import { el, isIpcError } from './dom';
import { PR_NOTE_FIELDS, PR_NOTE_LABELS, emptyNotes, type PrNoteField, type PrNotes } from '../shared/session-prs';

const SAVE_DELAY_MS = 500;
const PLACEHOLDERS: Record<PrNoteField, string> = {
  risks: 'What could break, who to ping',
  env: 'Env vars, flags, secrets, migrations',
  checks: 'What to look at once it is live',
};

const editors = new Map<string, HTMLElement>(); // `${sessionId} ${url}`

function build(sessionId: string, url: string, saved: PrNotes): HTMLElement {
  const box = el('div', 'prs-notes');
  const status = el('span', 'prs-notes-status');
  status.setAttribute('aria-live', 'polite');
  const fields = new Map<PrNoteField, HTMLTextAreaElement>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = async (): Promise<void> => {
    clearTimeout(timer);
    timer = undefined;
    const notes = Object.fromEntries(PR_NOTE_FIELDS.map((field) => [field, fields.get(field)?.value ?? ''])) as PrNotes;
    const result = await window.pastel.prs.saveNotes({ sessionId, url, notes });
    status.textContent = isIpcError(result) ? result.error : 'note' in result ? result.note : 'Saved';
  };
  for (const field of PR_NOTE_FIELDS) {
    const id = `prs-note-${field}-${editors.size}`;
    const label = el('label', 'prs-notes-label', PR_NOTE_LABELS[field]);
    label.htmlFor = id;
    const input = el('textarea', 'prs-notes-input');
    Object.assign(input, { id, rows: 2, placeholder: PLACEHOLDERS[field], value: saved[field] });
    input.dataset.field = field;
    input.addEventListener('input', () => {
      status.textContent = '';
      clearTimeout(timer);
      timer = setTimeout(() => void save(), SAVE_DELAY_MS);
    });
    input.addEventListener('blur', () => { if (timer) void save(); });
    fields.set(field, input);
    box.append(label, input);
  }
  box.append(status);
  return box;
}

export function notesEditor(sessionId: string, url: string, saved: PrNotes | undefined): HTMLElement {
  const key = `${sessionId} ${url}`;
  let editor = editors.get(key);
  if (!editor) {
    editor = build(sessionId, url, saved ?? emptyNotes());
    editors.set(key, editor);
  }
  return editor;
}

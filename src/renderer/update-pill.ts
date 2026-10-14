// "Update ready · Restart" in the dock band, shown once an update has downloaded. Main refuses while Claude runs.
import { byId, isIpcError } from './dom';
import { UPDATE_PILL_TEXT } from '../shared/ipc';

const NOTE_MS = 6000;
const pill = byId<HTMLButtonElement>('update-pill');
let noteTimer: ReturnType<typeof setTimeout> | undefined;

export function show(): void {
  pill.textContent = UPDATE_PILL_TEXT;
  pill.title = UPDATE_PILL_TEXT; // minimised headers show the pill as a dot
  pill.hidden = false;
}

// A refusal shows in the pill for a few seconds, then the pill goes back to offering Restart.
function showNote(note: string): void {
  pill.textContent = note;
  pill.classList.add('noting');
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => {
    pill.classList.remove('noting');
    pill.textContent = UPDATE_PILL_TEXT;
  }, NOTE_MS);
}

export async function restart(): Promise<void> {
  const result = await window.pastel.update.restart();
  if (isIpcError(result)) showNote(`Couldn’t restart: ${result.error}`);
  else if ('note' in result) showNote(result.note);
}

export async function init(): Promise<void> {
  pill.addEventListener('click', () => restart());
  window.pastel.update.onReady(show);
  const status = await window.pastel.update.status();
  if (!isIpcError(status) && status.ready) show();
}

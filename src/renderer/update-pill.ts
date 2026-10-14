// The update pill in the dock band: "Petal X ready · Restart", the one-time "Updated to X · What's new",
// and what Petal › Check for Updates… found. Main refuses the restart while Claude runs.
import { byId, isIpcError } from './dom';
import { updateNoteText, updatePillText, whatsNewText, type UpdateNote, type WhatsNew } from '../shared/ipc';

const NOTE_MS = 6000;
const pill = byId<HTMLButtonElement>('update-pill');
let noteTimer: ReturnType<typeof setTimeout> | undefined;
let readyVersion: string | null = null;
let whatsNew: WhatsNew | null = null;

// What the pill offers when no note is showing; null hides it.
const offerText = (): string | null => (readyVersion ? updatePillText(readyVersion) : whatsNew ? whatsNewText(whatsNew) : null);

function showOffer(): void {
  clearTimeout(noteTimer);
  pill.classList.remove('noting');
  const text = offerText();
  pill.hidden = text === null;
  pill.textContent = text ?? '';
  pill.title = text ?? ''; // minimised headers show the pill as a dot
}

export function show(version: string): void {
  readyVersion = version;
  showOffer();
}

// "Checking…" and "Downloading…" stay until the outcome arrives; the rest fade back to the offer.
function showNote(text: string, sticky = false): void {
  clearTimeout(noteTimer);
  pill.textContent = text;
  pill.title = text;
  pill.classList.add('noting');
  pill.hidden = false;
  if (!sticky) noteTimer = setTimeout(showOffer, NOTE_MS);
}

export function note(update: UpdateNote): void {
  showNote(updateNoteText(update), update.kind === 'checking' || update.kind === 'downloading');
}

export async function restart(): Promise<void> {
  const result = await window.pastel.update.restart();
  if (isIpcError(result)) showNote(`Couldn’t restart: ${result.error}`);
  else if ('note' in result) showNote(result.note);
}

async function openWhatsNew(): Promise<void> {
  if (whatsNew?.hasNotes) await window.pastel.update.showWhatsNew();
  whatsNew = null;
  showOffer();
}

function onClick(): void {
  if (pill.classList.contains('noting') && !readyVersion) return;
  if (readyVersion) void restart();
  else if (whatsNew) void openWhatsNew();
}

export async function init(): Promise<void> {
  pill.addEventListener('click', onClick);
  window.pastel.update.onReady(({ version }) => show(version));
  window.pastel.update.onNote(note);
  const status = await window.pastel.update.status();
  if (isIpcError(status)) return;
  whatsNew = status.whatsNew;
  readyVersion = status.readyVersion ?? readyVersion;
  if (offerText()) showOffer();
}

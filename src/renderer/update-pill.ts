// The update pill in the dock band: "Petal X ready · Restart", the one-time "Updated to X · What's new",
// and what Petal › Check for Updates… found. Main refuses the restart while Claude runs.
import { byId, isIpcError } from './dom';
import * as dockFit from './dock-fit';
import { updateNoteText, updatePillForms, whatsNewForms, type UpdateNote, type WhatsNew } from '../shared/ipc';

const NOTE_MS = 6000;
const pill = byId<HTMLButtonElement>('update-pill');
let noteTimer: ReturnType<typeof setTimeout> | undefined;
let readyVersion: string | null = null;
let whatsNew: WhatsNew | null = null;
let forms: string[] = []; // longest first; forms[0] is the full text

// What the pill offers when no note is showing; empty hides it.
const offerForms = (): string[] => (readyVersion ? updatePillForms(readyVersion) : whatsNew ? whatsNewForms(whatsNew) : []);

// The longest form that keeps the dock one row; past the shortest, the minimised-headers dot. Title and label keep the full text.
dockFit.register({
  tryForms(fits) {
    pill.classList.remove('as-dot');
    if (pill.hidden || !forms.length) return fits();
    return forms.some((form) => {
      pill.textContent = form;
      return fits();
    });
  },
  squeeze() {
    if (!pill.hidden && !pill.classList.contains('noting')) pill.classList.add('as-dot');
  },
});

function setForms(next: string[]): void {
  forms = next;
  pill.hidden = !next.length;
  pill.title = next[0] ?? ''; // minimised headers show the pill as a dot
  if (next.length) pill.setAttribute('aria-label', next[0]);
  else pill.removeAttribute('aria-label');
  pill.textContent = next[0] ?? '';
  dockFit.fit();
}

function showOffer(): void {
  clearTimeout(noteTimer);
  pill.classList.remove('noting');
  setForms(offerForms());
}

export function show(version: string): void {
  readyVersion = version;
  showOffer();
}

// Back to no offer and no note: the snapshot's update step leaves the dock as it found it.
export function reset(): void {
  readyVersion = null;
  whatsNew = null;
  showOffer();
}

// "Checking…" and "Downloading…" stay until the outcome arrives; the rest fade back to the offer.
function showNote(text: string, sticky = false): void {
  clearTimeout(noteTimer);
  pill.classList.add('noting');
  setForms([text]);
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
  if (offerForms().length) showOffer();
}

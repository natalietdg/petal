// Add to Library: the session header's button that reads the shown tab's session now and adds its domain knowledge.
// Main looks the tab up and runs it through the Library's queue; the result shows under the header row, then fades.
import * as library from './library';
import { byId, el, isIpcError } from './dom';
import { addButtonState, addResultText } from '../shared/library';

const STATUS_MS = 6000; // a result stays this long, then fades
const FADE_MS = 400;

const button = byId<HTMLButtonElement>('library-add-session');
const status = byId('library-add-status');

let tabId: string | null = null;
let sessionId: string | null = null;
let folderAllowed = true;
let busyTab: string | null = null;
let statusTab: string | null = null; // the tab the shown status belongs to
let fadeTimer: ReturnType<typeof setTimeout> | undefined;

function paint(): void {
  const next = addButtonState({ sessionId, folderAllowed, busy: busyTab !== null && busyTab === tabId });
  button.hidden = next.hidden;
  button.disabled = next.disabled;
  button.title = next.title;
  button.setAttribute('aria-label', next.disabled && !next.hidden ? `Add to Library, off: ${next.title}` : 'Add to Library');
  if (statusTab !== tabId) status.hidden = true;
}

function showStatus(text: string, { fade }: { fade: boolean }): void {
  clearTimeout(fadeTimer);
  statusTab = tabId;
  const open = el('button', 'library-add-open', 'Open Library');
  open.type = 'button';
  open.addEventListener('click', () => void library.open());
  const line = el('span', null, text);
  line.title = text; // the full line, when a narrow header cuts it short
  status.replaceChildren(line, open);
  status.classList.remove('fading');
  status.hidden = false;
  if (!fade) return;
  fadeTimer = setTimeout(() => {
    status.classList.add('fading');
    fadeTimer = setTimeout(() => { status.hidden = true; status.classList.remove('fading'); }, FADE_MS);
  }, STATUS_MS);
}

button.addEventListener('click', async () => {
  const tab = tabId;
  if (!tab || button.disabled) return;
  busyTab = tab;
  paint();
  showStatus('Reading this session…', { fade: false });
  const result = await window.pastel.library.addSession(tab);
  busyTab = null;
  let text: string;
  if (isIpcError(result)) {
    console.error('[petal] library add failed:', result.error); // the raw error stays out of the page
    text = 'Couldn’t read this session. Try again after Claude’s next reply.';
  } else text = addResultText(result);
  if (tabId === tab) showStatus(text, { fade: true });
  paint();
});

// The reader follows the active tab; the button follows its Claude session.
// The last session a tab had is kept, so the button stays (and says why it is off) once the folder gate closes or Claude ends.
const sessionByTab = new Map<string, string>();
export function follow(nextTab: string, nextSession: string | null | undefined): void {
  tabId = nextTab;
  if (nextSession) sessionByTab.set(nextTab, nextSession);
  sessionId = nextSession ?? sessionByTab.get(nextTab) ?? null;
  paint();
}

export function setFolderAllowed(allowed: boolean): void {
  folderAllowed = allowed;
  paint();
}

export const state = () => ({ hidden: button.hidden, disabled: button.disabled, title: button.title, status: status.hidden ? '' : status.textContent ?? '' });

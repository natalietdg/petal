// Add to Library: the session header's button that reads the shown tab's session now and adds its domain knowledge.
// Main looks the tab up and runs it through the Library's queue; the result shows under the header row, then fades.
// Under it, a muted line says what a run would cost, or what this tab's last run used.
import * as library from './library';
import { byId, el, isIpcError } from './dom';
import { addButtonState, addCostText, addResultText } from '../shared/library';
import type { LastLibraryRun, TokenEstimate } from '../shared/library-cost';

const STATUS_MS = 6000; // a result stays this long, then fades
const FADE_MS = 400;
const ESTIMATE_STALE_MS = 60_000; // the log grows as she talks; recount at most this often while the tab is shown

const button = byId<HTMLButtonElement>('library-add-session');
const status = byId('library-add-status');
const cost = byId('library-add-cost');

let tabId: string | null = null;
let sessionId: string | null = null;
let folderAllowed = true;
let busyTab: string | null = null;
let statusTab: string | null = null; // the tab the shown status belongs to
let fadeTimer: ReturnType<typeof setTimeout> | undefined;
const estimates = new Map<string, { estimate: TokenEstimate | null; at: number }>(); // tab -> its last count, from main
const lastRuns = new Map<string, LastLibraryRun>(); // tab -> its last add, for the muted line
const counting = new Set<string>(); // tabs with a count in flight

function paint(): void {
  const next = addButtonState({ sessionId, folderAllowed, busy: busyTab !== null && busyTab === tabId });
  button.hidden = next.hidden;
  button.disabled = next.disabled;
  button.title = next.title;
  button.setAttribute('aria-label', next.disabled && !next.hidden ? `Add to Library, off: ${next.title}` : 'Add to Library');
  if (statusTab !== tabId) status.hidden = true;
  const text = tabId && !next.disabled ? addCostText(estimates.get(tabId)?.estimate ?? null, lastRuns.get(tabId) ?? null) : '';
  cost.textContent = text;
  cost.hidden = !text || !status.hidden; // the status line speaks for itself while it shows
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
  paint();
  if (!fade) return;
  fadeTimer = setTimeout(() => {
    status.classList.add('fading');
    fadeTimer = setTimeout(() => { status.hidden = true; status.classList.remove('fading'); paint(); }, FADE_MS);
  }, STATUS_MS);
}

// Counted in main from the log, before she clicks; no Claude call.
async function loadEstimate(): Promise<void> {
  const tab = tabId;
  if (!tab || button.disabled || counting.has(tab)) return;
  counting.add(tab);
  const result = await window.pastel.library.addEstimate(tab);
  counting.delete(tab);
  estimates.set(tab, { estimate: isIpcError(result) || 'skipped' in result ? null : result, at: Date.now() }); // a refusal waits out the same interval
  paint();
}
button.addEventListener('pointerenter', () => void loadEstimate());
button.addEventListener('focus', () => void loadEstimate());

const estimateStale = (tab: string): boolean => Date.now() - (estimates.get(tab)?.at ?? 0) > ESTIMATE_STALE_MS;

button.addEventListener('click', async () => {
  const tab = tabId;
  if (!tab || button.disabled) return;
  estimates.delete(tab); // what is left to read changes with this run
  busyTab = tab;
  paint();
  showStatus('Reading this session…', { fade: false });
  const result = await window.pastel.library.addSession(tab);
  busyTab = null;
  let text: string;
  if (isIpcError(result)) {
    console.error('[petal] library add failed:', result.error); // the raw error stays out of the page
    text = 'Couldn’t read this session. Try again after Claude’s next reply.';
  } else {
    text = addResultText(result);
    if (result.usage) lastRuns.set(tab, { at: new Date().toISOString(), kind: 'add', sessions: 1, usage: result.usage }); // as main records it
  }
  if (tabId === tab) showStatus(text, { fade: true });
  paint();
  if (tabId === tab) void loadEstimate();
});

// The reader follows the active tab; the button follows its Claude session.
// The last session a tab had is kept, so the button stays (and says why it is off) once the folder gate closes or Claude ends.
const sessionByTab = new Map<string, string>();
export function follow(nextTab: string, nextSession: string | null | undefined): void {
  tabId = nextTab;
  if (nextSession) sessionByTab.set(nextTab, nextSession);
  sessionId = nextSession ?? sessionByTab.get(nextTab) ?? null;
  paint();
  if (estimateStale(nextTab)) void loadEstimate();
}

export function setFolderAllowed(allowed: boolean): void {
  folderAllowed = allowed;
  paint();
  if (tabId && estimateStale(tabId)) void loadEstimate();
}

export const state = () => ({
  hidden: button.hidden, disabled: button.disabled, title: button.title, status: status.hidden ? '' : status.textContent ?? '',
  cost: cost.hidden ? '' : cost.textContent ?? '',
});

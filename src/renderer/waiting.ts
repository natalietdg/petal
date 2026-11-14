// Board's "Waiting on you" lane, read through the one shared needsYou() (shared/needs-you.ts).
// This window reports its tabs (screen prompt, open Decide) to main; main merges every window and headless child
// into one ranked lane, sends it back, sets the dock badge and notifies. The lane and the dock Board count draw it.
import * as overlays from './overlays';
import * as tabs from './tabs';
import * as reader from './reader';
import * as sessionsPanel from './sessions-panel';
import { byId, el, isIpcError } from './dom';
import { renderInline } from './markdown';
import { sinceText } from './sessions-panel';
import { sessionNameEl } from './session-name';
import { screenAsk, type ScreenAsk } from '../shared/prompt-answer';
import { laneItems, waitingItems } from '../shared/waiting';
import { badgeCount, type Need, type OpenDecide, type SessionSignals } from '../shared/needs-you';
import { childAgentId } from '../shared/subsessions';

const SCREEN_TICK_MS = 2000; // screens are only readable here, so this window watches its own
export const CHANGED_EVENT = 'petal:waiting-changed';

const badge = byId('board-button').querySelector<HTMLElement>('.dock-badge') ?? el('span', 'dock-badge');
const lane = el('section', 'waiting-lane');
lane.id = 'waiting';
lane.setAttribute('aria-label', 'Waiting on you');
const list = el('ul', 'waiting-list');
list.setAttribute('aria-label', 'Waiting on you');
lane.append(el('h3', 'waiting-title', 'Waiting on you'), list);
lane.hidden = true;

let needs: Need[] = [];
let shown = true; // Board's Sessions view; Activity and Code review hide the lane
let queued = false;
let reportedKey = '';
const askSeen = new Map<string, { ask: ScreenAsk; since: number }>(); // by tab: when its prompt first showed

// The lane element, placed by the Board above its cards.
export const element = (): HTMLElement => lane;
export const isOpen = (): boolean => overlays.isOpen('board');
export const shownItems = (): readonly Need[] => needs;
export const count = (): number => badgeCount(needs);
// The Board's card status reads this, so a card and the lane never disagree.
export const needOf = (sessionId: string): Need | undefined => needs.find((n) => n.sessionId === sessionId);

function openDecide(tabId: string, title: string, update: NonNullable<tabs.Tab['update']>): OpenDecide | null {
  const item = laneItems(waitingItems([{ tabId, title, replies: update.replies, waiting: update.waiting }]))[0];
  return item ? { text: item.text, replyId: item.replyId, at: item.at } : null;
}

// One signal per tab with a Claude session; children are added by main, which sees them.
function signals(now = Date.now()): SessionSignals[] {
  return tabs.ids().flatMap((tabId): SessionSignals[] => {
    const tab = tabs.get(tabId);
    const update = tab?.update;
    if (!tab || !update?.sessionId) { askSeen.delete(tabId); return []; }
    const ask = update.state === 'live' ? screenAsk(tabs.screenLines(tab)) : null;
    const seen = askSeen.get(tabId);
    if (!ask) askSeen.delete(tabId);
    else if (seen?.ask !== ask) askSeen.set(tabId, { ask, since: now });
    return [{
      sessionId: update.sessionId,
      tabId,
      windowId: null, // main stamps the window
      title: update.label,
      ask,
      askSince: ask ? askSeen.get(tabId)?.since ?? now : null,
      decide: openDecide(tabId, update.label, update),
      children: [],
    }];
  });
}

// Sends only when something changed; main answers with the merged lane.
export function refresh(): void {
  const next = signals();
  const key = JSON.stringify(next);
  if (key === reportedKey) return;
  reportedKey = key;
  window.pastel.waiting.report(next);
}

// A session in this window: its tab (and reply, or the child's agent panel). Elsewhere: History's resume, which focuses its window.
export async function openNeed(need: Need): Promise<void> {
  close();
  if (need.here && need.tabId && tabs.get(need.tabId)) {
    tabs.activate(need.tabId);
    const { replyId, childSessionId } = need;
    if (childSessionId) sessionsPanel.openAgentFor(need.sessionId, childAgentId(childSessionId));
    else if (replyId) setTimeout(() => reader.showReply([replyId]), 0); // after the tab's replies are on screen
    return;
  }
  if (need.childSessionId && !need.tabId) {
    sessionsPanel.openAgentFor(need.sessionId, childAgentId(need.childSessionId)); // a parent outside Petal: its child still opens
    return;
  }
  const result = await window.pastel.history.resume(need.sessionId, false);
  if (isIpcError(result)) console.error('[petal] could not open the waiting session:', result.error);
}

function row(need: Need): HTMLLIElement {
  const li = el('li', `waiting-row waiting-row-waiting waiting-${need.kind}`);
  li.tabIndex = 0;
  li.setAttribute('role', 'button');
  if (need.tabId) li.dataset.tabId = need.tabId;
  li.dataset.sessionId = need.sessionId;
  li.addEventListener('click', (event) => { if (!(event.target as Element).closest('a[href]')) void openNeed(need); });
  li.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    void openNeed(need);
  });
  const text = el('div', 'waiting-text');
  if (need.text) {
    text.innerHTML = renderInline(need.text);
    for (const img of text.querySelectorAll('img')) img.replaceWith(img.alt); // never loads a raw src
  } else text.textContent = need.reason;
  const meta = el('p', 'waiting-meta');
  meta.append(sessionNameEl('span', 'waiting-session', need.title));
  if (!need.here) meta.append(el('span', 'waiting-where', 'other window'));
  const ago = sinceText(need.since);
  if (ago) meta.append(el('span', 'waiting-ago', ago));
  li.append(text, meta);
  return li;
}

function renderLane(): void {
  lane.hidden = !shown || !needs.length;
  list.replaceChildren(...needs.map(row));
}

function renderBadge(): void {
  const n = count();
  badge.textContent = n ? String(n) : '';
  badge.hidden = !n;
  badge.title = n ? `${n} waiting on you` : '';
}

// Board's Sessions view shows the lane; its other views hide it.
export function setShown(on: boolean): void {
  shown = on;
  renderLane();
}

// One report per burst of updates, after app.ts has stored them on their tabs.
function schedule(): void {
  if (queued) return;
  queued = true;
  setTimeout(() => {
    queued = false;
    refresh();
  }, 0);
}

// Waiting now lives on the Board: open and close are the Board's.
export const open = (): void => { window.dispatchEvent(new Event('petal:open-board')); };
export const close = (): void => overlays.hide('board');
export const toggle = (): void => (isOpen() ? close() : open());

window.pastel.waiting.onLane((next) => {
  needs = next;
  renderBadge();
  if (isOpen()) renderLane();
  window.dispatchEvent(new Event(CHANGED_EVENT));
});
window.pastel.waiting.onOpen((need) => void openNeed({ ...need, here: true }));
window.pastel.onReplies(schedule);
window.pastel.onTabLabel(schedule);
window.pastel.onTabClosed(schedule);
setInterval(refresh, SCREEN_TICK_MS); // a prompt appearing or leaving the screen
schedule();

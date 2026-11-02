// Waiting inbox: every open tab's open Decide and running Doing line, from the replies each tab already holds.
// The count follows reply updates; the open panel also redraws on a slow tick so "5m ago" stays true.
import * as overlays from './overlays';
import * as tabs from './tabs';
import * as reader from './reader';
import { byId, el } from './dom';
import { renderInline } from './markdown';
import { sinceText } from './sessions-panel';
import { sessionNameEl } from './session-name';
import { waitingCount, waitingItems, type WaitingItem, type WaitingSource } from '../shared/waiting';

const TICK_MS = 5000;
const PILL_CLASS = { 'In progress': 'progress', 'Waiting on you': 'waiting' } as const;

const view = byId('waiting');
const button = byId('waiting-button');
const buttonLabel = button.querySelector('.dock-label') ?? button;
const summary = el('p', 'waiting-summary');
const list = el('ul', 'waiting-list');
list.setAttribute('aria-label', 'Waiting on you');
const head = el('header', 'waiting-head');
head.append(el('h2', 'waiting-title', 'Waiting'), summary);
view.tabIndex = -1; // focusable, so Esc reaches the overlay with no row to focus
view.append(head, list);

let items: WaitingItem[] = [];
let queued = false;
let ticker: ReturnType<typeof setInterval> | undefined;

export const isOpen = (): boolean => overlays.isOpen('waiting');
export const shownItems = (): readonly WaitingItem[] => items;

function sources(): WaitingSource[] {
  return tabs.ids().flatMap((tabId) => {
    const update = tabs.get(tabId)?.update;
    return update ? [{ tabId, title: update.label, replies: update.replies, waiting: update.waiting }] : [];
  });
}

function jump(item: WaitingItem): void {
  close();
  tabs.activate(item.tabId);
  const { replyId } = item;
  if (replyId) setTimeout(() => reader.showReply([replyId]), 0); // after the tab's replies are on screen
}

function row(item: WaitingItem): HTMLLIElement {
  const li = el('li', `waiting-row waiting-row-${PILL_CLASS[item.pill]}`);
  li.tabIndex = 0;
  li.setAttribute('role', 'button');
  li.dataset.tabId = item.tabId;
  li.addEventListener('click', (event) => { if (!(event.target as Element).closest('a[href]')) jump(item); });
  li.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    jump(item);
  });
  const text = el('div', 'waiting-text');
  text.innerHTML = renderInline(item.text);
  for (const img of text.querySelectorAll('img')) img.replaceWith(img.alt); // never loads a raw src
  const meta = el('p', 'waiting-meta');
  meta.append(sessionNameEl('span', 'waiting-session', item.title));
  const ago = sinceText(item.at);
  if (ago) meta.append(el('span', 'waiting-ago', ago));
  li.append(el('span', `waiting-pill waiting-pill-${PILL_CLASS[item.pill]}`, item.pill), text, meta);
  return li;
}

function renderList(): void {
  const asks = waitingCount(items);
  const running = items.length - asks;
  summary.textContent = items.length ? `${asks} waiting on you · ${running} in progress` : '';
  list.replaceChildren(...items.map(row));
  if (!items.length) list.append(el('li', 'waiting-empty', 'Nothing waiting on you.'));
}

export function refresh(): void {
  items = waitingItems(sources());
  const count = waitingCount(items);
  buttonLabel.textContent = count ? `Waiting (${count})` : 'Waiting';
  button.classList.toggle('has-waiting', count > 0);
  if (isOpen()) renderList();
}

// One refresh per burst of updates, after app.ts has stored them on their tabs.
function schedule(): void {
  if (queued) return;
  queued = true;
  setTimeout(() => {
    queued = false;
    refresh();
  }, 0);
}

export function open(): void {
  if (!overlays.show('waiting')) return;
  refresh();
  renderList();
  clearInterval(ticker);
  ticker = setInterval(() => { if (isOpen()) refresh(); else clearInterval(ticker); }, TICK_MS);
  (list.querySelector<HTMLElement>('.waiting-row') ?? view).focus();
}

export function close(): void {
  overlays.hide('waiting');
  clearInterval(ticker);
}

export const toggle = (): void => (isOpen() ? close() : open());

window.pastel.onReplies(schedule);
window.pastel.onTabLabel(schedule);
window.pastel.onTabClosed(schedule);
button.addEventListener('click', toggle);

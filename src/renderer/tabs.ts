// Session tabs: each tab owns one xterm and one pty in main; only the active one is shown.
import * as terminal from './terminal';
import { toXterm } from './theme';
import * as pendingEcho from './pending-echo';
import { byId, el, query } from './dom';
import { setSessionName } from './session-name';
import { NO_SESSION_LABEL } from '../shared/session-label';
import type { Terminal } from '@xterm/xterm';
import type { TabId, TabReaderUpdate, Theme } from '../shared/types';

export interface Tab {
  id: TabId;
  host: HTMLDivElement;
  term: Terminal;
  renderer: terminal.RendererKind;
  refit: () => void;
  element: HTMLDivElement;
  update: TabReaderUpdate | null;
  pending: pendingEcho.PendingEcho[]; // reply-box sends not yet in Claude's log
}

interface Hooks {
  onNewTab: () => void; // the + button
  onActivate: (tab: Tab) => void;
  onCreated: (tab: Tab) => void;
  onScreen: (tab: Tab) => void;
}

const strip = byId('tab-strip');
const stage = byId('terminal');
const tabs = new Map<TabId, Tab>();
let activeId: TabId | null = null;
let nextNumber = 1;
let theme: Theme | null = null;
let hooks: Hooks = { onNewTab: () => create(), onActivate: () => {}, onCreated: () => {}, onScreen: () => {} };

const newTabButton = el('button', 'tab-new', '+');
newTabButton.type = 'button';
newTabButton.title = 'New tab (⌘T)';
newTabButton.addEventListener('click', () => hooks.onNewTab());
strip.append(newTabButton);

function tabElement(id: TabId): HTMLDivElement {
  const element = el('div', 'tab');
  element.setAttribute('role', 'tab');
  element.dataset.tabId = id;
  const close = el('button', 'tab-close', '×');
  close.type = 'button';
  close.title = 'Close tab (⌘W)';
  close.addEventListener('click', (event) => { event.stopPropagation(); requestClose(id); });
  element.append(el('span', 'tab-dot'), el('span', 'tab-label', NO_SESSION_LABEL), close);
  element.addEventListener('click', () => activate(id));
  return element;
}

export function init(options: { theme: Theme } & Partial<Hooks>): void {
  theme = options.theme;
  hooks = { ...hooks, ...options };
}

// Shown before its shell starts, so the pty is spawned at the visible grid size.
// A background tab (a reply from History) starts unshown at the default grid; activating it refits.
// startClaude: main types `claude` once the shell is ready, if Claude Code is installed.
export function create({ background = false, startClaude = false }: { background?: boolean; startClaude?: boolean } = {}): Tab {
  if (!theme) throw new Error('tabs.init() must run before the first tab');
  const id = `t${nextNumber++}`;
  const host = el('div', 'term-host');
  stage.append(host);
  const { term, renderer, refit } = terminal.create(host, theme, id);
  const tab: Tab = { id, host, term, renderer, refit, element: tabElement(id), update: null, pending: [] };
  strip.insertBefore(tab.element, newTabButton);
  tabs.set(id, tab);
  term.onWriteParsed(() => hooks.onScreen(tab));
  hooks.onCreated(tab);
  if (background) {
    host.hidden = true;
    tab.element.setAttribute('aria-selected', 'false');
  } else {
    activate(id);
  }
  window.pastel.startShell(id, { cols: term.cols, rows: term.rows }, startClaude);
  return tab;
}

export function activate(id: TabId): void {
  const tab = tabs.get(id);
  if (!tab) return;
  activeId = id;
  for (const other of tabs.values()) {
    other.host.hidden = other !== tab;
    other.element.setAttribute('aria-selected', String(other === tab));
  }
  tab.refit();
  tab.element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  window.pastel.activateTab(id);
  hooks.onActivate(tab);
  tab.term.focus();
}

export function cycle(delta: number): void {
  const ids = [...tabs.keys()];
  if (ids.length < 2 || activeId === null) return;
  const next = ids[(ids.indexOf(activeId) + delta + ids.length) % ids.length];
  if (next) activate(next);
}

// Main kills the pty; its exit comes back as tab:closed, which calls remove().
export const requestClose = (id: TabId | undefined): void => { if (id && tabs.has(id)) window.pastel.closeShell(id); };

export function remove(id: TabId): void {
  const tab = tabs.get(id);
  if (!tab) return;
  const ids = [...tabs.keys()];
  const index = ids.indexOf(id);
  clearTimeout(staleTimers.get(id));
  staleTimers.delete(id);
  tab.term.dispose();
  tab.host.remove();
  tab.element.remove();
  tabs.delete(id);
  const neighbour = ids[index + 1] ?? ids[index - 1];
  if (id === activeId && tabs.size && neighbour) activate(neighbour);
}

// A reply-box echo a picker swallowed must still go once it is stale, though no update may come to drop it.
const staleTimers = new Map<TabId, ReturnType<typeof setTimeout>>();
function watchStale(tab: Tab): void {
  clearTimeout(staleTimers.get(tab.id));
  staleTimers.delete(tab.id);
  const wait = pendingEcho.untilStale(tab.pending);
  if (wait === null) return;
  staleTimers.set(tab.id, setTimeout(() => {
    staleTimers.delete(tab.id);
    if (!tab.update || !tabs.has(tab.id)) return;
    const before = tab.pending.length;
    tab.pending = pendingEcho.reconcile(tab.pending, tab.update);
    if (tab.pending.length !== before) window.dispatchEvent(new CustomEvent('petal:reader-refresh', { detail: tab.id }));
    watchStale(tab);
  }, wait));
}

export function setUpdate(id: TabId, update: TabReaderUpdate): void {
  const tab = tabs.get(id);
  if (!tab) return;
  tab.update = update;
  tab.pending = pendingEcho.reconcile(tab.pending, update);
  watchStale(tab);
  tab.element.classList.toggle('busy', Boolean(update.busy));
  showLabel(tab, update.label);
}

// The session's shared name on the tab; the whole tab hovers with the full title.
function showLabel(tab: Tab, label: string): void {
  setSessionName(query(tab.element, '.tab-label'), label);
  tab.element.title = label;
}

// A title that landed after the last reader update (the organizer named it, Claude Code titled it).
export function setLabel(id: TabId, label: string): void {
  const tab = tabs.get(id);
  if (!tab?.update) return;
  tab.update = { ...tab.update, label };
  showLabel(tab, label);
}

export function applyTheme(next: Theme): void {
  theme = next;
  for (const tab of tabs.values()) tab.term.options.theme = toXterm(next);
}

window.pastel.onData(({ tabId, data }) => tabs.get(tabId)?.term.write(data));

// A tall picker scrolls its top into scrollback in a short pane, so read the buffer's tail, not just the visible rows.
const SCREEN_TAIL_LINES = 60;
export function screenLines(tab: Tab): string[] {
  const buffer = tab.term.buffer.active;
  const end = buffer.baseY + tab.term.rows;
  const start = Math.max(0, end - Math.max(SCREEN_TAIL_LINES, tab.term.rows));
  return Array.from({ length: end - start }, (_, i) => buffer.getLine(start + i)?.translateToString(true) ?? '');
}

// Shown in the reader at once; returns its key so a failed send can take it back.
export function addPending(tab: Tab, text: string): number | null {
  if (!tab.update || !pendingEcho.echoes(text)) return null;
  tab.pending = pendingEcho.add(tab.pending, text, tab.update);
  watchStale(tab);
  return tab.pending.at(-1)?.key ?? null;
}

export function removePending(tab: Tab, key: number): void {
  tab.pending = pendingEcho.remove(tab.pending, key);
}

export const active = (): Tab | null => (activeId === null ? null : tabs.get(activeId) ?? null);
export const get = (id: TabId): Tab | null => tabs.get(id) ?? null;
export const ids = (): TabId[] => [...tabs.keys()];

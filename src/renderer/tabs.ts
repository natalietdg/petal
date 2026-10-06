// Session tabs: each tab owns one xterm and one pty in main; only the active one is shown.
import * as terminal from './terminal';
import { toXterm } from './theme';
import { byId, el, query } from './dom';
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
}

interface Hooks {
  onActivate: (tab: Tab) => void;
  onCreated: (tab: Tab) => void;
}

const strip = byId('tab-strip');
const stage = byId('terminal');
const tabs = new Map<TabId, Tab>();
let activeId: TabId | null = null;
let nextNumber = 1;
let theme: Theme | null = null;
let hooks: Hooks = { onActivate: () => {}, onCreated: () => {} };

const newTabButton = el('button', 'tab-new', '+');
newTabButton.type = 'button';
newTabButton.title = 'New tab (⌘T)';
newTabButton.addEventListener('click', () => create());
strip.append(newTabButton);

function tabElement(id: TabId): HTMLDivElement {
  const element = el('div', 'tab');
  element.setAttribute('role', 'tab');
  element.dataset.tabId = id;
  const close = el('button', 'tab-close', '×');
  close.type = 'button';
  close.title = 'Close tab (⌘W)';
  close.addEventListener('click', (event) => { event.stopPropagation(); requestClose(id); });
  element.append(el('span', 'tab-dot'), el('span', 'tab-label', 'Shell'), close);
  element.addEventListener('click', () => activate(id));
  return element;
}

export function init(options: { theme: Theme } & Partial<Hooks>): void {
  theme = options.theme;
  hooks = { ...hooks, ...options };
}

// Shown before its shell starts, so the pty is spawned at the visible grid size.
export function create(): Tab {
  if (!theme) throw new Error('tabs.init() must run before the first tab');
  const id = `t${nextNumber++}`;
  const host = el('div', 'term-host');
  stage.append(host);
  const { term, renderer, refit } = terminal.create(host, theme, id);
  const tab: Tab = { id, host, term, renderer, refit, element: tabElement(id), update: null };
  strip.insertBefore(tab.element, newTabButton);
  tabs.set(id, tab);
  hooks.onCreated(tab);
  activate(id);
  window.pastel.startShell(id, { cols: term.cols, rows: term.rows });
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
  tab.term.dispose();
  tab.host.remove();
  tab.element.remove();
  tabs.delete(id);
  const neighbour = ids[index + 1] ?? ids[index - 1];
  if (id === activeId && tabs.size && neighbour) activate(neighbour);
}

export function setUpdate(id: TabId, update: TabReaderUpdate): void {
  const tab = tabs.get(id);
  if (!tab) return;
  tab.update = update;
  tab.element.classList.toggle('busy', Boolean(update.busy));
  query(tab.element, '.tab-label').textContent = update.label;
  tab.element.title = update.label;
}

export function applyTheme(next: Theme): void {
  theme = next;
  for (const tab of tabs.values()) tab.term.options.theme = toXterm(next);
}

window.pastel.onData(({ tabId, data }) => tabs.get(tabId)?.term.write(data));

export const active = (): Tab | null => (activeId === null ? null : tabs.get(activeId) ?? null);
export const get = (id: TabId): Tab | null => tabs.get(id) ?? null;
export const ids = (): TabId[] => [...tabs.keys()];

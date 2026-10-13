// Open Repo (⌘O): a palette over the reader that fuzzy-finds a git repo in her home folder and cd's the tab into it.
// Main does the typing; when Claude is running in the tab, main opens a new tab for it instead.
import * as overlays from './overlays';
import * as tabs from './tabs';
import { byId, el, isIpcError } from './dom';
import { matchesAnyName, rankRepos } from '../shared/repo-match';
import type { ReposList } from '../shared/ipc';
import type { TabId } from '../shared/types';

type Repo = ReposList['repos'][number];

const MAX_ROWS = 50;
const RESCAN_POLL_MS = 1500;

const view = byId('repos');
const card = el('div', 'repos-card');
const search = el('input', 'repos-search');
search.type = 'text';
search.placeholder = 'Open a repo…';
search.setAttribute('aria-label', 'Search repos');
search.spellcheck = false;
const hint = el('p', 'repos-hint');
const list = el('div', 'repos-list');
list.setAttribute('role', 'listbox');
const status = el('p', 'repos-status');
card.append(search, hint, list, status);
view.append(card);

let repos: Repo[] = [];
let shown: Repo[] = [];
let selected = 0;
let tabId: TabId | null = null;
let pollTimer: ReturnType<typeof setTimeout> | undefined;

export const isOpen = (): boolean => overlays.isOpen('repos');

function row(repo: Repo, index: number): HTMLButtonElement {
  const button = el('button', 'repos-row');
  button.type = 'button';
  button.setAttribute('role', 'option');
  button.setAttribute('aria-selected', String(index === selected));
  const head = el('span', 'repos-row-head');
  head.append(el('span', 'repos-name', repo.name));
  if (repo.branch) head.append(el('span', 'repos-branch', repo.branch));
  button.append(head, el('span', 'repos-path', repo.shortPath));
  button.addEventListener('mousemove', () => { if (selected !== index) { selected = index; render(); } });
  button.addEventListener('click', () => choose(repo));
  return button;
}

function render(): void {
  shown = rankRepos(search.value, repos).slice(0, MAX_ROWS);
  selected = Math.min(selected, Math.max(shown.length - 1, 0));
  list.replaceChildren(...shown.map(row));
  list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
}

function describe(result: ReposList): string {
  if (!result.repos.length) return result.scanning ? 'Looking for repos in your home folder…' : 'No git repos found in your home folder.';
  const count = `${result.repos.length} repo${result.repos.length === 1 ? '' : 's'}`;
  return result.scanning ? `${count} · rescanning…` : count;
}

async function load(): Promise<void> {
  clearTimeout(pollTimer);
  if (!tabId) return;
  const result = await window.pastel.repos.list(tabId);
  if (!isOpen()) return;
  if (isIpcError(result)) {
    status.textContent = `Couldn’t list repos: ${result.error}`;
    return;
  }
  repos = result.repos;
  hint.textContent = result.claudeLive ? 'Claude is running in this tab, so the repo opens in a new tab.' : 'Enter switches this tab’s shell into the repo.';
  hint.classList.toggle('new-tab', result.claudeLive);
  status.textContent = describe(result);
  render();
  if (result.scanning) pollTimer = setTimeout(load, RESCAN_POLL_MS);
}

async function choose(repo: Repo | undefined): Promise<void> {
  if (!repo || !tabId) return;
  const result = await window.pastel.repos.open(tabId, repo.path);
  if (isIpcError(result)) status.textContent = `Couldn’t open it: ${result.error}`;
  else if ('note' in result) status.textContent = result.note;
  else close();
}

export function open(query = ''): void {
  tabId = tabs.active()?.id ?? null;
  if (!overlays.show('repos')) return;
  search.value = query;
  selected = 0;
  status.textContent = '';
  render();
  search.focus();
  search.select();
  void load();
}

export function close(): void {
  clearTimeout(pollTimer);
  overlays.hide('repos');
}

export const toggle = (): void => (isOpen() ? close() : open());

// The reply box's `checkout <name>`: only a name some repo actually matches opens the palette.
export async function offers(forTab: TabId, query: string): Promise<boolean> {
  const result = await window.pastel.repos.list(forTab);
  if (isIpcError(result)) return false;
  repos = result.repos;
  return matchesAnyName(query, repos);
}

search.addEventListener('input', () => { selected = 0; render(); });
search.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? 1 : -1;
    selected = Math.max(0, Math.min(shown.length - 1, selected + step));
    render();
  } else if (event.key === 'Enter' && !event.isComposing) {
    event.preventDefault();
    void choose(shown[selected]);
  }
});

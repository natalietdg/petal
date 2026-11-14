// Open Repo (⌘O): a palette over the reader that fuzzy-finds a git repo in her home folder and cd's the tab into it.
// Main does the typing; when Claude is running in the tab, main opens a new tab for it instead.
// Add Session opens the same palette in session mode: Enter starts a new claude in a new tab in the chosen folder.
// Both modes show the same search, rows and footer; only the hint line, Start as and what Enter does differ.
import * as overlays from './overlays';
import * as tabs from './tabs';
import { byId, el, isIpcError } from './dom';
import { matchesAnyName, rankRepos } from '../shared/repo-match';
import type { ReposList, RepoStartTarget } from '../shared/ipc';
import type { TabId } from '../shared/types';

type Repo = ReposList['repos'][number];
// Two rows under the repos in both modes: home, and a folder chosen in a dialog.
interface Extra { kind: 'home' | 'pick'; name: string; shortPath: string; branch: null }
type Row = Repo | Extra;
const EXTRAS: Extra[] = [
  { kind: 'home', name: 'Home folder', shortPath: '~', branch: null },
  { kind: 'pick', name: 'Other folder…', shortPath: 'choose in Finder', branch: null },
];
type Mode = 'open' | 'session';

const MAX_ROWS = 50;
const RESCAN_POLL_MS = 1500;

const view = byId('repos');
const card = el('div', 'repos-card');
const search = el('input', 'repos-search');
search.type = 'text';
search.placeholder = 'Find a repo or folder…';
search.setAttribute('aria-label', 'Search repos');
search.spellcheck = false;
const hint = el('p', 'repos-hint');
// Session mode only: plain Claude, or one of her agents in ~/.claude/agents (claude --agent <name>).
const startAs = el('label', 'repos-start-as');
const agentPick = el('select', 'repos-agent');
startAs.append(el('span', null, 'Start as'), agentPick);
startAs.hidden = true;
const list = el('div', 'repos-list');
list.setAttribute('role', 'listbox');
const status = el('p', 'repos-status');
card.append(search, startAs, hint, list, status);
view.append(card);

let repos: Repo[] = [];
let shown: Row[] = [];
let mode: Mode = 'open';
let selected = 0;
let tabId: TabId | null = null;
let pollTimer: ReturnType<typeof setTimeout> | undefined;

export const isOpen = (): boolean => overlays.isOpen('repos');
export const isPickingSessionFolder = (): boolean => isOpen() && mode === 'session';

function row(repo: Row, index: number): HTMLButtonElement {
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
  shown = [...rankRepos(search.value, repos).slice(0, MAX_ROWS), ...EXTRAS];
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
  hint.textContent = mode === 'session' ? SESSION_HINT : result.claudeLive ? 'Claude is running in this tab, so the folder opens in a new tab.' : 'Enter switches this tab’s shell into that folder.';
  hint.classList.toggle('new-tab', mode === 'session' || result.claudeLive);
  status.textContent = describe(result);
  render();
  if (result.scanning) pollTimer = setTimeout(load, RESCAN_POLL_MS);
}

const targetOf = (row: Row): RepoStartTarget => ('kind' in row ? { kind: row.kind } : { kind: 'repo', path: row.path });

async function choose(row: Row | undefined): Promise<void> {
  if (!row || !tabId) return;
  const target = targetOf(row);
  const result = mode === 'session' ? await window.pastel.repos.start(tabId, target, agentPick.value || null) : await window.pastel.repos.open(tabId, target);
  if (isIpcError(result)) status.textContent = `Couldn’t open it: ${result.error}`;
  else if ('note' in result) status.textContent = result.note;
  else close();
}

const SESSION_HINT = 'Enter starts Claude in a new tab, in that folder.';

// Lists her agents each time the palette opens, so a file added a minute ago is there.
async function loadAgents(): Promise<void> {
  const agents = await window.pastel.repos.agents();
  const options = [el('option', null, 'Claude')];
  options[0].value = '';
  if (!isIpcError(agents)) for (const agent of agents) {
    const option = el('option', null, agent.description ? `${agent.name} · ${agent.description}` : agent.name);
    option.value = agent.name;
    options.push(option);
  }
  agentPick.replaceChildren(...options);
  startAs.hidden = mode !== 'session' || options.length === 1;
}

export function open(query = '', nextMode: Mode = 'open'): void {
  mode = nextMode;
  tabId = tabs.active()?.id ?? null;
  if (!overlays.show('repos')) return;
  search.value = query;
  selected = 0;
  status.textContent = '';
  hint.textContent = mode === 'session' ? SESSION_HINT : ''; // session mode's hint does not wait on the list
  startAs.hidden = true;
  if (mode === 'session') void loadAgents();
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

// Add Session: she picks the folder every time, so no session is born in home by accident.
export const openForNewSession = (): void => open('', 'session');

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

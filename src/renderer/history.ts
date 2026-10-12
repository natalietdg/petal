// History: this past week's Claude sessions. Replaces the reader while open; Esc or Cmd+Y goes back.
// The list and preview live in history-*.ts; this is the overlay shell that opens, refreshes and wires them.
import * as overlays from './overlays';
import { hooks, list, listTabs, search, sortToggle, state, view, type PreviewMode, type SortBy } from './history-state';
import { renderList } from './history-list';
import { renderPreview, repaintConclusion, repaintTitle } from './history-preview';
import * as reply from './history-reply';
import * as favorites from './favorites';
import type { HistoryListKind } from '../shared/favorites';
import { byId, el, isIpcError } from './dom';

export type { PreviewMode } from './history-state';

const button = byId('history-button');

export function select(sessionId: string): void {
  if (sessionId !== state.selectedId) state.previewMode = 'replies';
  state.selectedId = sessionId;
  renderList();
  renderPreview();
}

async function refresh(): Promise<void> {
  const result = await window.pastel.history.list();
  if ('error' in result) {
    list.replaceChildren(el('p', 'history-error', `Couldn’t list sessions: ${result.error}`));
    return;
  }
  state.sessions = result.sessions;
  if (!state.sessions.some((s) => s.sessionId === state.selectedId)) state.selectedId = state.sessions[0]?.sessionId ?? null;
  renderList();
}

function setSort(sort: SortBy): void {
  state.sort = sort;
  for (const b of sortToggle.querySelectorAll<HTMLButtonElement>('button')) b.setAttribute('aria-selected', String(b.dataset.sort === sort));
  renderList();
}

export async function open(): Promise<void> {
  overlays.show('history');
  await refresh();
  renderPreview();
  search.focus();
}

export const close = (): void => overlays.hide('history');
export const isOpen = (): boolean => overlays.isOpen('history');
export const toggle = (): Promise<void> | void => (isOpen() ? close() : open());

// All or Favorites: same rows, sort and preview; only which sessions are listed changes.
function setListKind(kind: HistoryListKind): void {
  state.listKind = kind;
  for (const b of listTabs.querySelectorAll<HTMLButtonElement>('button')) b.setAttribute('aria-selected', String(b.dataset.list === kind));
  renderList();
}
listTabs.addEventListener('click', (event) => {
  const kind = (event.target as HTMLElement).closest<HTMLElement>('[data-list]')?.dataset.list;
  if (kind === 'all' || kind === 'favorites') setListKind(kind);
});
favorites.onChange(() => { if (isOpen()) renderList(); });

button.addEventListener('click', toggle);
search.addEventListener('input', renderList);
sortToggle.addEventListener('click', (event) => {
  const sort = (event.target as HTMLElement).dataset.sort;
  if (sort === 'recent' || sort === 'title') setSort(sort);
});

// The list folds to a slim rail so the preview gets the full width; remembered in Petal's config.
function setListCollapsed(collapsed: boolean, persist = true): void {
  view.classList.toggle('list-collapsed', collapsed);
  if (persist) void window.pastel.config.save({ history: { listCollapsed: collapsed } });
}
for (const toggleButton of view.querySelectorAll('.history-list-toggle')) {
  toggleButton.addEventListener('click', () => setListCollapsed(!view.classList.contains('list-collapsed')));
}
window.addEventListener('keydown', (event) => {
  if (!isOpen() || !event.metaKey || event.key !== '\\') return;
  event.preventDefault();
  setListCollapsed(!view.classList.contains('list-collapsed'));
});
void window.pastel.config.get().then((result) => {
  if (!isIpcError(result)) setListCollapsed(result.config.history.listCollapsed, false);
});
window.pastel.onToggleHistory(toggle);
window.pastel.onConclusionsChanged(() => { if (isOpen()) void refresh().then(repaintConclusion); });
window.pastel.onSessionTitles(() => { if (isOpen()) void refresh().then(repaintTitle); }); // a tab's session got its title: History says the same

export const rerender = (): void => { if (isOpen()) renderPreview(); };
export function setPreviewMode(mode: PreviewMode): Promise<void> {
  state.previewMode = mode;
  return renderPreview();
}

// Tabs answering for a session shown here: app.ts reports their updates, screens and closing.
export { adoptTab, tabUpdated, tabClosed } from './history-reply';
const SCREEN_SETTLE_MS = 120;
let screenTimer: ReturnType<typeof setTimeout> | undefined;
export function tabScreen(tabId: string): void {
  if (!isOpen()) return;
  clearTimeout(screenTimer);
  screenTimer = setTimeout(() => reply.hooks.repaint(tabId), SCREEN_SETTLE_MS);
}

hooks.renderList = renderList;
hooks.close = close;

// History's shared state and page skeleton. The list and preview modules render into these elements;
// the shell (history.ts) wires `hooks` so they can reach it without importing it.
import { byId, query } from './dom';
import { sessionTitle } from '../shared/session-label';
import type { HistoryList } from '../shared/ipc';
import type { HistoryListKind } from '../shared/favorites';

export type Session = HistoryList['sessions'][number];
export type PreviewMode = 'replies' | 'flow' | 'decisions';
export type SortBy = 'recent' | 'title';

export const state = {
  sessions: [] as Session[],
  selectedId: null as string | null,
  previewMode: 'replies' as PreviewMode,
  sort: 'recent' as SortBy,
  listKind: 'all' as HistoryListKind,
};

export const hooks = {
  renderList: (): void => {},
  close: (): void => {},
};

export const view = byId('history');
view.innerHTML = `
  <div class="history-list-pane">
    <div class="history-rail">
      <button class="history-list-toggle" type="button" aria-expanded="false" aria-label="Show the session list" title="Show the list (⌘\\)">›</button>
      <span class="history-rail-title"></span>
    </div>
    <div id="history-tabs" class="view-toggle history-tabs" role="tablist" aria-label="Which sessions">
      <button type="button" data-list="all" aria-selected="true">All</button>
      <button type="button" data-list="favorites" aria-selected="false">Favorites</button>
    </div>
    <input id="history-search" class="history-search" type="search" placeholder="Search titles, first prompts and notes" aria-label="Search sessions">
    <div class="history-toolbar">
      <div id="history-sort" class="view-toggle history-sort" role="tablist" aria-label="Sort sessions">
        <button type="button" data-sort="recent" aria-selected="true">Recent</button>
        <button type="button" data-sort="title" aria-selected="false">A–Z</button>
      </div>
      <button class="history-list-toggle" type="button" aria-expanded="true" aria-label="Hide the session list" title="Hide the list (⌘\\)">‹</button>
    </div>
    <div id="history-list" class="history-list"></div>
  </div>
  <div class="history-preview-pane">
    <p id="history-open-note" class="history-note history-open-note" aria-live="polite"></p>
    <div id="history-preview" class="history-preview reader-column"></div>
    <div id="history-reply-dock" class="history-reply-dock"></div>
  </div>
  <aside id="history-notes" hidden></aside>`;
export const search = query<HTMLInputElement>(view, '#history-search');
export const list = query(view, '#history-list');
export const preview = query(view, '#history-preview');
export const replyDock = query(view, '#history-reply-dock');
export const notesAside = query(view, '#history-notes');
export const openNote = query(view, '#history-open-note');
export const sortToggle = query(view, '#history-sort');
export const listTabs = query(view, '#history-tabs');
export const railTitle = query(view, '.history-rail-title');

// The shared naming rule, so History, the tabs and the Sessions panel call a session the same thing.
export const titleOf = (session: Session): string =>
  sessionTitle({ organizerTitle: session.organizer?.title, title: session.title, firstPrompt: session.firstPrompt, cwd: session.cwd });
export const selectedSession = (): Session | undefined => state.sessions.find((s) => s.sessionId === state.selectedId);

const DAY_MS = 86_400_000;
export function dayLabel(ms: number): string {
  const day = new Date(ms);
  day.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - day.getTime()) / DAY_MS);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return day.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' });
}

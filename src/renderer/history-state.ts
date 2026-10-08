// History's shared state and page skeleton. The list, tags and preview modules render into these elements;
// the shell (history.ts) wires `hooks` so they can ask for a refresh without importing it.
import { byId, query } from './dom';
import type { HistoryList } from '../shared/ipc';

export type Session = HistoryList['sessions'][number];
export type PreviewMode = 'replies' | 'flow' | 'decisions';
export type GroupBy = 'tag' | 'day' | 'project';

export const state = {
  sessions: [] as Session[],
  selectedId: null as string | null,
  previewMode: 'replies' as PreviewMode,
  groupBy: 'tag' as GroupBy,
  tagColors: {} as HistoryList['tags'], // { [name]: { color } } from tags.json
  tagFilter: new Set<string>(), // every selected tag must be on a session (AND)
};

// Folded groups and the folded tag bar are remembered per viewer; storage can be unavailable, so never rely on it.
const FOLD_KEY = 'petal.history.folded';
const readFolds = (): Set<string> => { try { return new Set<string>(JSON.parse(localStorage.getItem(FOLD_KEY) || '[]')); } catch { return new Set(); } };
export const folded = readFolds();
const saveFolds = () => { try { localStorage.setItem(FOLD_KEY, JSON.stringify([...folded])); } catch { /* per-viewer nicety only */ } };
export const TAGBAR_KEY = 'tagbar';

export function toggleFold(key: string): void {
  if (folded.has(key)) folded.delete(key);
  else folded.add(key);
  saveFolds();
}

export const hooks = {
  refresh: async (): Promise<boolean> => false,
  renderList: (): void => {},
  close: (): void => {},
};

export const view = byId('history');
view.innerHTML = `
  <div class="history-list-pane">
    <input id="history-search" class="history-search" type="search" placeholder="Search titles, first prompts and notes" aria-label="Search sessions">
    <div class="history-toolbar">
      <div id="history-group" class="view-toggle history-group" role="tablist" aria-label="Group sessions">
        <button type="button" data-group="tag" aria-selected="true">By tag</button>
        <button type="button" data-group="day" aria-selected="false">By day</button>
        <button type="button" data-group="project" aria-selected="false">By project</button>
      </div>
      <button id="history-tidy" class="flow-button history-tidy" type="button" title="Give recent sessions clear titles and projects. Uses your Claude plan.">Tidy now</button>
    </div>
    <div id="history-tagbar" class="history-tagbar" role="group" aria-label="Filter by tag"></div>
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
export const groupToggle = query(view, '#history-group');
export const tidyButton = query<HTMLButtonElement>(view, '#history-tidy');
export const tagBar = query(view, '#history-tagbar');

// Organizer labels win over Claude Code's own title when present.
export const titleOf = (session: Session): string => session.organizer?.title || session.title || 'Untitled session';
export const projectOf = (session: Session): string => session.organizer?.project || 'Unsorted';
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

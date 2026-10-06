// History: this past week's Claude sessions. Replaces the reader while open; Esc or Cmd+Y goes back.
// The list, tags and preview live in history-*.ts; this is the overlay shell that opens, refreshes and wires them.
import * as overlays from './overlays';
import { groupToggle, hooks, list, openNote, search, state, tidyButton, type GroupBy, type PreviewMode } from './history-state';
import { renderTagBar } from './history-tags';
import { renderList } from './history-list';
import { renderPreview } from './history-preview';
import { byId, el } from './dom';

export type { PreviewMode } from './history-state';

const button = byId('history-button');

export function select(sessionId: string): void {
  if (sessionId !== state.selectedId) state.previewMode = 'replies';
  state.selectedId = sessionId;
  renderList();
  renderPreview();
}

// Re-reads the list; returns whether a background pass is running.
async function refresh(): Promise<boolean> {
  const result = await window.pastel.history.list();
  if ('error' in result) {
    list.replaceChildren(el('p', 'history-error', `Couldn’t list sessions: ${result.error}`));
    return false;
  }
  state.sessions = result.sessions;
  state.tagColors = result.tags;
  for (const name of [...state.tagFilter]) if (!state.tagColors[name]) state.tagFilter.delete(name); // a deleted tag can't stay a filter
  if (!state.sessions.some((s) => s.sessionId === state.selectedId)) state.selectedId = state.sessions[0]?.sessionId ?? null;
  renderTagBar();
  renderList();
  return result.organizing;
}

// Also joins a pass the timer already started, so the button shows it.
async function tidy(): Promise<void> {
  if (tidyButton.disabled) return;
  tidyButton.disabled = true;
  tidyButton.textContent = 'Organizing…';
  try {
    const result = await window.pastel.history.tidy();
    if ('error' in result) openNote.textContent = `Couldn’t organize: ${result.error}`;
    if (isOpen()) await refresh();
  } finally {
    tidyButton.disabled = false;
    tidyButton.textContent = 'Tidy now';
  }
}

function setGroupBy(mode: GroupBy): void {
  state.groupBy = mode;
  for (const b of groupToggle.querySelectorAll<HTMLButtonElement>('button')) b.setAttribute('aria-selected', String(b.dataset.group === mode));
  renderList();
}

export async function open(): Promise<void> {
  overlays.show('history');
  const organizing = await refresh();
  renderPreview();
  search.focus();
  if (organizing) tidy();
}

export const close = (): void => overlays.hide('history');
export const isOpen = (): boolean => overlays.isOpen('history');
export const toggle = (): Promise<void> | void => (isOpen() ? close() : open());

button.addEventListener('click', toggle);
search.addEventListener('input', renderList);
const isGroupBy = (value: string | undefined): value is GroupBy => value === 'tag' || value === 'day' || value === 'project';
groupToggle.addEventListener('click', (event) => {
  const group = (event.target as HTMLElement).dataset.group;
  if (isGroupBy(group)) setGroupBy(group);
});
tidyButton.addEventListener('click', tidy);
window.pastel.onToggleHistory(toggle);

export const rerender = (): void => { if (isOpen()) renderPreview(); };
export function setPreviewMode(mode: PreviewMode): Promise<void> {
  state.previewMode = mode;
  return renderPreview();
}

hooks.refresh = refresh;
hooks.renderList = renderList;
hooks.close = close;

// History's session list: one flat list, newest first or A–Z by title, filtered by the search box.
import { el } from './dom';
import { timeOf } from './format';
import { dayLabel, list, openNote, search, state, titleOf, type Session } from './history-state';
import { doResume, hoverPreview } from './history-preview';

const STATUSES = new Set(['done', 'in progress', 'blocked']);

function row(session: Session): HTMLButtonElement {
  const item = el('button', `history-row${session.sessionId === state.selectedId ? ' selected' : ''}`);
  item.type = 'button';
  item.dataset.sessionId = session.sessionId;
  const title = el('span', 'history-title');
  title.append(el('span', 'history-title-text', titleOf(session)));
  const status = session.organizer?.status;
  if (status && STATUSES.has(status)) title.append(el('span', `history-status history-status-${status.replace(/\s+/g, '-')}`, status));
  if (session.live) title.append(el('span', 'history-live', 'live'));
  if (session.hasFlow) title.append(el('span', 'history-flow', 'flow'));
  if (session.notes) title.append(el('span', 'history-flow history-has-notes', 'notes'));
  const count = `${session.messages}${session.messagesExact ? '' : '+'} messages`;
  const meta = el('span', 'history-meta');
  if (session.organizer?.project) meta.append(el('span', 'history-project', session.organizer.project));
  meta.append(document.createTextNode([session.shortCwd, `${dayLabel(session.lastAt)} ${timeOf(session.lastAt)}`, count].join(' · ')));
  item.append(title, meta);
  // Click opens the session; hovering or focusing shows its preview.
  item.addEventListener('click', () => doResume(session.sessionId, openNote, false));
  item.addEventListener('mouseenter', () => hoverPreview(session.sessionId));
  item.addEventListener('focus', () => hoverPreview(session.sessionId));
  return item;
}

const byTitle = (a: Session, b: Session): number => titleOf(a).localeCompare(titleOf(b), undefined, { sensitivity: 'base' });

export function renderList(): void {
  const query = search.value.trim().toLowerCase();
  const haystack = (s: Session) => `${titleOf(s)} ${s.title} ${s.firstPrompt} ${s.organizer?.project ?? ''} ${s.notes ?? ''}`.toLowerCase();
  const shown = state.sessions.filter((s) => !query || haystack(s).includes(query));
  // Sessions arrive newest first.
  if (state.sort === 'title') shown.sort(byTitle);
  list.replaceChildren(...shown.map(row));
  if (!shown.length) list.append(el('p', 'history-empty', query ? 'No sessions match.' : 'No sessions this past week.'));
}

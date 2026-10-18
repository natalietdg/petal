// History's session list: all sessions or only starred ones, newest first or A–Z by title, filtered by the search box.
import { el, isIpcError } from './dom';
import { sessionNameEl } from './session-name';
import { timeOf } from './format';
import { dayLabel, list, openNote, search, state, titleOf, type Session } from './history-state';
import { doResume, hoverPreview } from './history-preview';
import * as favorites from './favorites';
import { listedFor } from '../shared/favorites';
import { conclusionGist } from '../shared/conclusion';

const STATUSES = new Set(['done', 'in progress', 'blocked']);

function row(session: Session): HTMLElement {
  const item = el('button', `history-row${session.sessionId === state.selectedId ? ' selected' : ''}`);
  item.type = 'button';
  item.dataset.sessionId = session.sessionId;
  const title = el('span', 'history-title');
  title.append(sessionNameEl('span', 'history-title-text', titleOf(session)));
  const status = session.organizer?.status;
  if (status && STATUSES.has(status)) title.append(el('span', `history-status history-status-${status.replace(/\s+/g, '-')}`, status));
  if (session.live) title.append(el('span', 'history-live', 'live'));
  if (session.hasFlow) title.append(el('span', 'history-flow', 'flow'));
  if (session.notes) title.append(el('span', 'history-flow history-has-notes', 'notes'));
  if (session.conclusion) title.append(el('span', 'history-concluded', 'Concluded'));
  const count = `${session.messages}${session.messagesExact ? '' : '+'} messages`;
  const meta = el('span', 'history-meta');
  if (session.organizer?.project) meta.append(el('span', 'history-project', session.organizer.project));
  meta.append(document.createTextNode([session.shortCwd, `${dayLabel(session.lastAt)} ${timeOf(session.lastAt)}`, count].join(' · ')));
  item.append(title, ...(session.conclusion ? [el('span', 'history-snippet', conclusionGist(session.conclusion))] : []), meta);
  // Click opens the session; hovering or focusing shows its preview.
  item.addEventListener('click', () => doResume(session.sessionId, openNote, false));
  item.addEventListener('mouseenter', () => hoverPreview(session.sessionId));
  item.addEventListener('focus', () => hoverPreview(session.sessionId));
  // The star sits beside the row button, never inside it, so a click on it only stars.
  const wrap = el('div', 'history-item');
  wrap.append(item, favorites.star(session.sessionId, 'history-row-star'));
  return wrap;
}

const byTitle = (a: Session, b: Session): number => titleOf(a).localeCompare(titleOf(b), undefined, { sensitivity: 'base' });

function folderOffNote(): HTMLElement {
  const note = el('div', 'history-empty history-folder-off');
  const allow = el('button', 'flow-button history-allow', 'Allow');
  allow.type = 'button';
  allow.addEventListener('click', () => window.dispatchEvent(new Event('petal:allow-folder')));
  note.append(el('p', null, 'Petal isn’t reading your Claude folder, so History is empty.'), allow);
  return note;
}

// Offered here, not on first run, since it spends her Claude plan; hidden until the config says it's off.
function organizerOffer(): HTMLElement {
  const offer = el('div', 'history-empty history-organizer-offer');
  offer.hidden = true;
  const turnOn = el('button', 'flow-button history-organizer-on', 'Turn it on');
  turnOn.type = 'button';
  turnOn.addEventListener('click', async () => {
    turnOn.disabled = true;
    const saved = await window.pastel.config.save({ organizer: { enabled: true } });
    offer.replaceChildren(el('p', null, isIpcError(saved) ? `Couldn’t turn it on: ${saved.error}` : 'On. Change it in Customize › Organizer.'));
  });
  offer.append(el('p', null, 'Want Claude to name and tidy your sessions as they come in? It uses your Claude plan.'), turnOn);
  void window.pastel.config.get().then((state) => { offer.hidden = isIpcError(state) || state.config.organizer.enabled; });
  return offer;
}

export function renderList(): void {
  const query = search.value.trim().toLowerCase();
  const haystack = (s: Session) => `${titleOf(s)} ${s.title} ${s.firstPrompt} ${s.organizer?.project ?? ''} ${s.notes ?? ''} ${s.conclusion ? conclusionGist(s.conclusion) : ''}`.toLowerCase();
  const listed = listedFor(state.sessions, favorites.ids(), state.listKind);
  const shown = listed.filter((s) => !query || haystack(s).includes(query));
  // Sessions arrive newest first.
  if (state.sort === 'title') shown.sort(byTitle);
  list.replaceChildren(...shown.map(row));
  if (!state.folderAllowed) {
    list.append(folderOffNote());
    return;
  }
  if (shown.length) return;
  const favs = state.listKind === 'favorites';
  const empty = query ? 'No sessions match.' : favs ? 'Star a session to keep it here.' : 'No sessions this past week.';
  list.append(el('p', 'history-empty', empty));
  if (!query && !favs) list.append(organizerOffer());
}

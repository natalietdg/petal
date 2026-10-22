// History's session list: all sessions or only starred ones, newest first or A–Z by title, filtered by the search box.
// The box matches titles, notes and conclusions here, and her prompts and Claude's replies through main (history-search.ts).
import { el, isIpcError } from './dom';
import { sessionNameEl } from './session-name';
import { timeOf } from './format';
import { dayLabel, list, openNote, search, state, titleOf, type Session } from './history-state';
import { doResume, hoverPreview } from './history-preview';
import * as favorites from './favorites';
import { listedFor } from '../shared/favorites';
import { conclusionGist } from '../shared/conclusion';

const STATUSES = new Set(['done', 'in progress', 'blocked']);
const SEARCH_DELAY_MS = 200; // ask main once she pauses typing

// The words around a conversation match, the query marked.
function matchSnippet(snippet: string, query: string): HTMLElement {
  const line = el('span', 'history-snippet history-match');
  const lower = snippet.toLowerCase();
  let from = 0;
  for (let at = lower.indexOf(query); at >= 0 && query; at = lower.indexOf(query, from)) {
    line.append(snippet.slice(from, at), el('mark', null, snippet.slice(at, at + query.length)));
    from = at + query.length;
  }
  line.append(snippet.slice(from));
  return line;
}

function row(session: Session, match: { snippet: string; query: string } | null = null): HTMLElement {
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
  const gist = session.conclusion ? [el('span', 'history-snippet', conclusionGist(session.conclusion))] : [];
  item.append(title, ...gist, ...(match ? [matchSnippet(match.snippet, match.query)] : []), meta);
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

// Conversation matches for one query and session list; a new query or a reloaded list asks main again.
let found = { query: '', snippets: new Map<string, string>() };
let asked = { query: '', sessions: state.sessions };
let searchTimer: ReturnType<typeof setTimeout> | undefined;

function searchConversations(query: string): void {
  if (query === asked.query && state.sessions === asked.sessions) return;
  asked = { query, sessions: state.sessions };
  clearTimeout(searchTimer);
  if (!query) return;
  searchTimer = setTimeout(async () => {
    const result = await window.pastel.history.search(query);
    if (query !== asked.query) return; // she typed on
    found = { query, snippets: new Map(isIpcError(result) ? [] : result.matches.map((m) => [m.sessionId, m.snippet])) };
    renderList();
  }, SEARCH_DELAY_MS);
}

export function renderList(): void {
  const query = search.value.trim().toLowerCase();
  searchConversations(query);
  const haystack = (s: Session) => `${titleOf(s)} ${s.title} ${s.firstPrompt} ${s.organizer?.project ?? ''} ${s.notes ?? ''} ${s.conclusion ? conclusionGist(s.conclusion) : ''}`.toLowerCase();
  const snippets = found.query === query ? found.snippets : new Map<string, string>();
  const listed = listedFor(state.sessions, favorites.ids(), state.listKind);
  const byWords = new Set(listed.filter((s) => !query || haystack(s).includes(query)));
  const shown = listed.filter((s) => byWords.has(s) || snippets.has(s.sessionId));
  // Sessions arrive newest first.
  if (state.sort === 'title') shown.sort(byTitle);
  const matchFor = (s: Session) => (byWords.has(s) ? null : { snippet: snippets.get(s.sessionId) ?? '', query });
  list.replaceChildren(...shown.map((s) => row(s, matchFor(s))));
  if (!state.folderAllowed) {
    list.append(folderOffNote());
    return;
  }
  if (shown.length) return;
  const favs = state.listKind === 'favorites';
  const searching = query && found.query !== query;
  const empty = searching ? 'Searching conversations…' : query ? 'No sessions match.' : favs ? 'Star a session to keep it here.' : 'No sessions this past week.';
  list.append(el('p', 'history-empty', empty));
  if (!query && !favs) list.append(organizerOffer());
}

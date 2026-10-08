// History's session list: rows grouped by tag, day or project, with foldable groups.
import { el } from './dom';
import { timeOf } from './format';
import { dayLabel, folded, list, openNote, projectOf, search, state, titleOf, toggleFold, type Session } from './history-state';
import { removeTag, tagChip, UNTAGGED } from './history-tags';
import { doResume, hoverPreview } from './history-preview';

function row(session: Session): HTMLButtonElement {
  const item = el('button', `history-row${session.sessionId === state.selectedId ? ' selected' : ''}`);
  item.type = 'button';
  item.dataset.sessionId = session.sessionId;
  const title = el('span', 'history-title');
  title.append(el('span', 'history-title-text', titleOf(session)));
  const status = session.organizer?.status;
  if (status) title.append(el('span', `history-status history-status-${status.replace(/\s+/g, '-')}`, status));
  if (session.live) title.append(el('span', 'history-live', 'live'));
  if (session.hasFlow) title.append(el('span', 'history-flow', 'flow'));
  if (session.notes) title.append(el('span', 'history-flow history-has-notes', 'notes'));
  const count = `${session.messages}${session.messagesExact ? '' : '+'} messages`;
  const meta = el('span', 'history-meta');
  if (session.organizer?.project) meta.append(el('span', 'history-project', session.organizer.project));
  meta.append(document.createTextNode([session.shortCwd, timeOf(session.lastAt), count].join(' · ')));
  item.append(title, meta);
  if (session.tags?.length) {
    const tags = el('span', 'history-tags');
    for (const name of session.tags) {
      const chip = tagChip(name);
      const remove = el('span', 'history-tag-remove', '×');
      remove.title = `Remove “${name}”`;
      remove.addEventListener('click', (event) => { event.stopPropagation(); removeTag(session.sessionId, name); }); // not an open
      chip.append(remove);
      tags.append(chip);
    }
    item.append(tags);
  }
  // Click opens the session; hovering or focusing shows its preview.
  item.addEventListener('click', () => doResume(session.sessionId, openNote, false));
  item.addEventListener('mouseenter', () => hoverPreview(session.sessionId));
  item.addEventListener('focus', () => hoverPreview(session.sessionId));
  return item;
}

// A session with several tags sits under each of them.
function groupLabels(session: Session): string[] {
  if (state.groupBy === 'project') return [projectOf(session)];
  if (state.groupBy === 'day') return [dayLabel(session.lastAt)];
  return session.tags?.length ? session.tags : [UNTAGGED];
}

const foldKey = (label: string): string => `${state.groupBy}:${label}`;

function groupHeading(label: string, count: number): HTMLHeadingElement {
  const heading = el('h3', 'history-day history-group-heading');
  const isFolded = folded.has(foldKey(label));
  const toggle = el('button', 'history-fold', isFolded ? '▸' : '▾');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', String(!isFolded));
  toggle.setAttribute('aria-label', `${isFolded ? 'Show' : 'Hide'} ${label}`);
  heading.append(toggle);
  if (state.groupBy === 'tag' && label !== UNTAGGED) heading.append(tagChip(label, 'history-tag-heading'));
  else heading.append(document.createTextNode(label));
  heading.append(el('span', 'history-group-count', String(count)));
  toggle.addEventListener('click', () => { toggleFold(foldKey(label)); renderList(); });
  return heading;
}

export function renderList(): void {
  const query = search.value.trim().toLowerCase();
  const haystack = (s: Session) => `${s.title} ${s.firstPrompt} ${s.organizer?.title ?? ''} ${s.organizer?.project ?? ''} ${(s.tags ?? []).join(' ')} ${s.notes ?? ''}`.toLowerCase();
  const hasEveryTag = (s: Session) => [...state.tagFilter].every((t) => s.tags?.includes(t));
  const shown = state.sessions.filter((s) => (!query || haystack(s).includes(query)) && hasEveryTag(s));
  // Sessions arrive newest first, so groups and their rows keep that order.
  const groups = new Map<string, Session[]>();
  for (const session of shown) {
    for (const label of groupLabels(session)) {
      const group = groups.get(label) ?? [];
      group.push(session);
      groups.set(label, group);
    }
  }
  const untagged = groups.get(UNTAGGED);
  if (untagged) { // untagged sinks to the bottom
    groups.delete(UNTAGGED);
    groups.set(UNTAGGED, untagged);
  }
  list.replaceChildren(...[...groups].flatMap(([label, items]) => [
    groupHeading(label, items.length),
    ...(folded.has(foldKey(label)) ? [] : items.map(row)),
  ]));
  const filtered = query || state.tagFilter.size;
  if (!shown.length) list.append(el('p', 'history-empty', filtered ? 'No sessions match.' : 'No sessions this past week.'));
}

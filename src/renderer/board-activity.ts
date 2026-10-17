// The Board's Activity tab: one feed across the open sessions, newest first, filtered by session, kind and branch.
// A click jumps to the session (and its reply), or opens Testing for a run.
import { sinceText } from './sessions-panel';
import { el, isIpcError } from './dom';
import { ACTIVITY_KINDS, KIND_BADGES, KIND_WORDS, filterEvents, type ActivityEvent, type ActivityKind } from '../shared/activity';

const MAX_DETAIL = 5;

const section = el('section', 'board-activity');
section.setAttribute('aria-label', 'Activity');
section.hidden = true;
const filters = el('div', 'activity-filters');
const list = el('ol', 'activity-list');
section.append(filters, list);

let events: ActivityEvent[] = [];
let sessionFilter: string | null = null;
let kindFilter: ActivityKind | null = null;
let branch: string | null = null;
let onJump: (event: ActivityEvent) => void = () => {};

export const element = (): HTMLElement => section;
export const all = (): ActivityEvent[] => events;

export function init(jump: (event: ActivityEvent) => void): void {
  onJump = jump;
}

export async function load(): Promise<void> {
  const result = await window.pastel.activity.list();
  if (!isIpcError(result)) events = result;
  render();
}

// The board's branch filter applies here too.
export function setBranch(next: string | null): void {
  branch = next;
  render();
}

// Snapshot harness: the feed's filters, and back to none between steps.
export const filterState = () => ({ sessionFilter, kindFilter, branch });
export function resetFilters(): void {
  sessionFilter = null;
  kindFilter = null;
  branch = null;
}

export const shown = (): ActivityEvent[] => filterEvents(events, { sessionId: sessionFilter, kind: kindFilter, branch });

// Sessions named anywhere in the feed, for the session filter.
function sessionChoices(): [string, string][] {
  const names = new Map<string, string>();
  for (const e of events) {
    if (e.sessionId && e.sessionName && !names.has(e.sessionId)) names.set(e.sessionId, e.sessionName);
    if (e.toSessionId && e.toSessionName && !names.has(e.toSessionId)) names.set(e.toSessionId, e.toSessionName);
  }
  return [...names].sort((a, b) => a[1].localeCompare(b[1]));
}

function sessionSelect(): HTMLSelectElement {
  const select = el('select', 'activity-session');
  select.setAttribute('aria-label', 'Session');
  const options = [['', 'All sessions'], ...sessionChoices()];
  for (const [value, label] of options) select.append(Object.assign(el('option', null, label), { value }));
  select.value = sessionFilter ?? '';
  select.addEventListener('change', () => { sessionFilter = select.value || null; render(); });
  return select;
}

function kindButtons(): HTMLButtonElement[] {
  return [null, ...ACTIVITY_KINDS].map((kind) => {
    const count = filterEvents(events, { sessionId: sessionFilter, kind, branch }).length;
    const b = el('button', 'board-filter activity-kind', `${kind ? KIND_WORDS[kind] : 'All'} ${count}`);
    b.type = 'button';
    b.dataset.kind = kind ?? 'all';
    b.setAttribute('aria-pressed', String(kind === kindFilter));
    b.addEventListener('click', () => { kindFilter = kind; render(); });
    return b;
  });
}

const clock = (at: number): string => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function item(event: ActivityEvent): HTMLLIElement {
  const li = el('li', 'activity-row');
  const b = el('button', `activity-item ${event.kind}`);
  b.type = 'button';
  b.dataset.id = event.id;
  b.dataset.kind = event.kind;
  const top = el('span', 'activity-top');
  const time = el('time', 'activity-time', sinceText(event.at));
  time.dateTime = new Date(event.at).toISOString();
  time.title = clock(event.at);
  top.append(el('span', `activity-badge ${event.kind}`, KIND_BADGES[event.kind]), time);
  const who = [event.sessionName, event.toSessionName ? `to ${event.toSessionName}` : null, event.repo, event.branch].filter(Boolean).join(' · ');
  if (who) top.append(el('span', 'activity-who', who));
  b.append(top, el('span', 'activity-text', event.text));
  const detail = event.detail ?? [];
  if (detail.length > 1 || (detail.length === 1 && !event.text.includes(detail[0] ?? ''))) {
    const files = el('span', 'activity-detail');
    const shownDetail = detail.slice(0, MAX_DETAIL);
    files.textContent = shownDetail.join(' · ') + (detail.length > MAX_DETAIL ? ` · +${detail.length - MAX_DETAIL} more` : '');
    files.title = detail.join('\n');
    b.append(files);
  }
  b.addEventListener('click', () => onJump(event));
  li.append(b);
  return li;
}

export function render(): void {
  if (section.hidden) return;
  const focusedKind = (document.activeElement as HTMLElement | null)?.closest('.activity-kind')?.getAttribute('data-kind');
  filters.replaceChildren(sessionSelect(), ...kindButtons());
  const rows = shown();
  const empty = events.length ? 'Nothing matches these filters.' : 'Nothing yet. Tasks, edits, test runs, conclusions, Library notes, clashes and messages between sessions show here.';
  list.replaceChildren(...(rows.length ? rows.map(item) : [el('li', 'board-empty activity-empty', empty)]));
  if (focusedKind) filters.querySelector<HTMLElement>(`[data-kind="${focusedKind}"]`)?.focus();
}

export function show(visible: boolean): void {
  section.hidden = !visible;
  if (visible) void load();
}

window.pastel.activity.onChanged(() => { if (!section.hidden) void load(); });

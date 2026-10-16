// The shared activity feed: one list of what every open session did, newest first, capped.
// Main records events (main/activity-feed.ts); the Board's Activity tab lists and filters them.

export type ActivityKind = 'task' | 'edits' | 'test' | 'conclusion' | 'library' | 'clash' | 'message';
export const ACTIVITY_KINDS: readonly ActivityKind[] = ['task', 'edits', 'test', 'conclusion', 'library', 'clash', 'message'];
export const KIND_WORDS: Record<ActivityKind, string> = {
  task: 'Tasks', edits: 'Edits', test: 'Tests', conclusion: 'Conclusions', library: 'Library', clash: 'Clashes', message: 'Messages',
};

export const ACTIVITY_CAP = 500;

// Where a click on the item goes: the session's tab, one of its replies, or a Testing run.
export interface ActivityTarget {
  replyId?: string;
  runId?: string;
}

export interface ActivityEvent {
  id: string; // stable: recording the same id again updates the item instead of adding one
  kind: ActivityKind;
  at: number; // ms since epoch
  sessionId: string | null;
  sessionName: string | null;
  branch: string | null;
  repo: string | null; // the repo's folder name
  text: string; // one line
  detail?: string[]; // e.g. the files a turn edited
  toSessionId?: string | null; // a message's recipient
  toSessionName?: string | null;
  target?: ActivityTarget;
}

// What a recorder passes; id and at are filled in when left out.
export type ActivityInput = Omit<ActivityEvent, 'id' | 'at'> & { id?: string; at?: number };

// Newest first; a later recording of the same id replaces the old one. Ties keep the newer recording first.
export function upsertEvent(events: readonly ActivityEvent[], event: ActivityEvent, cap = ACTIVITY_CAP): ActivityEvent[] {
  const rest = events.filter((e) => e.id !== event.id);
  const at = rest.findIndex((e) => e.at <= event.at);
  const next = at === -1 ? [...rest, event] : [...rest.slice(0, at), event, ...rest.slice(at)];
  return next.slice(0, cap);
}

export interface ActivityFilter {
  sessionId?: string | null; // null or missing: every session
  kind?: ActivityKind | null;
  branch?: string | null;
}

// A message counts for both its sender and its recipient.
export function filterEvents(events: readonly ActivityEvent[], { sessionId, kind, branch }: ActivityFilter): ActivityEvent[] {
  return events.filter((e) => (!sessionId || e.sessionId === sessionId || e.toSessionId === sessionId)
    && (!kind || e.kind === kind)
    && (!branch || e.branch === branch));
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const optionalString = (value: unknown): string | null => (typeof value === 'string' ? value : null);

// A stored event, checked field by field; anything malformed is dropped.
export function toEvent(raw: unknown): ActivityEvent | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.text !== 'string' || typeof raw.at !== 'number') return null;
  if (!ACTIVITY_KINDS.includes(raw.kind as ActivityKind)) return null;
  const detail = Array.isArray(raw.detail) ? raw.detail.filter((d): d is string => typeof d === 'string') : undefined;
  const target = isRecord(raw.target) ? { replyId: optionalString(raw.target.replyId) ?? undefined, runId: optionalString(raw.target.runId) ?? undefined } : undefined;
  return {
    id: raw.id, kind: raw.kind as ActivityKind, at: raw.at, text: raw.text,
    sessionId: optionalString(raw.sessionId), sessionName: optionalString(raw.sessionName), branch: optionalString(raw.branch), repo: optionalString(raw.repo),
    ...(detail ? { detail } : {}),
    ...(raw.toSessionId !== undefined ? { toSessionId: optionalString(raw.toSessionId), toSessionName: optionalString(raw.toSessionName) } : {}),
    ...(target ? { target } : {}),
  };
}

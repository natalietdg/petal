// Main's side of the session naming rule: a session is named once from context, then the name sticks (session-names.ts).
import * as history from './history';
import * as organizer from './session-organizer';
import * as names from './session-names';
import * as configStore from './config-store';
import { contextTitle, sessionTitle } from '../shared/session-label';
import { agentTitle } from './agent-titles';

type NamedRecord = Pick<history.SessionRecord, 'title' | 'firstAiTitle' | 'customTitle' | 'firstPrompt' | 'lastAt'>;

// A transcript not on disk yet is looked up again after this; findRecord scans every project folder.
const MISS_RETRY_MS = 5000;
const misses = new Map<string, number>(); // sessionId -> when the last lookup found nothing

function recordOf(sessionId: string): history.SessionRecord | null {
  const missedAt = misses.get(sessionId);
  if (missedAt !== undefined && Date.now() - missedAt < MISS_RETRY_MS) return null;
  const record = history.findRecord(sessionId); // mtime-cached, so a found one rereads only when it grows
  if (record) misses.delete(sessionId); else misses.set(sessionId, Date.now());
  return record;
}

// Claude Code's first and latest ai-title; a fixture without firstAiTitle counts a title that isn't its prompt.
function aiTitles(record: NamedRecord): { first: string | null; latest: string | null } {
  const has = record.firstAiTitle !== undefined ? Boolean(record.firstAiTitle) : Boolean(record.title) && record.title !== record.firstPrompt;
  return { first: record.firstAiTitle ?? (has ? record.title : null), latest: has ? record.title : null };
}

// First read after upgrade: pin what every listed session shows now (organizer, else latest ai-title).
function ensureStore(): void {
  if (names.exists()) return;
  const labels = organizer.loadCached();
  const listed = history.listSessions(new Set(configStore.load().history.favorites));
  names.create(Object.fromEntries(listed.map((s) => [s.sessionId, contextTitle(labels[s.sessionId]?.title, aiTitles(s).latest)])));
}

interface NameInputs {
  organizerTitle?: string | null;
  record?: NamedRecord | null;
  firstPrompt?: string | null; // what the caller knows when there is no record yet
  cwd?: string | null;
}

// Her /rename, else the pinned name, else pin the first context title that landed, else her first prompt as a placeholder.
export function nameFor(sessionId: string, { organizerTitle = null, record = null, firstPrompt = null, cwd = null }: NameInputs): string {
  ensureStore();
  const own = contextTitle(record?.customTitle);
  if (own) names.pin(sessionId, own, 'manual');
  const pinned = names.pinned(sessionId)?.title;
  if (pinned) return sessionTitle({ pinned, cwd });
  const knewIt = Boolean(record && record.lastAt <= names.since()); // last written before the upgrade: she knew its latest title
  const fromOrganizer = contextTitle(organizerTitle);
  const fromClaude = record ? contextTitle(knewIt ? aiTitles(record).latest : aiTitles(record).first) : '';
  const context = fromOrganizer || fromClaude;
  if (context) names.pin(sessionId, context, knewIt ? 'known' : fromOrganizer ? 'organizer' : 'claude');
  return sessionTitle({ pinned: context, firstPrompt: record?.firstPrompt || firstPrompt, cwd });
}

// A session History or the Board already listed, with the organizer labels it read.
export const listedName = (session: history.SessionRecord, labels: Readonly<organizer.OrganizerStore>): string =>
  nameFor(session.sessionId, { organizerTitle: labels[session.sessionId]?.title, record: session, cwd: session.cwd });

// firstPrompt: what the caller already knows (the reader's first reply), for a session with no transcript record yet.
export function sessionTitleFor(sessionId: string, { cwd = null, firstPrompt = null }: { cwd?: string | null; firstPrompt?: string | null } = {}): string {
  const agent = agentTitle(sessionId); // a testing or bug fix agent Petal started is named for its role and task
  if (agent) return agent;
  const record = recordOf(sessionId);
  return nameFor(sessionId, { organizerTitle: organizer.loadCached()[sessionId]?.title, record, firstPrompt, cwd: cwd ?? record?.cwd });
}

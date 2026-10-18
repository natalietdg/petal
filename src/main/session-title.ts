// Main's side of the session naming rule: gathers the organizer title and the transcript's title for shared/session-label.
import * as history from './history';
import * as organizer from './session-organizer';
import { sessionTitle } from '../shared/session-label';
import { agentTitle } from './agent-titles';

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

// firstPrompt: what the caller already knows (the reader's first reply), for a session with no transcript record yet.
export function sessionTitleFor(sessionId: string, { cwd = null, firstPrompt = null }: { cwd?: string | null; firstPrompt?: string | null } = {}): string {
  const agent = agentTitle(sessionId); // a testing or bug fix agent Petal started is named for its role and task
  if (agent) return agent;
  const record = recordOf(sessionId);
  return sessionTitle({
    organizerTitle: organizer.loadCached()[sessionId]?.title,
    title: record?.title,
    firstPrompt: record?.firstPrompt || firstPrompt,
    cwd: cwd ?? record?.cwd,
  });
}

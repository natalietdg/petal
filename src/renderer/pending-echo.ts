// Her reply-box messages, shown in the reader the moment she sends them, until Claude writes them to its log.
import type { ReaderUpdate } from '../shared/types';

export interface PendingEcho {
  key: number;
  text: string;
  sentAt: number;
  sessionId: string | null;
  target: number; // the session's prompt count once this message is in the log
}

type Seen = Pick<ReaderUpdate, 'state' | 'sessionId' | 'promptCount' | 'busy'>;

const STALE_MS = 120_000; // never written (a picker swallowed it): stop showing it once Claude is idle
let nextKey = 1;

// Slash commands and shell escapes aren't prompts in the log, so they would never be matched.
export const echoes = (text: string): boolean => !/^[/!]/.test(text);

export function add(list: readonly PendingEcho[], text: string, seen: Seen, now = Date.now()): PendingEcho[] {
  const base = Math.max(seen.promptCount, list.at(-1)?.target ?? 0);
  return [...list, { key: nextKey++, text, sentAt: now, sessionId: seen.sessionId, target: base + 1 }];
}

// Prompts land in the log in the order she sent them, so each new one replaces the oldest echo.
export function reconcile(list: readonly PendingEcho[], seen: Seen, now = Date.now()): PendingEcho[] {
  if (seen.state !== 'live') return [];
  return list.flatMap((echo) => {
    const sessionId = echo.sessionId ?? seen.sessionId; // sent before the session file was readable
    if (seen.sessionId && sessionId !== seen.sessionId) return [];
    if (seen.promptCount >= echo.target) return [];
    if (!seen.busy && now - echo.sentAt > STALE_MS) return [];
    return [{ ...echo, sessionId }];
  });
}

// Milliseconds until the next echo is old enough to drop once Claude is idle; null when none is still that young.
// Nothing else re-checks an idle tab, since main sends no update while nothing changes.
export function untilStale(list: readonly PendingEcho[], now = Date.now()): number | null {
  const waits = list.map((echo) => echo.sentAt + STALE_MS - now).filter((ms) => ms >= 0);
  return waits.length ? Math.min(...waits) + 1 : null;
}

export const remove = (list: readonly PendingEcho[], key: number): PendingEcho[] => list.filter((echo) => echo.key !== key);

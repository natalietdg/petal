// Each concluded session's This session facts, asked of main once and kept; asked again when the Library
// starts or finishes reading it, a test run moves on, or the session concludes again.
import { isIpcError } from './dom';
import type { SessionInfo } from '../shared/session-info';

interface Entry { key: string; info: SessionInfo | null }
const cache = new Map<string, Entry>();
const asking = new Set<string>();
const wanted = new Map<string, string>(); // the newest key asked for, per session
const again = new Set<string>(); // asked while an answer was on its way: ask once more after it
const listeners = new Set<(sessionId: string) => void>();

function ask(sessionId: string, key: string): void {
  if (asking.has(sessionId)) { again.add(sessionId); return; }
  asking.add(sessionId);
  void window.pastel.conclusion.info(sessionId).then((result) => {
    asking.delete(sessionId);
    const info = isIpcError(result) ? null : result;
    const before = cache.get(sessionId);
    cache.set(sessionId, { key, info });
    if (JSON.stringify(before?.info ?? null) !== JSON.stringify(info)) for (const listener of listeners) listener(sessionId);
    if (again.delete(sessionId)) ask(sessionId, wanted.get(sessionId) ?? key); // a change landed while this answer was on its way
  }, () => { asking.delete(sessionId); again.delete(sessionId); });
}

// What is known now (null until the first answer); a new key (the conclusion's time) asks again and keeps the old line meanwhile.
export function infoFor(sessionId: string, key: string): SessionInfo | null {
  const entry = cache.get(sessionId);
  wanted.set(sessionId, key);
  if (!entry || entry.key !== key) ask(sessionId, key);
  return entry?.info ?? null;
}

export function onInfo(listener: (sessionId: string) => void): void {
  listeners.add(listener);
}

const askAgain = (sessionId: string): void => {
  const entry = cache.get(sessionId);
  if (entry) ask(sessionId, entry.key);
};

window.pastel.conclusion.onInfoChanged(({ sessionId }) => askAgain(sessionId));
window.pastel.testing.onRunUpdate(({ run }) => { if (run.state !== 'running') for (const sessionId of cache.keys()) askAgain(sessionId); });

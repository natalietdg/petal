// Starred sessions: their ids live in config.json (history.favorites) so History › Favorites can find them again.

// Enough for years of starring; the oldest stars drop first past it.
export const MAX_FAVORITES = 500;

export type HistoryListKind = 'all' | 'favorites';

// Starring adds it at the end, unstarring takes it out.
export const toggled = (favorites: readonly string[], sessionId: string): string[] =>
  favorites.includes(sessionId) ? favorites.filter((id) => id !== sessionId) : [...favorites, sessionId].slice(-MAX_FAVORITES);

// What a History tab lists: everything, or only starred sessions; a starred id with no session is simply absent.
export function listedFor<T extends { sessionId: string }>(sessions: readonly T[], favorites: readonly string[], kind: HistoryListKind): T[] {
  if (kind === 'all') return [...sessions];
  const starred = new Set(favorites);
  return sessions.filter((s) => starred.has(s.sessionId));
}

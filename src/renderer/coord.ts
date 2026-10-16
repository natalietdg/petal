// Main's coordination view in the page: each live session's repo, branch, task and file clashes, pushed on every change.
import { isIpcError } from './dom';
import { EMPTY_COORD, type CoordSession, type CoordView } from '../shared/coord';

let view: CoordView = EMPTY_COORD;
let byId = new Map<string, CoordSession>();
const listeners = new Set<() => void>();

function set(next: CoordView): void {
  view = next;
  byId = new Map(next.sessions.map((s) => [s.sessionId, s]));
  for (const listener of listeners) listener();
}

export const current = (): CoordView => view;
export const session = (sessionId: string | null | undefined): CoordSession | null => (sessionId ? byId.get(sessionId) ?? null : null);

export function onChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export async function refresh(): Promise<void> {
  const result = await window.pastel.coord.get();
  if (!isIpcError(result)) set(result);
}

window.pastel.coord.onUpdate(set);
void refresh();

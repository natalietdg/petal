// What each session added to the Library, in <userData>/library-sessions.json, so a conclusion reopened from History
// still names its notes. Newest MAX_SESSIONS kept.
import path from 'node:path';
import { app } from 'electron';
import { readJsonOrSetAside, writeJsonAtomic } from './atomic-file';
import { mergeLibraryResults, type LibrarySessionResult, type NoteRef } from '../shared/session-info';

const MAX_SESSIONS = 500;
const fileOf = (dir: string) => path.join(dir, 'library-sessions.json');
const defaultDir = () => app.getPath('userData');

type Stored = Record<string, LibrarySessionResult>;

const isNotes = (value: unknown): value is NoteRef[] =>
  Array.isArray(value) && value.every((n) => n && typeof n.slug === 'string' && typeof n.title === 'string');

function loadAll(dir: string): Stored {
  const data = readJsonOrSetAside(fileOf(dir));
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  return Object.fromEntries(Object.entries(data as Record<string, Partial<LibrarySessionResult>>)
    .filter(([, r]) => r && isNotes(r.added) && isNotes(r.updated) && typeof r.at === 'string')) as Stored;
}

export const stored = (sessionId: string, dir = defaultDir()): LibrarySessionResult | null => loadAll(dir)[sessionId] ?? null;

// Adds one run's notes to the session's record; a run that changed nothing still records that it read the session.
export function record(sessionId: string, run: { added: NoteRef[]; updated: NoteRef[] }, { dir = defaultDir(), now = new Date() } = {}): LibrarySessionResult {
  const all = loadAll(dir);
  const next = mergeLibraryResults(all[sessionId] ?? null, run, now.toISOString());
  const kept = Object.entries({ ...all, [sessionId]: next }).sort((a, b) => b[1].at.localeCompare(a[1].at)).slice(0, MAX_SESSIONS);
  writeJsonAtomic(fileOf(dir), Object.fromEntries(kept));
  return next;
}

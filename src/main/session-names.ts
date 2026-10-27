// Each session's name, pinned once so later titles never rename it. Kept in <userData>/session-names.json, never under ~/.claude.
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { readJsonOrSetAside, writeJsonAtomic } from './atomic-file';

// organizer / claude: the first context title that landed. known: the name she saw before this store existed. manual: her /rename.
export type NameSource = 'organizer' | 'claude' | 'known' | 'manual';

// A session is named only after this many of her prompts: one prompt is too thin to name a whole session.
export const PROMPTS_BEFORE_NAMING = 3;

// Fixtures carry no prompt count and count as ready, like a fixture without firstAiTitle.
export const readyToName = (record: { prompts?: number } | null | undefined): boolean =>
  Boolean(record) && (record?.prompts ?? PROMPTS_BEFORE_NAMING) >= PROMPTS_BEFORE_NAMING;

export interface PinnedName {
  title: string;
  from: NameSource;
  at: string;
}

interface NamesFile {
  since: number; // when the store was first written: the upgrade
  names: Record<string, PinnedName>;
}

const storeFile = () => path.join(app.getPath('userData'), 'session-names.json');

function read(): NamesFile | null {
  const data = readJsonOrSetAside(storeFile()) as Partial<NamesFile> | undefined;
  if (!data || typeof data !== 'object' || typeof data.since !== 'number') return null;
  return { since: data.since, names: data.names && typeof data.names === 'object' ? data.names : {} };
}

// Hot path (every tab label every 2s): re-read only when the file changes.
let cache: { mtimeMs: number; size: number; file: NamesFile | null } | null = null;
function loadCached(): NamesFile | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(storeFile());
  } catch {
    cache = null;
    return null;
  }
  if (cache?.mtimeMs !== stat.mtimeMs || cache.size !== stat.size) cache = { mtimeMs: stat.mtimeMs, size: stat.size, file: read() };
  return cache.file;
}

function save(file: NamesFile): void {
  writeJsonAtomic(storeFile(), file, 1);
  cache = null;
}

export const exists = (): boolean => loadCached() !== null;
export const since = (): number => loadCached()?.since ?? Date.now();
export const pinned = (sessionId: string): PinnedName | null => loadCached()?.names[sessionId] ?? null;

// First write after upgrade: what every listed session shows now, so this change renames nothing she knows.
export function create(known: Record<string, string>): void {
  if (exists()) return;
  const at = new Date().toISOString();
  const names = Object.fromEntries(Object.entries(known).filter(([, title]) => title).map(([id, title]) => [id, { title, from: 'known' as const, at }]));
  save({ since: Date.now(), names });
}

// Pins once; only her own rename replaces a pinned name.
export function pin(sessionId: string, title: string, from: NameSource): void {
  const file = loadCached() ?? { since: Date.now(), names: {} };
  const current = file.names[sessionId];
  if (!title || current?.title === title) return;
  if (current && from !== 'manual') return;
  save({ since: file.since, names: { ...file.names, [sessionId]: { title, from, at: new Date().toISOString() } } });
}

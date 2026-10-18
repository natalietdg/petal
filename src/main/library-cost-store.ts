// The last Library build's token use, in <userData>/library-last-run.json, so the Library page can show it after a restart.
import path from 'node:path';
import { app } from 'electron';
import { readJsonOrSetAside, writeJsonAtomic } from './atomic-file';
import { usageFrom, type LastLibraryRun, type LibraryRunKind, type TokenUsage } from '../shared/library-cost';

const fileOf = (dir: string) => path.join(dir, 'library-last-run.json');
const defaultDir = () => app.getPath('userData');
const KINDS: readonly string[] = ['past', 'add', 'auto'];

export function lastRun(dir = defaultDir()): LastLibraryRun | null {
  const data = readJsonOrSetAside(fileOf(dir)) as Partial<Record<keyof LastLibraryRun, unknown>> | null;
  if (!data || typeof data.at !== 'string' || !KINDS.includes(data.kind as string) || typeof data.sessions !== 'number') return null;
  const u = data.usage as Partial<TokenUsage> | undefined;
  const usage = usageFrom(u && { input_tokens: u.input, output_tokens: u.output, cache_creation_input_tokens: u.cacheWrite, cache_read_input_tokens: u.cacheRead });
  return usage && { at: data.at, kind: data.kind as LibraryRunKind, sessions: data.sessions, usage };
}

export function recordRun(kind: LibraryRunKind, sessions: number, usage: TokenUsage, { dir = defaultDir(), now = new Date() } = {}): LastLibraryRun {
  const run: LastLibraryRun = { at: now.toISOString(), kind, sessions, usage };
  writeJsonAtomic(fileOf(dir), run);
  return run;
}

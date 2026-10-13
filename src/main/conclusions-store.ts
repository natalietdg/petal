// Parsed session conclusions in <userData>/conclusions.json, with where each log was read up to,
// so History lists them without re-reading logs; a grown log is read from its stored offset only.
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { writeJsonAtomic } from './atomic-file';
import { currentConclusion, emptyScan, scanFile, type ScanState } from './conclusion-scan';
import { sameConclusion, type Conclusion } from '../shared/conclusion';
import { claudeFolderAllowed } from './claude-folder';

const VERSION = 1;
const HEAD_BYTES = 256; // a rewritten log (not appended to) starts differently, so it is read again from the top
const SAVE_DELAY_MS = 2000; // a live session grows line by line; batch the writes

interface Entry extends ScanState {
  file: string;
  head: string;
}

interface StoreFile {
  version: number;
  sessions: Record<string, Entry>;
}

const storeFile = () => path.join(app.getPath('userData'), 'conclusions.json');

let entries: Record<string, Entry> | null = null;
const running = new Map<string, Promise<Conclusion | null>>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function loaded(): Record<string, Entry> {
  if (entries) return entries;
  try {
    const data = JSON.parse(fs.readFileSync(storeFile(), 'utf8')) as StoreFile;
    entries = data.version === VERSION && data.sessions ? data.sessions : {};
  } catch {
    entries = {};
  }
  return entries;
}

// Sessions whose log is gone drop out, so the file only holds what History can still show.
function save(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const kept = Object.fromEntries(Object.entries(loaded()).filter(([, entry]) => fs.existsSync(entry.file)));
    entries = kept;
    try {
      writeJsonAtomic(storeFile(), { version: VERSION, sessions: kept } satisfies StoreFile);
    } catch (error) {
      console.error('[petal] saving conclusions failed:', error);
    }
  }, SAVE_DELAY_MS);
}

async function headOf(file: string): Promise<string> {
  const handle = await fs.promises.open(file, 'r');
  try {
    const buffer = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEAD_BYTES, 0);
    return buffer.toString('base64', 0, bytesRead);
  } finally {
    await handle.close();
  }
}

// What was stored last; no file read.
export function stored(sessionId: string): Conclusion | null {
  const entry = loaded()[sessionId];
  return entry ? currentConclusion(entry) : null;
}

async function scan(sessionId: string, file: string): Promise<Conclusion | null> {
  const before = loaded()[sessionId];
  const { size } = await fs.promises.stat(file);
  if (before && before.file === file && before.offset === size) return currentConclusion(before);
  const head = await headOf(file);
  const fresh = !before || before.file !== file || before.head !== head || size < before.offset;
  const state = await scanFile(file, fresh ? emptyScan() : before);
  loaded()[sessionId] = { ...state, file, head };
  save();
  return currentConclusion(state);
}

// Reads whatever the log gained since the last read; one read per session at a time.
export function refresh(sessionId: string, file: string): Promise<Conclusion | null> {
  if (!claudeFolderAllowed()) return Promise.resolve(null); // her logs stay unread until she allows it
  const queued = (running.get(sessionId) ?? Promise.resolve(null))
    .catch(() => null)
    .then(() => scan(sessionId, file))
    .catch(() => stored(sessionId)); // a log deleted or unreadable mid-read keeps what was stored
  running.set(sessionId, queued);
  void queued.finally(() => { if (running.get(sessionId) === queued) running.delete(sessionId); });
  return queued;
}

type Sweep = { sessions: readonly { sessionId: string; file: string }[]; onChanged: () => void };
let sweeping: Promise<void> | null = null;
let waiting: Sweep | null = null;

async function sweepOnce({ sessions, onChanged }: Sweep): Promise<void> {
  let changed = false;
  for (const { sessionId, file } of sessions) {
    const before = stored(sessionId);
    changed = !sameConclusion(before, await refresh(sessionId, file)) || changed;
  }
  if (changed) onChanged();
}

// Refreshes each session in turn and reports once if any conclusion changed.
// A call during a sweep waits for it, then sweeps its own list; calls in between collapse into the newest.
export function refreshAll(sessions: Sweep['sessions'], onChanged: () => void): Promise<void> {
  waiting = { sessions, onChanged };
  sweeping ??= (async () => {
    for (let job: Sweep | null = waiting; job; job = waiting as Sweep | null) {
      waiting = null;
      await sweepOnce(job);
    }
  })().finally(() => { sweeping = null; });
  return sweeping;
}

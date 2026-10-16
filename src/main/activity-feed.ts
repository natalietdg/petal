// The activity feed's store: the newest 500 events in memory, saved to <userData>/activity.json so a restart keeps them.
// Anything in main records with recordActivity(); every window hears 'activity:changed' and re-reads the list.
import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow } from 'electron';
import { writeJsonAtomic } from './atomic-file';
import { send } from './ipc';
import { ACTIVITY_CAP, toEvent, upsertEvent, type ActivityEvent, type ActivityInput } from '../shared/activity';

const VERSION = 1;
const SAVE_DELAY_MS = 1000; // a burst of edits becomes one write
const NOTIFY_DELAY_MS = 150;

const storeFile = (): string => path.join(app.getPath('userData'), 'activity.json');

let events: ActivityEvent[] | null = null;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let notifyTimer: ReturnType<typeof setTimeout> | undefined;
let seq = 0;

function loaded(): ActivityEvent[] {
  if (events) return events;
  try {
    const data = JSON.parse(fs.readFileSync(storeFile(), 'utf8')) as { version?: number; events?: unknown[] };
    const stored = data.version === VERSION && Array.isArray(data.events) ? data.events.map(toEvent).filter((e): e is ActivityEvent => e !== null) : [];
    events = stored.sort((a, b) => b.at - a.at).slice(0, ACTIVITY_CAP);
  } catch {
    events = []; // none yet, or unreadable: start empty
  }
  return events;
}

// Writes now; used by the debounce and by tests.
export function flush(): void {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  try {
    writeJsonAtomic(storeFile(), { version: VERSION, events: loaded() });
  } catch (error) {
    console.error('[petal] saving activity failed:', error);
  }
}

function scheduleSave(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, SAVE_DELAY_MS);
}

function notifyWindows(): void {
  clearTimeout(notifyTimer);
  notifyTimer = setTimeout(() => {
    for (const win of BrowserWindow.getAllWindows()) send(win.webContents, 'activity:changed');
  }, NOTIFY_DELAY_MS);
}

// Adds an event, or replaces the one with the same id. Never throws: a feed problem never stops what it reports on.
export function recordActivity(input: ActivityInput): ActivityEvent | null {
  try {
    seq += 1;
    const event: ActivityEvent = { ...input, id: input.id ?? `${input.kind}-${Date.now().toString(36)}-${seq}`, at: input.at ?? Date.now() };
    events = upsertEvent(loaded(), event);
    scheduleSave();
    notifyWindows();
    return event;
  } catch (error) {
    console.error('[petal] activity not recorded:', error);
    return null;
  }
}

export interface MessageActivity {
  from: { sessionId: string; name: string; branch?: string | null; repo?: string | null };
  to: { sessionId: string; name: string };
  text: string;
  at?: number;
  id?: string;
}

// A message one session sent another (the @mentions feature calls this).
export const recordMessage = ({ from, to, text, at, id }: MessageActivity): ActivityEvent | null => recordActivity({
  kind: 'message', id, at, text,
  sessionId: from.sessionId, sessionName: from.name, branch: from.branch ?? null, repo: from.repo ?? null,
  toSessionId: to.sessionId, toSessionName: to.name,
});

// Newest first.
export const listActivity = (): ActivityEvent[] => [...loaded()];

// Tests only: forget the in-memory list so the next read comes from disk.
export function resetForTests(): void {
  clearTimeout(saveTimer);
  clearTimeout(notifyTimer);
  events = null;
}

// On launch: the newest quit's resume notes, offered once in the reader with each session's "Where it stopped".
import fs from 'node:fs/promises';
import path from 'node:path';
import { handle } from './ipc';
import { isSnapshotRun } from './snapshot-mode';
import { resumeRoot, SESSIONS_FILE } from './resume-notes';
import { newestUnseen, parseNotedSessions, readNote, stampTime, stoppedText } from './resume-notes-text';
import type { ResumeNotesSet } from '../shared/ipc';

const SHOWN_FILE = 'last-shown'; // the stamp last offered, so each quit's notes show once

const readText = (file: string): Promise<string | null> => fs.readFile(file, 'utf8').then((text) => text, () => null);

function parseListed(raw: string): ReturnType<typeof parseNotedSessions> {
  try {
    return parseNotedSessions(JSON.parse(raw));
  } catch {
    return []; // a half-written sessions.json lists nothing
  }
}

// The listed rows from sessions.json; older quits without it are read from the notes themselves.
async function readSessions(dir: string, notes: readonly string[]): Promise<ResumeNotesSet['sessions']> {
  const raw = await readText(path.join(dir, SESSIONS_FILE));
  if (raw !== null) {
    return Promise.all(parseListed(raw).map(async ({ title, sessionId, running, file }) =>
      ({ title, sessionId, running, stopped: stoppedText((await readText(path.join(dir, path.basename(file)))) ?? '') })));
  }
  const read = await Promise.all(notes.map(async (file) => {
    const text = (await readText(path.join(dir, file))) ?? '';
    const note = readNote(text);
    return note ? [{ ...note, stopped: stoppedText(text) }] : [];
  }));
  return read.flat();
}

// The newest quit folder not offered before, marked as offered now; null when there is none or it holds no notes.
export async function takeLatest(root = resumeRoot()): Promise<ResumeNotesSet | null> {
  const names = await fs.readdir(root).catch(() => [] as string[]);
  const lastShown = (await readText(path.join(root, SHOWN_FILE)))?.trim() || null;
  const stamp = newestUnseen(names, lastShown);
  if (!stamp) return null;
  await fs.writeFile(path.join(root, SHOWN_FILE), stamp);
  const dir = path.join(root, stamp);
  const notes = (await fs.readdir(dir).catch(() => [] as string[])).filter((name) => name.endsWith('.md') && name !== 'index.md');
  if (!notes.length) return null; // only shells were open: nothing to resume
  return { stamp, when: stampTime(stamp), notes: notes.length, sessions: await readSessions(dir, notes) };
}

export function registerResumeNotesIpc(): void {
  handle('resume-notes:latest', () => (isSnapshotRun() ? null : takeLatest())); // keeps a fake home's quits out of every capture
}

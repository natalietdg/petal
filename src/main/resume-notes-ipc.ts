// On launch: the newest quit's resume notes, offered once in the reader; Show in Finder reveals them.
import fs from 'node:fs/promises';
import path from 'node:path';
import { shell } from 'electron';
import { handle } from './ipc';
import { isSnapshotRun } from './snapshot-mode';
import { resumeRoot, SESSIONS_FILE } from './resume-notes';
import { newestUnseen, parseNotedSessions, STAMP_PATTERN, stampTime } from './resume-notes-text';
import type { ResumeNotesSet } from '../shared/ipc';

const SHOWN_FILE = 'last-shown'; // the stamp last offered, so each quit's notes show once

const readText = (file: string): Promise<string | null> => fs.readFile(file, 'utf8').then((text) => text, () => null);

async function readSessions(dir: string): Promise<ResumeNotesSet['sessions']> {
  const raw = await readText(path.join(dir, SESSIONS_FILE));
  if (raw === null) return []; // notes from before sessions.json: Show in Finder still works
  try {
    return parseNotedSessions(JSON.parse(raw)).map(({ title, sessionId, running }) => ({ title, sessionId, running }));
  } catch {
    return [];
  }
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
  return { stamp, when: stampTime(stamp), notes: notes.length, sessions: await readSessions(dir) };
}

export function registerResumeNotesIpc(): void {
  handle('resume-notes:latest', () => (isSnapshotRun() ? null : takeLatest())); // keeps a fake home's quits out of every capture
  handle('resume-notes:reveal', (_event, stamp) => {
    if (typeof stamp !== 'string' || !STAMP_PATTERN.test(stamp)) return false; // a folder name, never a path
    shell.showItemInFolder(path.join(resumeRoot(), stamp, 'index.md'));
    return true;
  });
}

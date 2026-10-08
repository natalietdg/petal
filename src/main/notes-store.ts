// Her own notes per Claude session: one markdown file each in Petal's userData. Never in a repo, ~/.claude or Claude's input.
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { writeFileAtomic } from './atomic-file';
import { SESSION_ID } from './session-id';

export const MAX_NOTE_CHARS = 200_000;
const SEARCH_CHARS = 4000; // History search reads this much of each note

export const notesDir = (): string => path.join(app.getPath('userData'), 'notes');

// Only a real session id names a file, so no id can reach outside the notes folder.
function fileFor(sessionId: unknown): string | null {
  return typeof sessionId === 'string' && SESSION_ID.test(sessionId) ? path.join(notesDir(), `${sessionId}.md`) : null;
}

export function read(sessionId: unknown): string {
  const file = fileFor(sessionId);
  if (!file) return '';
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return ''; // no notes yet
  }
}

export type SaveResult = { ok: true } | { note: string };

// Empty notes remove the file, so a cleared note leaves nothing behind.
export function save(sessionId: unknown, text: unknown): SaveResult {
  const file = fileFor(sessionId);
  if (!file) return { note: 'Notes need a Claude session.' };
  if (typeof text !== 'string') return { note: 'Notes must be text.' };
  if (text.length > MAX_NOTE_CHARS) return { note: `Notes are limited to ${MAX_NOTE_CHARS} characters.` };
  if (text.trim()) writeFileAtomic(file, text);
  else fs.rmSync(file, { force: true });
  return { ok: true };
}

// sessionId -> the start of its notes, for History's search box.
export function searchable(): Record<string, string> {
  let names: string[];
  try {
    names = fs.readdirSync(notesDir());
  } catch {
    return {};
  }
  const notes: Record<string, string> = {};
  for (const name of names) {
    const sessionId = name.slice(0, -3);
    if (!name.endsWith('.md') || !SESSION_ID.test(sessionId)) continue;
    const text = read(sessionId).slice(0, SEARCH_CHARS);
    if (text.trim()) notes[sessionId] = text;
  }
  return notes;
}

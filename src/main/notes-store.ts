// Her own notes per Claude session: one markdown file each in Petal's userData. Never in a repo, ~/.claude or Claude's input.
// The same folder holds each session's PR notes (<id>.prs.json), so there is one notes store.
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { readJsonOrSetAside, writeFileAtomic, writeJsonAtomic } from './atomic-file';
import { SESSION_ID } from './session-id';
import { PR_NOTE_FIELDS, emptyNotes, type PrNotes } from '../shared/session-prs';

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

// ---------- PR notes: per session, by PR url, three fields each ----------

export const MAX_PR_FIELD_CHARS = 20_000;
const MAX_URL_CHARS = 500;
const SAFE_ID = /^[\w-]{1,128}$/; // a session id or the snapshot fixture's; never a path

const prFileFor = (sessionId: unknown): string | null =>
  (typeof sessionId === 'string' && SAFE_ID.test(sessionId) ? path.join(notesDir(), `${sessionId}.prs.json`) : null);
// Where PR notes lived before this store held them; read once, never deleted.
export const legacyPrFile = (sessionId: string): string => path.join(app.getPath('userData'), 'session-prs', `notes-${sessionId}.json`);

const isPrNotes = (value: unknown): value is PrNotes =>
  Boolean(value) && typeof value === 'object' && PR_NOTE_FIELDS.every((field) => typeof (value as Record<string, unknown>)[field] === 'string');

// The old file is only read: missing or broken, it adds nothing and stays where it is.
function readLegacy(sessionId: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(legacyPrFile(sessionId), 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

const onlyNotes = (data: unknown): Record<string, PrNotes> =>
  (data && typeof data === 'object' && !Array.isArray(data)
    ? Object.fromEntries(Object.entries(data).filter(([, notes]) => isPrNotes(notes))) as Record<string, PrNotes>
    : {});

// First read copies the old session-prs file in; the old file stays, and the new file then always wins.
export function readPrNotes(sessionId: unknown): Record<string, PrNotes> {
  const file = prFileFor(sessionId);
  if (!file) return {};
  const current = readJsonOrSetAside(file);
  if (current !== undefined) return onlyNotes(current);
  const legacy = onlyNotes(readLegacy(sessionId as string));
  if (Object.keys(legacy).length) writeJsonAtomic(file, legacy);
  return legacy;
}

// One PR's notes replace what was there; all three empty removes the PR.
export function savePrNotes(sessionId: unknown, url: unknown, notes: unknown): SaveResult {
  const file = prFileFor(sessionId);
  if (!file) return { note: 'Notes need a Claude session.' };
  if (typeof url !== 'string' || !url || url.length > MAX_URL_CHARS) return { note: 'Notes need a PR.' };
  if (!isPrNotes(notes)) return { note: 'Notes must be text.' };
  if (PR_NOTE_FIELDS.some((field) => notes[field].length > MAX_PR_FIELD_CHARS)) return { note: `Each note is limited to ${MAX_PR_FIELD_CHARS} characters.` };
  const kept: PrNotes = { ...emptyNotes(), ...Object.fromEntries(PR_NOTE_FIELDS.map((field) => [field, notes[field]])) };
  const all = { ...readPrNotes(sessionId), [url]: kept };
  if (PR_NOTE_FIELDS.every((field) => !kept[field].trim())) delete all[url];
  // An empty file is kept while the old one exists, so cleared notes never come back from it.
  if (Object.keys(all).length || fs.existsSync(legacyPrFile(sessionId as string))) writeJsonAtomic(file, all);
  else fs.rmSync(file, { force: true });
  return { ok: true };
}

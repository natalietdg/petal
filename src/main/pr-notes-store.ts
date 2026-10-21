// Her notes per PR (Risks, Env/config, Post-deploy checks): one JSON file per session in <userData>/session-prs.
// Never in a repo, ~/.claude or any prompt Petal sends to Claude.
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { readJsonOrSetAside, writeJsonAtomic } from './atomic-file';
import { PR_NOTE_FIELDS, emptyNotes, type PrNotes } from '../shared/session-prs';

export const MAX_FIELD_CHARS = 20_000;
const MAX_URL_CHARS = 500;
const SAFE_ID = /^[\w-]{1,128}$/; // a session id or the snapshot fixture's; never a path

const fileFor = (sessionId: unknown): string | null =>
  (typeof sessionId === 'string' && SAFE_ID.test(sessionId) ? path.join(app.getPath('userData'), 'session-prs', `notes-${sessionId}.json`) : null);

const isNotes = (value: unknown): value is PrNotes =>
  Boolean(value) && typeof value === 'object' && PR_NOTE_FIELDS.every((field) => typeof (value as Record<string, unknown>)[field] === 'string');

export function read(sessionId: unknown): Record<string, PrNotes> {
  const file = fileFor(sessionId);
  const data = file ? readJsonOrSetAside(file) : undefined;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  return Object.fromEntries(Object.entries(data).filter(([, notes]) => isNotes(notes))) as Record<string, PrNotes>;
}

export type SaveResult = { ok: true } | { note: string };

// One PR's notes replace what was there; all three empty removes the PR, and the file goes with its last PR.
export function save(sessionId: unknown, url: unknown, notes: unknown): SaveResult {
  const file = fileFor(sessionId);
  if (!file) return { note: 'Notes need a Claude session.' };
  if (typeof url !== 'string' || !url || url.length > MAX_URL_CHARS) return { note: 'Notes need a PR.' };
  if (!isNotes(notes)) return { note: 'Notes must be text.' };
  if (PR_NOTE_FIELDS.some((field) => notes[field].length > MAX_FIELD_CHARS)) return { note: `Each note is limited to ${MAX_FIELD_CHARS} characters.` };
  const kept: PrNotes = { ...emptyNotes(), ...Object.fromEntries(PR_NOTE_FIELDS.map((field) => [field, notes[field]])) };
  const all = { ...read(sessionId), [url]: kept };
  if (PR_NOTE_FIELDS.every((field) => !kept[field].trim())) delete all[url];
  if (Object.keys(all).length) writeJsonAtomic(file, all);
  else fs.rmSync(file, { force: true });
  return { ok: true };
}

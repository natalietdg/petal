// Shared pieces of the Workflow dashboard: reading files, grouping sessions by tag or project, label text.
// Read-only everywhere: ~/.claude is only ever read, never written.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import type { ListedSession } from './history';
import type { OrganizerStore } from './session-organizer';
import type { TagsData } from './tags-store';

export const DAY_MS = 24 * 60 * 60 * 1000;
export const WEEK_MS = 7 * DAY_MS;
export const LABEL_CHARS = 40;

export type Tags = Pick<TagsData, 'tags' | 'sessions'>;

export interface GroupKey {
  name: string;
  color: string | null;
}

export interface DashboardInputs {
  sessions: ListedSession[];
  labels: OrganizerStore;
  tags: Tags | null;
  now?: number;
}

const tagsFile = () => path.join(app.getPath('userData'), 'tags.json');

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export function readText(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

export function cap(text: unknown, max = LABEL_CHARS): string {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

export function startOfDay(ms: number): number {
  const day = new Date(ms);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

// Local calendar day, so "3 different days" matches her clock, not UTC.
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---- Grouping: tags when tags.json exists, else the organizer project, else the folder.

export function loadTags(): Tags | null {
  const data = readJson<Partial<TagsData> | null>(tagsFile(), null);
  if (!data || typeof data !== 'object' || typeof data.sessions !== 'object') return null;
  return { tags: data.tags ?? {}, sessions: data.sessions ?? {} };
}

export const titleOf = (session: ListedSession, labels: OrganizerStore): string => labels[session.sessionId]?.title || session.title || 'Untitled session';
function folderName(cwd: string | null): string {
  if (!cwd) return 'Unsorted';
  return path.resolve(cwd) === os.homedir() ? 'Home folder' : path.basename(cwd);
}
export const projectOf = (session: ListedSession, labels: OrganizerStore): string => labels[session.sessionId]?.project || folderName(session.cwd);

// A session can carry several tags, so it can sit in several groups.
export function groupsFor(session: ListedSession, labels: OrganizerStore, tags: Tags | null): GroupKey[] {
  if (!tags) return [{ name: projectOf(session, labels), color: null }];
  const names = tags.sessions[session.sessionId]?.tags ?? [];
  if (!names.length) return [{ name: 'Untagged', color: null }];
  return names.map((name) => ({ name, color: tags.tags[name]?.color ?? null }));
}

export function bucket<T extends object>(map: Map<string, GroupKey & T>, { name, color }: GroupKey, init: () => T): GroupKey & T {
  let entry = map.get(name);
  if (!entry) {
    entry = { name, color, ...init() };
    map.set(name, entry);
  }
  return entry;
}

// Mermaid labels sit in double quotes; these characters would end or confuse them.
export const label = (text: unknown, max = LABEL_CHARS) => cap(text, max).replace(/"/g, '\'').replace(/[<>#;{}]/g, ' ');

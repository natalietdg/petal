// Finder-style session tags in <userData>/tags.json, never under ~/.claude.
// Shape: { tags: { [name]: { color } }, deleted: [names], sessions: { [sessionId]: { tags: [names], manual } } }
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { writeJsonAtomic } from './atomic-file';

export interface SessionTags {
  tags?: string[];
  manual?: boolean;
}

export interface TagsData {
  tags: Record<string, { color: string }>;
  deleted: string[];
  sessions: Record<string, SessionTags>;
}

// Pastel takes on Finder's red, orange, yellow, green, blue, purple, pink, grey.
export const PALETTE = ['#f4a7a3', '#f7c08a', '#f3dc8a', '#a8d8a8', '#9ec5ec', '#c3aee8', '#f2b3d1', '#c4c4cc'];
const NAME_CHARS = 24;

const storeFile = () => path.join(app.getPath('userData'), 'tags.json');

const cleanName = (name: unknown): string => String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_CHARS);
const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function load(): TagsData {
  let data: Partial<TagsData> | null;
  try {
    data = JSON.parse(fs.readFileSync(storeFile(), 'utf8')) as Partial<TagsData> | null;
  } catch {
    data = null;
  }
  const obj = <T extends object>(value: T | undefined): T => (value && typeof value === 'object' && !Array.isArray(value) ? value : ({} as T));
  return {
    tags: obj(data?.tags),
    deleted: Array.isArray(data?.deleted) ? data.deleted : [],
    sessions: obj(data?.sessions),
  };
}

function save(data: TagsData): void {
  writeJsonAtomic(storeFile(), data, 1);
}

// The existing spelling of a tag, so "Auth" and "auth" stay one tag.
const existingName = (data: TagsData, name: string): string | null => Object.keys(data.tags).find((t) => sameName(t, name)) ?? null;
const isDeleted = (data: TagsData, name: string): boolean => data.deleted.some((d) => sameName(d, name));

// Least-used colour first, in palette order, so new tags walk round the palette.
function nextColor(data: TagsData): string {
  const uses = new Map(PALETTE.map((c) => [c, 0]));
  for (const { color } of Object.values(data.tags)) {
    const count = uses.get(color);
    if (count !== undefined) uses.set(color, count + 1);
  }
  return [...uses].sort((a, b) => a[1] - b[1])[0][0];
}

function ensureTag(data: TagsData, name: string): string {
  const found = existingName(data, name);
  if (found) return found;
  data.tags[name] = { color: nextColor(data) };
  return name;
}

const sessionTags = (data: TagsData, sessionId: string): string[] => data.sessions[sessionId]?.tags ?? [];

// Names by how many sessions use them, so the model sees the common ones first.
export function names(data: TagsData = load()): string[] {
  const counts = new Map(Object.keys(data.tags).map((n) => [n, 0]));
  for (const entry of Object.values(data.sessions)) {
    for (const n of entry?.tags ?? []) {
      const count = counts.get(n);
      if (count !== undefined) counts.set(n, count + 1);
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1]).map(([n]) => n);
}

// Her edits: the session becomes manual and the organizer leaves it alone from now on.
export function addTag(sessionId: string, rawName: unknown): TagsData {
  const name = cleanName(rawName);
  if (!sessionId || !name) return load();
  const data = load();
  data.deleted = data.deleted.filter((d) => !sameName(d, name)); // re-adding by hand brings a deleted name back
  const tag = ensureTag(data, name);
  const current = sessionTags(data, sessionId);
  data.sessions[sessionId] = { tags: current.includes(tag) ? current : [...current, tag], manual: true };
  save(data);
  return data;
}

export function removeTag(sessionId: string, name: string): TagsData {
  const data = load();
  if (!sessionId) return data;
  data.sessions[sessionId] = { tags: sessionTags(data, sessionId).filter((t) => t !== name), manual: true };
  save(data);
  return data;
}

// Gone everywhere, and remembered so the organizer never brings it back.
export function deleteTag(name: string): TagsData {
  const data = load();
  delete data.tags[name];
  for (const entry of Object.values(data.sessions)) entry.tags = (entry.tags ?? []).filter((t) => t !== name);
  if (!isDeleted(data, name)) data.deleted.push(name);
  save(data);
  return data;
}

// Renaming onto an existing tag merges the two; the old name counts as deleted.
export function renameTag(from: string, rawTo: unknown): TagsData {
  const to = cleanName(rawTo);
  const data = load();
  if (!to || !data.tags[from] || to === from) return data;
  const target = existingName(data, to) ?? to;
  if (!data.tags[target]) data.tags[target] = data.tags[from];
  delete data.tags[from];
  for (const entry of Object.values(data.sessions)) {
    const tags = entry.tags ?? [];
    if (tags.includes(from)) entry.tags = [...new Set(tags.map((t) => (t === from ? target : t)))];
  }
  data.deleted = data.deleted.filter((d) => !sameName(d, target));
  if (!sameName(from, target) && !isDeleted(data, from)) data.deleted.push(from);
  save(data);
  return data;
}

// The organizer's suggestion: never touches manual sessions, never revives a deleted name.
export function applyOrganizerTags(sessionId: string, suggested: unknown[] | null | undefined): string[] {
  const data = load();
  if (data.sessions[sessionId]?.manual) return sessionTags(data, sessionId);
  const tags: string[] = [];
  for (const raw of suggested ?? []) {
    const name = cleanName(raw);
    if (!name || isDeleted(data, name)) continue;
    const tag = ensureTag(data, name);
    if (!tags.includes(tag)) tags.push(tag);
  }
  data.sessions[sessionId] = { tags, manual: false }; // an empty list still marks it as tagged
  save(data);
  return tags;
}

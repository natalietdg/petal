// Which headless child session belongs to which parent, kept in <userData>/subsession-links.json.
// The process tree that proves the link is gone once the child exits, so the link is written down the first time it is seen.
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { writeJsonAtomic } from './atomic-file';

export interface SubsessionLink {
  childId: string;
  parentId: string;
  cwd: string; // the child's folder, to find its transcript after it exits
  name: string;
  at: number; // when the link was first seen
}

export const MAX_LINKS = 500;

const storeFile = () => path.join(app.getPath('userData'), 'subsession-links.json');

const isLink = (value: unknown): value is SubsessionLink => {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return typeof r.childId === 'string' && typeof r.parentId === 'string' && typeof r.cwd === 'string' && typeof r.name === 'string' && typeof r.at === 'number';
};

export function load(): SubsessionLink[] {
  try {
    const data: unknown = JSON.parse(fs.readFileSync(storeFile(), 'utf8'));
    return Array.isArray(data) ? data.filter(isLink) : [];
  } catch {
    return [];
  }
}

// Newest first; a child is linked once, the first parent seen wins.
export function add(links: readonly SubsessionLink[]): SubsessionLink[] {
  const current = load();
  const known = new Set(current.map((l) => l.childId));
  const fresh = links.filter((l) => !known.has(l.childId));
  if (!fresh.length) return current;
  const next = [...fresh, ...current].slice(0, MAX_LINKS);
  writeJsonAtomic(storeFile(), next, 1);
  return next;
}

export const parentOf = (links: readonly SubsessionLink[], childId: string): string | null => links.find((l) => l.childId === childId)?.parentId ?? null;
export const childrenOf = (links: readonly SubsessionLink[], parentId: string): SubsessionLink[] => links.filter((l) => l.parentId === parentId);

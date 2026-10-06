// Claude sessions closed from the Sessions panel, newest first, kept in <userData>/closed.json so they can be reopened.
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { writeJsonAtomic } from './atomic-file';

export interface ClosedSession {
  sessionId: string;
  title: string;
  cwd: string;
  closedAt: number;
}

export const MAX_CLOSED = 20;

const storeFile = () => path.join(app.getPath('userData'), 'closed.json');

const isClosed = (c: unknown): c is ClosedSession => {
  if (typeof c !== 'object' || c === null) return false;
  const r = c as Record<string, unknown>;
  return typeof r.sessionId === 'string' && typeof r.title === 'string' && typeof r.cwd === 'string' && typeof r.closedAt === 'number';
};

export function load(): ClosedSession[] {
  try {
    const data: unknown = JSON.parse(fs.readFileSync(storeFile(), 'utf8'));
    return Array.isArray(data) ? data.filter(isClosed) : [];
  } catch {
    return [];
  }
}

// A session closed again moves to the top instead of appearing twice.
export function add(entry: ClosedSession): ClosedSession[] {
  const next = [entry, ...load().filter((c) => c.sessionId !== entry.sessionId)].slice(0, MAX_CLOSED);
  writeJsonAtomic(storeFile(), next, 1);
  return next;
}

// What the panel offers to reopen: anything running again is left out.
export const reopenable = (liveIds: Iterable<string>): ClosedSession[] => {
  const live = new Set(liveIds);
  return load().filter((c) => !live.has(c.sessionId));
};

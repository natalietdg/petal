// Workflow, Time tab: active hours this past week per tag or project, and work that recurs across days.
import fs from 'node:fs';
import { bucket, dayKey, groupsFor, projectOf, titleOf, WEEK_MS, type DashboardInputs, type GroupKey } from './workflow-common';

export const IDLE_GAP_MS = 15 * 60 * 1000; // a longer pause counts as stepping away, not working
const MAX_SCAN_BYTES = 200 * 1024 * 1024; // bigger logs are skipped rather than read
const READ_CHUNK_BYTES = 1024 * 1024;
const RECURRING_DAYS = 3;
const HOUR_MS = 3_600_000;

const STAMP = /"timestamp":"(\d{4}-\d{2}-\d{2}T[^"]{4,30})"/g;
const OVERLAP = 64; // longer than any whole match, so a stamp split across chunks is still found
const stampCache = new Map<string, { mtimeMs: number; size: number; stamps: number[] }>();

// Regex over raw chunks: no JSON.parse of huge tool results. Escaped quotes inside strings never match.
async function readStamps(file: string): Promise<number[]> {
  const stamps: number[] = [];
  let carry = '';
  for await (const chunk of fs.createReadStream(file, { encoding: 'utf8', highWaterMark: READ_CHUNK_BYTES })) {
    const text = carry + String(chunk);
    for (const m of text.matchAll(STAMP)) {
      if (m.index + m[0].length <= carry.length) continue; // already counted in the previous chunk
      const at = Date.parse(m[1]);
      if (!Number.isNaN(at)) stamps.push(at);
    }
    carry = text.slice(-OVERLAP);
  }
  return stamps.sort((a, b) => a - b);
}

// Cached by mtime and size; returns null for logs too big to scan.
async function stampsFor(file: string): Promise<number[] | null> {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }
  if (stat.size > MAX_SCAN_BYTES) return null;
  const hit = stampCache.get(file);
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.stamps;
  const stamps = await readStamps(file);
  stampCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, stamps });
  return stamps;
}

// Active time = the sum of gaps under 15 minutes between consecutive timestamps.
export function activity(stamps: number[], since: number): { ms: number; days: Set<string> } {
  const recent = stamps.filter((t) => t >= since);
  let ms = 0;
  for (let i = 1; i < recent.length; i += 1) {
    const gap = recent[i] - recent[i - 1];
    if (gap < IDLE_GAP_MS) ms += gap;
  }
  return { ms, days: new Set(recent.map(dayKey)) };
}

const hours = (ms: number) => Math.round((ms / HOUR_MS) * 10) / 10;

export interface TimeGroup extends GroupKey {
  sessions: number;
  activeMs: number;
  activeHours: number;
}

export interface TimeData {
  since: number;
  groupedBy: 'tag' | 'project';
  sessions: number;
  skipped: number;
  totalMs: number;
  totalHours: number;
  groups: TimeGroup[];
  recurring: { kind: string; name: string; days: number }[];
}

export async function timeData({ sessions, labels, tags, now = Date.now() }: DashboardInputs): Promise<TimeData> {
  const since = now - WEEK_MS;
  const groups = new Map<string, GroupKey & { sessions: number; activeMs: number }>();
  const seenOn = new Map<string, Set<string>>(); // "project:x" or "title:y" -> Set of days
  let totalMs = 0;
  let counted = 0;
  let skipped = 0;
  for (const session of sessions.filter((s) => s.lastAt >= since)) {
    const stamps = await stampsFor(session.file); // one file at a time keeps memory flat
    if (!stamps) { skipped += 1; continue; }
    const { ms, days } = activity(stamps, since);
    if (!days.size) continue;
    counted += 1;
    totalMs += ms;
    for (const group of groupsFor(session, labels, tags)) {
      const entry = bucket(groups, group, () => ({ sessions: 0, activeMs: 0 }));
      entry.sessions += 1;
      entry.activeMs += ms;
    }
    const project = projectOf(session, labels);
    const title = titleOf(session, labels);
    for (const key of [`project:${project}`, ...(title !== project ? [`title:${title}`] : [])]) {
      let seen = seenOn.get(key);
      if (!seen) {
        seen = new Set();
        seenOn.set(key, seen);
      }
      for (const day of days) seen.add(day);
    }
  }
  const recurring = [...seenOn]
    .filter(([, days]) => days.size >= RECURRING_DAYS)
    .map(([key, days]) => ({ kind: key.slice(0, key.indexOf(':')), name: key.slice(key.indexOf(':') + 1), days: days.size }))
    .sort((a, b) => b.days - a.days || a.name.localeCompare(b.name));
  return {
    since,
    groupedBy: tags ? 'tag' : 'project',
    sessions: counted,
    skipped,
    totalMs,
    totalHours: hours(totalMs),
    groups: [...groups.values()]
      .map((g) => ({ ...g, activeHours: hours(g.activeMs) }))
      .sort((a, b) => b.activeMs - a.activeMs || b.sessions - a.sessions),
    recurring,
  };
}

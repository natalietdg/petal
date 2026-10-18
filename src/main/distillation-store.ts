// Per project: each test-loop round's distillation in <repo>/.petal/distillation.jsonl, so it survives restarts.
// Written only where a loop was started (.petal/test-criteria.md exists); every new Course is also an Activity item.
import fs from 'node:fs';
import path from 'node:path';
import { ensureSelfIgnore } from './factory-store';
import { writeFileDurable } from './atomic-file';
import { recordActivity } from './activity-feed';
import { repoBranch } from './repo-label';
import { sessionTitleFor } from './session-title';
import { CRITERIA_PATH } from '../shared/test-loop';
import { loadTasks } from './tasks-store';
import { taskIdAt } from './testing-tasks';
import {
  COURSE_WORDS, DISTILL_FILE_CAP, DISTILL_PATH, RECORDS_CAP, courseText, mergeRecords, parseJsonl, recordsFromReplies, toJsonl,
  type DistillRecord, type ReplyLike,
} from '../shared/distillation';

const fileOf = (root: string): string => path.join(root, ...DISTILL_PATH.split('/'));
const loopPrepared = (root: string): boolean => fs.existsSync(path.join(root, ...CRITERIA_PATH.split('/')));

// Read only, capped; a link (a cloned repo's trick) or a missing file reads as none.
export function readDistillation(root: string): DistillRecord[] {
  const file = fileOf(root);
  let fd: number;
  try {
    if (fs.lstatSync(file).isSymbolicLink()) return [];
    fd = fs.openSync(file, 'r');
  } catch {
    return [];
  }
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - DISTILL_FILE_CAP); // the newest records are at the end
    const buffer = Buffer.alloc(size - start);
    const read = fs.readSync(fd, buffer, 0, buffer.length, start);
    const text = buffer.toString('utf8', 0, read);
    return parseJsonl(start ? text.slice(text.indexOf('\n') + 1) : text);
  } finally {
    fs.closeSync(fd);
  }
}

const sameRecord = (a: DistillRecord, b: DistillRecord): boolean => JSON.stringify(a) === JSON.stringify(b);

// A stored record keeps the task it was filed under, or none.
function keepTask(record: DistillRecord, stored: DistillRecord): DistillRecord {
  const { taskId: _dropped, ...rest } = record;
  return stored.taskId ? { ...rest, taskId: stored.taskId } : rest;
}

// Saves records not stored yet (or changed), newest RECORDS_CAP kept; returns the ones that were new.
export function saveDistillation(root: string, records: readonly DistillRecord[]): DistillRecord[] {
  if (!records.length || !loopPrepared(root)) return [];
  const stored = readDistillation(root);
  const known = new Map(stored.map((r) => [r.id, r]));
  const incoming = records.map((r) => { const old = known.get(r.id); return old ? keepTask(r, old) : r; });
  const fresh = incoming.filter((r) => !known.has(r.id));
  const changed = incoming.filter((r) => known.has(r.id) && !sameRecord(known.get(r.id) as DistillRecord, r));
  if (!fresh.length && !changed.length) return [];
  const merged = mergeRecords(stored, incoming).slice(-RECORDS_CAP);
  const dir = path.dirname(fileOf(root));
  ensureSelfIgnore(dir, root);
  writeFileDurable(fileOf(root), toJsonl(merged), undefined, { within: root });
  for (const record of fresh) recordCourse(root, record);
  return fresh;
}

// The Activity feed's item for a course; the same id if it is read again.
function recordCourse(root: string, record: DistillRecord): void {
  const repo = path.basename(root);
  const asks = [...record.questions.filter((q) => q.needsYou).map((q) => q.q), ...record.threads.filter((t) => t.needsYou).map((t) => t.question)].map((q) => `Needs you: ${q}`);
  const open = record.threads.filter((t) => !t.needsYou).map((t) => `Open thread: ${t.question}`);
  recordActivity({
    id: `distill:${record.id}`, kind: 'test', at: record.at || Date.now(),
    sessionId: record.sessionId, sessionName: record.sessionId ? sessionTitleFor(record.sessionId) : null, branch: repoBranch(root), repo,
    text: courseText(record, repo), detail: [`Course: ${COURSE_WORDS[record.course]}`, ...asks, ...open],
  });
}

// A session's replies (newest first): their complete distillations, stored. Never throws; a write problem is logged.
export function captureReplies(root: string | null, replies: readonly ReplyLike[], sessionId: string | null): DistillRecord[] {
  if (!root || !replies.length) return [];
  try {
    const records = recordsFromReplies(replies, sessionId);
    if (!records.length) return [];
    const { tasks } = loadTasks(root);
    return saveDistillation(root, records.map((r) => { const taskId = taskIdAt(root, sessionId, r.at, tasks); return taskId ? { ...r, taskId } : r; }));
  } catch (error) {
    console.error('[petal] saving distillation failed:', error);
    return [];
  }
}

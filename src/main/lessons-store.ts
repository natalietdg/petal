// Lessons Petal learned from sessions, in <userData>/lessons.json, and the one way they reach a CLAUDE.md:
// she opens a preview (a diff), then confirms it. Nothing here writes a CLAUDE.md on its own.
// Both CLAUDE.md files are read and written only while she allows Petal to read her Claude folder.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import { allowedClaudeHome, claudeFolderAllowed } from './claude-folder';
import * as configStore from './config-store';
import { folderFixture, isSnapshotRun, snapshotOutDir } from './snapshot-mode';
import { readJsonOrSetAside, writeFileDurable, writeJsonAtomic } from './atomic-file';
import {
  appendLesson, diffLines, isSameRule, lessonLine, ruleLines, similarPairs,
  type Lesson, type LessonEditResult, type LessonInput, type LessonPreviewResult, type LessonsList, type LessonTarget,
} from '../shared/lessons';

const MAX_KEPT = 500; // newest kept, every status, so dismissed ones still block repeats
const MAX_CLAUDE_MD_BYTES = 1024 * 1024;
const PREVIEW_MS = 10 * 60 * 1000;
const EVIDENCE_CHARS = 600;

const lessonsFile = () => path.join(app.getPath('userData'), 'lessons.json');

export function loadLessons(): Lesson[] {
  const data = readJsonOrSetAside(lessonsFile()) as { lessons?: unknown } | undefined;
  return Array.isArray(data?.lessons) ? (data.lessons as Lesson[]).filter((l) => l && typeof l.id === 'string' && typeof l.rule === 'string') : [];
}

function saveLessons(lessons: Lesson[]): void {
  const kept = [...lessons].sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX_KEPT);
  writeJsonAtomic(lessonsFile(), { version: 1, lessons: kept }, 2);
}

// ---- The two CLAUDE.md files: the Claude folder's, and the session folder's.

// The file for a target; null when she hasn't allowed the folder, or a project lesson has no folder.
const inside = (child: string, root: string): boolean => path.resolve(child).startsWith(path.resolve(root) + path.sep);
// A snapshot's project lives in its own folder or the system temp folder; a real repo is never there.
const realOr = (dir: string): string => { try { return fs.realpathSync(dir); } catch { return dir; } };
const scratchFolder = (cwd: string): boolean => [snapshotOutDir(), os.tmpdir()].some((root) => inside(cwd, root) || inside(cwd, realOr(root)));

// Snapshot runs touch only their stand-in folder and scratch projects, never a real CLAUDE.md.
export function claudeMdPath(target: LessonTarget, cwd: string | null): string | null {
  if (target === 'global') {
    const home = allowedClaudeHome();
    if (isSnapshotRun() && !folderFixture.home) return null;
    return home ? path.join(home, 'CLAUDE.md') : null;
  }
  if (!claudeFolderAllowed() || !cwd || !path.isAbsolute(cwd)) return null;
  if (isSnapshotRun() && !scratchFolder(cwd)) return null;
  return path.join(cwd, 'CLAUDE.md');
}

// '' when missing, too big or unreadable; a symlink is followed, as an editor would.
function readClaudeMd(file: string | null): string {
  if (!file) return '';
  try {
    if (fs.statSync(file).size > MAX_CLAUDE_MD_BYTES) return '';
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

const knownLines = (cwd: string | null): string[] =>
  [claudeMdPath('global', cwd), claudeMdPath('project', cwd)].flatMap((file) => ruleLines(readClaudeMd(file)));

// Keeps the lessons not already in either CLAUDE.md, in an earlier lesson (any status) or earlier in this batch.
export function addLessons(inputs: readonly LessonInput[], { sessionId, cwd, now = new Date() }: { sessionId: string; cwd: string | null; now?: Date }): Lesson[] {
  const all = loadLessons();
  const known = knownLines(cwd);
  const added: Lesson[] = [];
  for (const input of inputs) {
    const seen = (rule: string) => isSameRule(input.rule, rule);
    if (known.some(seen) || all.some((l) => seen(l.rule)) || added.some((l) => seen(l.rule))) continue;
    added.push({ ...input, id: crypto.randomUUID(), sessionIds: [sessionId], cwd, at: now.toISOString(), status: 'new' });
  }
  if (added.length) saveLessons([...all, ...added]);
  return added;
}

export function listLessons(): LessonsList {
  const fresh = loadLessons().filter((l) => l.status === 'new').sort((a, b) => b.at.localeCompare(a.at));
  return { allowed: claudeFolderAllowed(), learn: configStore.load().lessons.learn, lessons: fresh, similar: similarPairs(fresh) };
}

function update(id: string, change: (lesson: Lesson, all: Lesson[]) => string | null): LessonEditResult {
  const all = loadLessons();
  const lesson = all.find((l) => l.id === id);
  if (!lesson) return { error: 'That lesson is gone. It may have been added or dismissed in another window.' };
  const error = change(lesson, all);
  if (error) return { error };
  saveLessons(all);
  return { ok: true };
}

export const dismissLesson = (id: string): LessonEditResult => update(id, (lesson) => { lesson.status = 'dismissed'; return null; });

// fold joins keep: its sessions and evidence carry over, and it stays on file as merged so it never comes back.
export function mergeLessons(keepId: string, foldId: string): LessonEditResult {
  if (keepId === foldId) return { error: 'Pick two different lessons.' };
  return update(keepId, (keep, all) => {
    const fold = all.find((l) => l.id === foldId && l.status === 'new');
    if (!fold) return 'The other lesson is gone.';
    keep.sessionIds = [...new Set([...keep.sessionIds, ...fold.sessionIds])];
    keep.evidence = [keep.evidence, fold.evidence].filter(Boolean).join(' · ').slice(0, EVIDENCE_CHARS);
    keep.cwd ??= fold.cwd;
    fold.status = 'merged';
    return null;
  });
}

// ---- Add to CLAUDE.md: preview first, then a confirm carrying the preview's token.

interface Pending { id: string; target: LessonTarget; file: string; hash: string; until: number }
const pending = new Map<string, Pending>();
const hashOf = (text: string): string => crypto.createHash('sha256').update(text).digest('hex');

export function previewAdd(id: string, target: LessonTarget, now = Date.now()): LessonPreviewResult {
  if (!claudeFolderAllowed()) return { error: 'Allow Petal to read your Claude folder first.' };
  const lesson = loadLessons().find((l) => l.id === id && l.status === 'new');
  if (!lesson) return { error: 'That lesson is gone.' };
  const file = claudeMdPath(target, lesson.cwd);
  if (!file) return { error: 'This lesson has no project folder, so it can only go in your global CLAUDE.md.' };
  const before = readClaudeMd(file);
  if (ruleLines(before).some((line) => isSameRule(lesson.rule, line))) return { error: 'That CLAUDE.md already says this.' };
  const appended = appendLesson(before, lessonLine(lesson));
  for (const [token, p] of pending) if (p.until < now) pending.delete(token);
  const token = crypto.randomUUID();
  pending.set(token, { id, target, file, hash: hashOf(before), until: now + PREVIEW_MS });
  return { token, file, created: !fs.existsSync(file), lines: diffLines(before, appended) };
}

// Writes only what the preview showed: the same lesson, the same file, unchanged since. A project file stays inside its folder.
export function confirmAdd(token: string, now = Date.now()): LessonEditResult {
  const p = pending.get(token);
  pending.delete(token);
  if (!p || p.until < now) return { error: 'Open the preview again before adding.' };
  if (!claudeFolderAllowed()) return { error: 'Allow Petal to read your Claude folder first.' };
  const lesson = loadLessons().find((l) => l.id === p.id && l.status === 'new');
  if (!lesson) return { error: 'That lesson is gone.' };
  const before = readClaudeMd(p.file);
  if (hashOf(before) !== p.hash) return { error: 'That CLAUDE.md changed since the preview. Open the preview again.' };
  const mode = fs.existsSync(p.file) ? fs.statSync(p.file).mode & 0o7777 : undefined;
  try {
    writeFileDurable(p.file, appendLesson(before, lessonLine(lesson)).text, mode, p.target === 'project' && lesson.cwd ? { within: lesson.cwd } : {});
  } catch (error) {
    return { error: String((error as Error).message ?? error) };
  }
  return update(p.id, (l) => { l.status = 'added'; l.addedTo = p.target; return null; });
}

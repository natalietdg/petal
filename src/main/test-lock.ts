/// <reference types="vite/client" />
// The test lock on disk: the hook script and its entry in the project's .claude/settings.local.json (never ~/.claude),
// the manifest the hook reads, and the integrity check that restores a locked file another Claude session changed.
// Approved copies are kept in <userData>/testing/locked/<project-hash>/, never in the repo.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import lockScript from '../../resources/hooks/petal-test-lock.mjs?raw';
import { writeFileDurable } from './atomic-file';
import { ensureSelfIgnore } from './factory-store';
import { projectHash, testingDir } from './testing-store';
import { LOCK_SCRIPT, hasLockHook, mergeLockHook, unmergeLockHook } from '../shared/lock-settings';
import {
  LEGACY_LOCKED_COPIES, LOCK_FILE, SUITE_PREFIX, emptyManifest, integrityStep, lastToucher, lockedFiles, readManifest,
  type LockInputs, type LockManifest, type RestoredFlag,
} from '../shared/test-lock';
import type { AgentNames } from '../shared/agent-names';

const RESTORED_KEPT = 30;

const at = (root: string, rel: string): string => path.join(root, ...rel.split('/'));
const changedAt = (root: string, rel: string): number => { try { return fs.statSync(at(root, rel)).mtimeMs; } catch { return 0; } };
const settingsFile = (root: string): string => path.join(root, '.claude', 'settings.local.json');

export function loadManifest(root: string): LockManifest {
  try {
    return readManifest(JSON.parse(fs.readFileSync(at(root, LOCK_FILE), 'utf8')));
  } catch {
    return emptyManifest();
  }
}

function saveManifest(root: string, manifest: LockManifest): void {
  fs.mkdirSync(path.join(root, '.petal'), { recursive: true });
  ensureSelfIgnore(path.join(root, '.petal'), root);
  writeFileDurable(at(root, LOCK_FILE), `${JSON.stringify(manifest, null, 2)}\n`, undefined, { within: root });
}

// Read only when it parses; a file she broke is never written over.
function readSettings(root: string): { ok: true; value: unknown } | { ok: false } {
  const file = settingsFile(root);
  if (!fs.existsSync(file)) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    return { ok: false };
  }
}

export const lockHookPresent = (root: string): boolean => { const s = readSettings(root); return s.ok && hasLockHook(s.value); };

// Turns the lock on or off for the project; null when done, else why not.
export function setLock(root: string, on: boolean): string | null {
  const settings = readSettings(root);
  if (!settings.ok) return 'This repo’s Claude settings.local.json isn’t valid JSON. Fix it first; Petal won’t write over it.';
  const next = on ? mergeLockHook(settings.value) : unmergeLockHook(settings.value);
  if (on) {
    fs.mkdirSync(path.join(root, '.petal'), { recursive: true });
    ensureSelfIgnore(path.join(root, '.petal'), root);
    writeFileDurable(at(root, LOCK_SCRIPT), lockScript, undefined, { within: root });
  }
  if (on || fs.existsSync(settingsFile(root))) {
    fs.mkdirSync(path.dirname(settingsFile(root)), { recursive: true });
    writeFileDurable(settingsFile(root), `${JSON.stringify(next, null, 2)}\n`, undefined, { within: root });
  }
  saveManifest(root, { ...loadManifest(root), enabled: on });
  return null;
}

const sha = (bytes: Buffer): string => crypto.createHash('sha256').update(bytes).digest('hex');

const hashOf = (file: string): string | null => {
  try {
    return sha(fs.readFileSync(file));
  } catch {
    return null;
  }
};

// Approved copies live in Petal's storage, keyed like the testing store, so no test runner in the repo finds them.
export const lockedCopiesDir = (root: string, dir = testingDir()): string => path.join(dir, 'locked', projectHash(root));
const copyOf = (root: string, rel: string): string => path.join(lockedCopiesDir(root), ...rel.split('/'));

// A plain file's bytes; null for a link, a folder or nothing there.
function plainFile(file: string): Buffer | null {
  try {
    return fs.lstatSync(file).isFile() ? fs.readFileSync(file) : null;
  } catch {
    return null;
  }
}

function writeCopy(root: string, rel: string, bytes: Buffer): void {
  const copy = copyOf(root, rel);
  fs.mkdirSync(path.dirname(copy), { recursive: true });
  writeFileDurable(copy, bytes, undefined, { within: lockedCopiesDir(root) });
}

// The hash of the copy now kept; null when the file isn't a plain file.
function keepCopy(root: string, rel: string): string | null {
  const bytes = plainFile(at(root, rel));
  if (!bytes) return null;
  writeCopy(root, rel, bytes);
  return sha(bytes);
}

function restoreCopy(root: string, rel: string): boolean {
  const bytes = plainFile(copyOf(root, rel));
  if (!bytes) return false;
  fs.mkdirSync(path.dirname(at(root, rel)), { recursive: true });
  writeFileDurable(at(root, rel), bytes, undefined, { within: root });
  return true;
}

// One copy from the old in-repo folder: written to Petal's storage, checked by hash, then deleted from the repo.
// A copy already there wins unless this one is the approved one; when neither is, both are kept.
function moveLegacyCopy(root: string, rel: string, from: string, approvedHash: string | undefined): void {
  const bytes = plainFile(from);
  if (!bytes) return;
  const hash = sha(bytes);
  const there = plainFile(copyOf(root, rel));
  const thereHash = there ? sha(there) : null;
  const write = thereHash === null || (thereHash !== hash && hash === approvedHash);
  const superseded = thereHash !== null && thereHash !== hash && thereHash === approvedHash;
  if (!write && !superseded && thereHash !== hash) return; // two different copies, neither approved: both kept
  if (write) {
    writeCopy(root, rel, bytes);
    if (hashOf(copyOf(root, rel)) !== hash) return; // didn't land: the original stays
  }
  fs.rmSync(from);
}

// Older builds kept copies in <repo>/.petal/locked, where jest and vitest ran them. Moves each out; anything that
// can't move (a link, a failed write) stays, and so does the folder holding it.
export function migrateLegacyCopies(root: string, approved: Record<string, string>): void {
  const legacy = at(root, LEGACY_LOCKED_COPIES);
  try {
    if (!fs.lstatSync(legacy).isDirectory()) return;
  } catch {
    return;
  }
  const walk = (dir: string, prefix: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const from = path.join(dir, entry.name);
      const rel = `${prefix}${entry.name}`;
      try {
        if (entry.isDirectory()) { walk(from, `${rel}/`); if (fs.readdirSync(from).length === 0) fs.rmdirSync(from); }
        else if (entry.isFile()) moveLegacyCopy(root, rel, from, approved[rel]);
      } catch (error) {
        console.warn(`[petal] locked copy ${rel} stays in ${LEGACY_LOCKED_COPIES}:`, error);
      }
    }
  };
  walk(legacy, '');
  try { fs.rmdirSync(legacy); } catch { /* something stayed behind */ }
}

const isUnconfirmed = (flag: RestoredFlag): boolean => flag.by === 'unconfirmed';

// With the lock on: refreshes what is locked and who the agents are, then checks every locked test file against its
// approved copy. Suite files are checked by the suite reader instead. Returns the manifest as it now stands.
export function refreshLock(root: string, inputs: Omit<LockInputs, 'root'>, names: AgentNames): LockManifest {
  const before = loadManifest(root);
  migrateLegacyCopies(root, before.approved);
  if (!before.enabled) return before;
  const owners = lockedFiles({ root, ...inputs });
  const sessions = Object.fromEntries(inputs.agents.map((a) => [a.sessionId, { role: a.role, taskId: a.taskId }]));
  const approved = { ...before.approved };
  const restored: RestoredFlag[] = before.restored.filter((f) => !isUnconfirmed(f));
  const waiting = new Map(before.restored.filter(isUnconfirmed).map((f) => [f.path, f]));
  const unconfirmed: RestoredFlag[] = [];
  for (const rel of Object.keys(owners)) {
    if (rel.startsWith(SUITE_PREFIX)) continue;
    const step = integrityStep(rel, hashOf(at(root, rel)), approved[rel], lastToucher(inputs.touches, rel, root, changedAt(root, rel)), sessions);
    const kept = step.kind === 'approve' ? keepCopy(root, rel) : null;
    if (kept) approved[rel] = kept;
    if (step.kind === 'restore' && restoreCopy(root, rel)) restored.push({ path: rel, at: Date.now(), taskId: owners[rel] ?? null, by: step.by });
    if (step.kind === 'unconfirmed') unconfirmed.push(waiting.get(rel) ?? { path: rel, at: Date.now(), taskId: owners[rel] ?? null, by: 'unconfirmed' });
  }
  // A question drops once the file is back to its approved copy or a session's touch settled it.
  const flags = [...restored.slice(-RESTORED_KEPT), ...unconfirmed];
  const next: LockManifest = { ...before, lockedPaths: Object.keys(owners).sort(), owners, sessions, names, approved, restored: flags };
  if (JSON.stringify(next) !== JSON.stringify(before)) saveManifest(root, next);
  return next;
}

// Her answer to "changed outside Claude": Keep approves the file as it is now, Restore puts the locked copy back.
// Null when done, else why not.
export function resolveUnconfirmed(root: string, rel: string, keep: boolean): string | null {
  const manifest = loadManifest(root);
  if (!manifest.restored.some((f) => isUnconfirmed(f) && f.path === rel)) return 'That change was already handled.';
  migrateLegacyCopies(root, manifest.approved);
  const approved = { ...manifest.approved };
  if (keep) {
    if (hashOf(at(root, rel)) === null) delete approved[rel]; // deleted on purpose: nothing left to lock
    else {
      const kept = keepCopy(root, rel);
      if (!kept) return 'That file is a link or a folder now, so Petal can’t keep a copy of it.';
      approved[rel] = kept;
    }
  } else if (!restoreCopy(root, rel)) {
    return 'The locked copy is missing, so there is nothing to restore.';
  }
  saveManifest(root, { ...manifest, approved, restored: manifest.restored.filter((f) => !(isUnconfirmed(f) && f.path === rel)) });
  return null;
}

// Clears the task's "Restored" lines; questions still waiting for Keep or Restore stay.
export function dismissRestored(root: string, taskId: string): void {
  const manifest = loadManifest(root);
  saveManifest(root, { ...manifest, restored: manifest.restored.filter((f) => f.taskId !== taskId || isUnconfirmed(f)) });
}

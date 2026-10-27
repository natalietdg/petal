/// <reference types="vite/client" />
// The test lock on disk: the manifest and refusals in ~/.petal/repos/<repoKey>/, the one hook script at
// ~/.petal/test-lock.mjs, and its one entry in her user-level ~/.claude/settings.json, added when she turns a lock on.
// The integrity check restores a locked test a Claude session deleted or weakened. Nothing is written in the repo except
// that restore. Approved copies are kept in <userData>/testing/locked/<project-hash>/.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import lockScript from '../../resources/hooks/petal-test-lock.mjs?raw';
import { writeFileDurable } from './atomic-file';
import { petalDir, prepareRepoDir, repoDir, reposRoot } from './petal-home';
import { projectHash, testingDir } from './testing-store';
import { LOCK_SCRIPT_NAME, hasLockHook, lockHookStale, mergeLockHook, unmergeLockHook } from '../shared/lock-settings';
import {
  LEGACY_LOCKED_COPIES, LOCK_NAME, REFUSALS_NAME, emptyManifest, integrityStep, isLockable, lastToucher, lockedFiles, mainRefusals, readManifest, weakens,
  type LockInputs, type LockManifest, type LockRefusal, type RestoredFlag,
} from '../shared/test-lock';
import type { AgentNames, AgentRole } from '../shared/agent-names';

const RESTORED_KEPT = 30;

const at = (root: string, rel: string): string => path.join(root, ...rel.split('/'));
const changedAt = (root: string, rel: string): number => { try { return fs.statSync(at(root, rel)).mtimeMs; } catch { return 0; } };
export const lockScriptFile = (): string => path.join(petalDir(), LOCK_SCRIPT_NAME);
const userSettings = (claudeDir: string): string => path.join(claudeDir, 'settings.json');

const readManifestFile = (file: string): LockManifest => {
  try {
    return readManifest(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return emptyManifest();
  }
};

export const loadManifest = (root: string): LockManifest => readManifestFile(path.join(repoDir(root), LOCK_NAME));

function saveManifest(root: string, manifest: LockManifest): void {
  const dir = prepareRepoDir(root);
  writeFileDurable(path.join(dir, LOCK_NAME), `${JSON.stringify(manifest, null, 2)}\n`, undefined, { within: dir });
}

// Read only when it parses; a file she broke is never written over.
function readSettings(file: string): { ok: true; value: unknown } | { ok: false } {
  if (!fs.existsSync(file)) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    return { ok: false };
  }
}

// The user-level entry is there. claudeDir null: her Claude folder isn't allowed, so nothing is read.
export const lockHookPresent = (claudeDir: string | null): boolean => {
  if (!claudeDir) return false;
  const s = readSettings(userSettings(claudeDir));
  return s.ok && hasLockHook(s.value);
};

// Any repo with its lock on, other than this one.
function otherLockOn(root: string): boolean {
  let keys: string[];
  try { keys = fs.readdirSync(reposRoot()); } catch { return false; }
  const own = path.basename(repoDir(root));
  return keys.some((key) => key !== own && readManifestFile(path.join(reposRoot(), key, LOCK_NAME)).enabled);
}

function writeScript(): void {
  const file = lockScriptFile();
  let current = '';
  try { current = fs.readFileSync(file, 'utf8'); } catch { /* missing: written below */ }
  if (current === lockScript) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeFileDurable(file, lockScript, undefined, { within: petalDir() });
}

// Turns the lock on or off for the project; null when done, else why not. On: the script goes in ~/.petal and the one
// hook entry in her ~/.claude/settings.json. Off: the entry goes once no other repo has its lock on.
export function setLock(root: string, on: boolean, claudeDir: string | null): string | null {
  if (!claudeDir) return 'Petal isn’t reading your Claude folder, so it can’t add the lock’s hook. Allow it under Customize › Get started.';
  const file = userSettings(claudeDir);
  const settings = readSettings(file);
  if (!settings.ok) return 'Your ~/.claude/settings.json isn’t valid JSON. Fix it first; Petal won’t write over it.';
  if (on) {
    writeScript();
    const next = mergeLockHook(settings.value, lockScriptFile());
    if (next !== settings.value) {
      fs.mkdirSync(claudeDir, { recursive: true });
      writeFileDurable(file, `${JSON.stringify(next, null, 2)}\n`);
    }
  } else if (!otherLockOn(root) && hasLockHook(settings.value)) {
    writeFileDurable(file, `${JSON.stringify(unmergeLockHook(settings.value), null, 2)}\n`);
  }
  saveManifest(root, { ...loadManifest(root), enabled: on });
  return null;
}

// A newer build: the bundled script replaces the one in ~/.petal, and a stale entry gets today's command. Only where
// she already turned the lock on through the user-level entry; a lock from an older build waits for her to turn it on again.
export function upgradeLock(root: string, claudeDir: string | null): void {
  if (!claudeDir || !loadManifest(root).enabled) return;
  const file = userSettings(claudeDir);
  const settings = readSettings(file);
  if (!settings.ok || !hasLockHook(settings.value)) return;
  writeScript();
  if (lockHookStale(settings.value, lockScriptFile())) writeFileDurable(file, `${JSON.stringify(mergeLockHook(settings.value, lockScriptFile()), null, 2)}\n`);
}

// Refusals of sessions that aren't agents, since she last dismissed them.
export function lockRefusals(root: string, manifest: LockManifest): LockRefusal[] {
  try {
    return mainRefusals(fs.readFileSync(path.join(repoDir(root), REFUSALS_NAME), 'utf8'), manifest, root);
  } catch {
    return [];
  }
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
// Copies of files the lock no longer holds: moved here, never deleted.
export const droppedCopiesDir = (root: string, dir = testingDir()): string => path.join(dir, 'locked-dropped', projectHash(root));

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

// A dropped file's copy moves aside; one already there is never written over, so this one then stays put.
function moveToDropped(root: string, rel: string): void {
  const from = copyOf(root, rel);
  const to = path.join(droppedCopiesDir(root), ...rel.split('/'));
  try {
    if (!fs.existsSync(from) || fs.existsSync(to)) return;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
  } catch (error) {
    console.warn(`[petal] locked copy ${rel} stays where it is:`, error);
  }
}

// Older builds locked app code a testing agent had edited, then put back every fix to it. Those entries leave the
// manifest (approved copy, Restored lines, questions); their copies move to locked-dropped/.
function dropUnlockable(root: string, manifest: LockManifest): LockManifest {
  const stale = Object.keys(manifest.approved).filter((rel) => !isLockable(rel));
  stale.forEach((rel) => moveToDropped(root, rel));
  const approved = Object.fromEntries(Object.entries(manifest.approved).filter(([rel]) => isLockable(rel)));
  return { ...manifest, approved, restored: manifest.restored.filter((f) => isLockable(f.path)) };
}

const textOf = (file: string): string | null => plainFile(file)?.toString('utf8') ?? null;

// With the lock on: refreshes what is locked and who Petal's agents are, then checks every locked test against its
// approved copy. Returns the manifest as it now stands.
export function refreshLock(root: string, inputs: Omit<LockInputs, 'root'>, agents: readonly { sessionId: string; role: AgentRole; taskId: string }[], names: AgentNames): LockManifest {
  const before = loadManifest(root);
  migrateLegacyCopies(root, before.approved);
  if (!before.enabled) return before;
  const current = dropUnlockable(root, before);
  const locked = lockedFiles({ root, ...inputs });
  const sessions = Object.fromEntries(agents.map((a) => [a.sessionId, { role: a.role, taskId: a.taskId }]));
  const approved = { ...current.approved };
  const restored: RestoredFlag[] = current.restored.filter((f) => !isUnconfirmed(f));
  const waiting = new Map(current.restored.filter(isUnconfirmed).map((f) => [f.path, f]));
  const unconfirmed: RestoredFlag[] = [];
  for (const rel of locked) {
    const now = textOf(at(root, rel));
    const copy = textOf(copyOf(root, rel));
    const file = { hash: hashOf(at(root, rel)), weakened: copy === null ? null : weakens(copy, now) };
    const step = integrityStep(rel, file, approved[rel], lastToucher(inputs.touches, rel, root, changedAt(root, rel)), sessions);
    const kept = step.kind === 'approve' ? keepCopy(root, rel) : null;
    if (kept) approved[rel] = kept;
    if (step.kind === 'restore' && restoreCopy(root, rel)) restored.push({ path: rel, at: Date.now(), taskId: null, by: step.by, why: step.why });
    if (step.kind === 'unconfirmed') unconfirmed.push(waiting.get(rel) ?? { path: rel, at: Date.now(), taskId: null, by: 'unconfirmed', why: step.why });
  }
  // A question drops once the file is back to its approved copy or a session's touch settled it.
  const flags = [...restored.slice(-RESTORED_KEPT), ...unconfirmed];
  const next: LockManifest = { ...before, lockedPaths: locked, sessions, names, approved, restored: flags };
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

// Clears the "Restored" lines and the refusals; questions still waiting for Keep or Restore stay.
export function dismissRestored(root: string, now = Date.now()): void {
  const manifest = loadManifest(root);
  saveManifest(root, { ...manifest, restored: manifest.restored.filter(isUnconfirmed), refusalsSeen: now });
}

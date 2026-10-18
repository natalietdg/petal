/// <reference types="vite/client" />
// The test lock on disk: the hook script and its entry in the project's .claude/settings.local.json (never ~/.claude),
// the manifest the hook reads, and the integrity check that restores a locked file changed outside the testing agent.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import lockScript from '../../resources/hooks/petal-test-lock.mjs?raw';
import { writeFileDurable } from './atomic-file';
import { ensureSelfIgnore } from './factory-store';
import { LOCK_SCRIPT, hasLockHook, mergeLockHook, unmergeLockHook } from '../shared/lock-settings';
import {
  LOCK_FILE, LOCKED_COPIES, SUITE_PREFIX, emptyManifest, integrityStep, lastToucher, lockedFiles, readManifest,
  type LockInputs, type LockManifest, type RestoredFlag,
} from '../shared/test-lock';
import type { AgentNames } from '../shared/agent-names';

const RESTORED_KEPT = 30;

const at = (root: string, rel: string): string => path.join(root, ...rel.split('/'));
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

const hashOf = (file: string): string | null => {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch {
    return null;
  }
};

function keepCopy(root: string, rel: string): void {
  const copy = at(root, `${LOCKED_COPIES}/${rel}`);
  fs.mkdirSync(path.dirname(copy), { recursive: true });
  fs.copyFileSync(at(root, rel), copy);
}

function restoreCopy(root: string, rel: string): boolean {
  const copy = at(root, `${LOCKED_COPIES}/${rel}`);
  if (!fs.existsSync(copy)) return false;
  fs.mkdirSync(path.dirname(at(root, rel)), { recursive: true });
  fs.copyFileSync(copy, at(root, rel));
  return true;
}

// With the lock on: refreshes what is locked and who the agents are, then checks every locked test file against its
// approved copy. Suite files are checked by the suite reader instead. Returns the manifest as it now stands.
export function refreshLock(root: string, inputs: Omit<LockInputs, 'root'>, names: AgentNames): LockManifest {
  const before = loadManifest(root);
  if (!before.enabled) return before;
  const owners = lockedFiles({ root, ...inputs });
  const sessions = Object.fromEntries(inputs.agents.map((a) => [a.sessionId, { role: a.role, taskId: a.taskId }]));
  const approved = { ...before.approved };
  const restored: RestoredFlag[] = [...before.restored];
  for (const rel of Object.keys(owners)) {
    if (rel.startsWith(SUITE_PREFIX)) continue;
    const step = integrityStep(rel, hashOf(at(root, rel)), approved[rel], lastToucher(inputs.touches, rel, root), sessions);
    if (step.kind === 'approve') { keepCopy(root, rel); approved[rel] = hashOf(at(root, rel)) as string; }
    if (step.kind === 'restore' && restoreCopy(root, rel)) restored.push({ path: rel, at: Date.now(), taskId: owners[rel] ?? null, by: step.by });
  }
  const next: LockManifest = { ...before, lockedPaths: Object.keys(owners).sort(), owners, sessions, names, approved, restored: restored.slice(-RESTORED_KEPT) };
  if (JSON.stringify(next) !== JSON.stringify(before)) saveManifest(root, next);
  return next;
}

export function dismissRestored(root: string, taskId: string): void {
  const manifest = loadManifest(root);
  saveManifest(root, { ...manifest, restored: manifest.restored.filter((f) => f.taskId !== taskId) });
}

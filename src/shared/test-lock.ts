// The test lock, per repo: which test files it holds, the manifest the hook reads (.petal/lock.json), and the integrity
// check that puts back a locked test someone deleted, skipped or weakened. Any session may add to or fix a test.
// Pure; main/test-lock.ts does the files.
import type { AgentNames, AgentRole } from './agent-names';
import type { Criteria } from './test-loop';

export const LOCK_FILE = '.petal/lock.json';
export const LEGACY_LOCKED_COPIES = '.petal/locked'; // older builds kept copies here, where test runners found them
export const REFUSALS_FILE = '.petal/lock-refusals.jsonl'; // the hook keeps its newest 200 lines

export interface RestoredFlag {
  path: string;
  at: number;
  taskId: string | null; // older flags only; the lock no longer belongs to a task
  by: AgentRole | 'main' | 'unconfirmed'; // the Claude session that weakened it, or nobody seen (waits for her Keep or Restore)
  why?: string; // what the change weakened
}

export interface LockManifest {
  version: 1;
  enabled: boolean;
  lockedPaths: string[]; // repo-relative
  sessions: Record<string, { role: AgentRole; taskId: string }>; // Petal's agents, so their refusals show in their lane
  names: AgentNames;
  approved: Record<string, string>; // path -> sha256 of the copy Petal keeps outside the repo
  restored: RestoredFlag[];
  refusalsSeen: number; // refusals at or before this time were dismissed
}

export const emptyManifest = (): LockManifest => ({ version: 1, enabled: false, lockedPaths: [], sessions: {}, names: {}, approved: {}, restored: [], refusalsSeen: 0 });

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function readManifest(raw: unknown): LockManifest {
  if (!isRecord(raw) || raw.version !== 1) return emptyManifest();
  const strings = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);
  const stringMap = (value: unknown) => (isRecord(value) ? Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v === 'string')) as Record<string, string> : {});
  return {
    version: 1,
    enabled: raw.enabled === true,
    lockedPaths: strings(raw.lockedPaths),
    sessions: isRecord(raw.sessions) ? raw.sessions as LockManifest['sessions'] : {},
    names: isRecord(raw.names) ? raw.names as AgentNames : {},
    approved: stringMap(raw.approved),
    restored: Array.isArray(raw.restored) ? (raw.restored as RestoredFlag[]).filter((f) => isRecord(f) && typeof f.path === 'string') : [],
    refusalsSeen: typeof raw.refusalsSeen === 'number' ? raw.refusalsSeen : 0,
  };
}

// A refusal of a session that isn't one of Petal's agents, for the lock bar.
export interface LockRefusal { at: number; text: string }

const REFUSALS_SHOWN = 5;

// The newest refusals of non-agent sessions since she last dismissed them. Agents' refusals already show in their lane.
export function mainRefusals(jsonl: string, manifest: LockManifest, root: string): LockRefusal[] {
  const out: LockRefusal[] = [];
  for (const line of jsonl.split('\n')) {
    let entry: unknown;
    try { entry = JSON.parse(line); } catch { continue; }
    if (!isRecord(entry) || typeof entry.at !== 'number' || entry.at <= manifest.refusalsSeen) continue;
    if (typeof entry.session === 'string' && manifest.sessions[entry.session]) continue;
    const target = typeof entry.target === 'string' ? entry.target : '';
    const shown = entry.tool === 'Bash' ? `run ${target.length > 80 ? `${target.slice(0, 79)}…` : target}` : `edit ${repoPath(target, root) ?? target}`;
    out.push({ at: entry.at, text: `A Claude session tried to ${shown}. Refused.` });
  }
  return out.slice(-REFUSALS_SHOWN);
}

// A repo-relative path from what a tool or a criteria line names; null when it points outside the repo.
export function repoPath(target: string, root: string, cwd: string | null = null): string | null {
  const joined = target.startsWith('/') ? target : `${(cwd ?? root).replace(/\/+$/, '')}/${target}`;
  const parts: string[] = [];
  for (const part of joined.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop(); else parts.push(part);
  }
  const full = `/${parts.join('/')}`;
  const base = root.replace(/\/+$/, '');
  return full.startsWith(`${base}/`) ? full.slice(base.length + 1) : null;
}

export interface LockInputs {
  root: string;
  criteria: Criteria | null;
  touches: Touch[];
}

export interface Touch { target: string; at: number; sessionId: string; kind: 'edit' | 'bash'; cwd: string | null }

// Runner setup and shared manifests, the same list as the hook's TEST_CONFIG: never locked, since every session may edit them.
const TEST_CONFIG = /(^|\/)(conftest\.py|pytest\.ini|tox\.ini|setup\.cfg|pyproject\.toml|package\.json|(jest|vitest|playwright|cypress|karma)\.(config|setup|workspace)\.[a-z0-9.]+|karma\.conf\.[a-z]+|setupTests\.[a-z]+|\.mocharc(\.[a-z]+)?)$/;
export const isTestConfig = (rel: string): boolean => TEST_CONFIG.test(rel);

// Test-looking paths, the same list as the hook's TEST_PATH.
const TEST_PATH = /(^|\/)(tests?|__tests__|e2e|spec|\.maestro)\/|\.(test|spec)\.[a-z0-9]+$|_test\.(go|py)$|(^|\/)test_[^/]+\.py$|^\.petal\//;
export const isTestPath = (rel: string): boolean => TEST_PATH.test(rel);

// What the lock may hold: a test file. Never app code, runner config or .petal/.
export const isLockable = (rel: string): boolean => isTestPath(rel) && !isTestConfig(rel) && !rel.startsWith('.petal/');

// The tests the criteria name and every test file a Claude session edited, sorted.
export function lockedFiles({ root, criteria, touches }: LockInputs): string[] {
  const found = new Set<string>();
  for (const item of [...(criteria?.scenarios ?? []), ...(criteria?.bugs ?? [])]) {
    for (const test of item.tests) {
      const rel = test.path.trim() ? repoPath(test.path.trim(), root) : null;
      if (rel && isLockable(rel)) found.add(rel);
    }
  }
  for (const touch of touches) {
    const rel = touch.kind === 'edit' ? repoPath(touch.target, root, touch.cwd) : null;
    if (rel && isLockable(rel)) found.add(rel);
  }
  return [...found].sort();
}

// ---- Weakening, the same rules as the hook's: a skip marker added, or fewer tests or assertions than before.
const SKIP = /\b(?:it|test|describe|context)\.(?:skip|todo)\b|\b(?:xit|xtest|xdescribe|xcontext)\s*\(|@pytest\.mark\.(?:skip|xfail)\b|\bpytest\.skip\s*\(|\bt\.Skip(?:Now|f)?\s*\(|@(?:Disabled|Ignore)\b|\bskip\s*:\s*true\b/g;
const TESTS = /(?<![.\w$])(?:it|test|describe)(?:\.(?:only|each\([^)]*\)))?\s*\(|\bdef\s+test_\w*|\bfunc\s+Test\w*|@Test\b|-\s+(?:tapOn|assertVisible|launchApp)\b/g;
const ASSERTS = /\bexpect\s*\(|\bassert(?:\w*\s*\(|\.\w+\s*\(|\s)|\.should\b|\bt\.(?:Error|Fatal)f?\s*\(|\brequire\.\w+\s*\(|\bXCTAssert\w*|-\s+assert\w+\b/g;
const count = (text: string, pattern: RegExp): number => text.match(pattern)?.length ?? 0;

// Why this change weakens the test, or null when it doesn't. after null: the file was deleted.
export function weakens(before: string, after: string | null): string | null {
  if (after === null) return 'deleted';
  if (count(after, SKIP) > count(before, SKIP)) return 'skipped';
  if (count(after, TESTS) < count(before, TESTS)) return 'removed a test';
  if (count(after, ASSERTS) < count(before, ASSERTS)) return 'removed an assertion';
  return null;
}

// The session that last changed a locked file: its last edit of it, or a shell line naming it, whichever is later.
// A touch this much before the file's last change still counts as the one that made it.
export const TOUCH_SLACK_MS = 5000;

// Touches older than the file's last change (changedAt) didn't make that change, so they don't count.
export function lastToucher(touches: readonly Touch[], rel: string, root: string, changedAt = 0): string | null {
  let best: { at: number; sessionId: string } | null = null;
  for (const t of touches) {
    const hit = t.kind === 'edit' ? repoPath(t.target, root, t.cwd) === rel : t.target.includes(rel);
    if (hit && t.at >= changedAt - TOUCH_SLACK_MS && (!best || t.at >= best.at)) best = { at: t.at, sessionId: t.sessionId };
  }
  return best?.sessionId ?? null;
}

export type IntegrityStep =
  | { kind: 'approve'; path: string }
  | { kind: 'restore'; path: string; by: AgentRole | 'main'; why: string }
  | { kind: 'unconfirmed'; path: string; why: string }
  | { kind: 'keep'; path: string };

export interface FileNow { hash: string | null; weakened: string | null } // weakened: against the approved copy

// For one locked file: any session's change that keeps the test whole is approved. One that deletes, skips or weakens it
// is put back when a Claude session made it; with no session seen (her editor, say) it waits for her. No approved copy
// yet: approved as it is.
export function integrityStep(rel: string, now: FileNow, approvedHash: string | undefined, toucher: string | null, sessions: LockManifest['sessions']): IntegrityStep {
  if (approvedHash === undefined) return now.hash === null ? { kind: 'keep', path: rel } : { kind: 'approve', path: rel };
  if (now.hash === approvedHash) return { kind: 'keep', path: rel };
  if (!now.weakened) return { kind: 'approve', path: rel };
  if (toucher === null) return { kind: 'unconfirmed', path: rel, why: now.weakened };
  return { kind: 'restore', path: rel, by: sessions[toucher]?.role ?? 'main', why: now.weakened };
}

// "A Claude session deleted a test. Restored." or the agent's name in its place; an unconfirmed change asks instead.
export const restoredText = (flag: RestoredFlag, names: { tester: string; fixer: string }): string => {
  if (flag.by === 'unconfirmed') return `${flag.path} ${flag.why ?? 'changed'} outside Claude. Keep it or restore the locked copy?`;
  const who = flag.by === 'fixer' ? names.fixer : flag.by === 'tester' ? names.tester : 'A Claude session';
  const what = flag.why === 'deleted' ? 'deleted a test' : flag.why === 'skipped' ? 'skipped a test' : 'weakened a test';
  return `${who} ${what}. Restored.`;
};

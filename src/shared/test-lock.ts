// The test lock: which files belong to a task's testing agent, the manifest the hook reads (.petal/lock.json), and the
// integrity check that puts back a locked file someone else changed. Pure; main/test-lock.ts does the files.
import type { AgentNames, AgentRole } from './agent-names';
import type { Criteria } from './test-loop';

export const LOCK_FILE = '.petal/lock.json';
export const LEGACY_LOCKED_COPIES = '.petal/locked'; // older builds kept copies here, where test runners found them
export const SUITE_PREFIX = '.petal/suites/';
export const REFUSALS_FILE = '.petal/lock-refusals.jsonl'; // the hook keeps its newest 200 lines

export interface RestoredFlag {
  path: string;
  at: number;
  taskId: string | null;
  by: AgentRole | 'main' | 'unconfirmed'; // the fixer, another Claude session, or nobody seen (waits for her Keep or Restore)
}

export interface LockManifest {
  version: 1;
  enabled: boolean;
  lockedPaths: string[]; // repo-relative
  sessions: Record<string, { role: AgentRole; taskId: string }>;
  names: AgentNames;
  approved: Record<string, string>; // path -> sha256 of the copy Petal keeps outside the repo
  owners: Record<string, string>; // path -> the task it belongs to
  restored: RestoredFlag[];
  refusalsSeen: number; // refusals at or before this time were dismissed
}

export const emptyManifest = (): LockManifest => ({ version: 1, enabled: false, lockedPaths: [], sessions: {}, names: {}, approved: {}, owners: {}, restored: [], refusalsSeen: 0 });

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
    owners: stringMap(raw.owners),
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
    out.push({ at: entry.at, text: `Main session tried to ${shown}. Refused.` });
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
  suiteTasks: string[]; // tasks with a suite file
  criteria: Criteria | null;
  agents: { sessionId: string; role: AgentRole; taskId: string }[];
  touches: Touch[];
}

export interface Touch { target: string; at: number; sessionId: string; kind: 'edit' | 'bash'; cwd: string | null }

// Runner setup and shared manifests, the same list as the hook's TEST_CONFIG: never locked, since every session may edit them.
const TEST_CONFIG = /(^|\/)(conftest\.py|pytest\.ini|tox\.ini|setup\.cfg|pyproject\.toml|package\.json|(jest|vitest|playwright|cypress|karma)\.(config|setup|workspace)\.[a-z0-9.]+|karma\.conf\.[a-z]+|setupTests\.[a-z]+|\.mocharc(\.[a-z]+)?)$/;
export const isTestConfig = (rel: string): boolean => TEST_CONFIG.test(rel);

// Test-looking paths, the same list as the hook's TEST_PATH.
const TEST_PATH = /(^|\/)(tests?|__tests__|e2e|spec|\.maestro)\/|\.(test|spec)\.[a-z0-9]+$|_test\.(go|py)$|(^|\/)test_[^/]+\.py$|^\.petal\//;
export const isTestPath = (rel: string): boolean => TEST_PATH.test(rel);

// What the lock may hold: a task's suite file or a test file. Never app code, runner config or the rest of .petal/.
export const isLockable = (rel: string): boolean =>
  rel.startsWith(SUITE_PREFIX) || (isTestPath(rel) && !isTestConfig(rel) && !rel.startsWith('.petal/'));

// Each task's suite file, the tests its criteria lines name, and every test file its testing agent edited; with the task each belongs to.
export function lockedFiles({ root, suiteTasks, criteria, agents, touches }: LockInputs): Record<string, string> {
  const owners: Record<string, string> = {};
  for (const taskId of suiteTasks) owners[`${SUITE_PREFIX}${taskId}.json`] = taskId;
  for (const item of [...(criteria?.scenarios ?? []), ...(criteria?.bugs ?? [])]) {
    const file = item.test?.path.trim();
    const rel = file && item.taskId ? repoPath(file, root) : null;
    if (rel && isLockable(rel)) owners[rel] ??= item.taskId as string;
  }
  const testers = new Map(agents.filter((a) => a.role === 'tester').map((a) => [a.sessionId, a.taskId]));
  for (const touch of touches) {
    const taskId = testers.get(touch.sessionId);
    const rel = taskId && touch.kind === 'edit' ? repoPath(touch.target, root, touch.cwd) : null;
    if (rel && isLockable(rel)) owners[rel] ??= taskId as string;
  }
  return owners;
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
  | { kind: 'restore'; path: string; by: AgentRole | 'main' }
  | { kind: 'unconfirmed'; path: string }
  | { kind: 'keep'; path: string };

// For one locked file whose content changed since it was approved: its own task's testing agent's change is approved;
// another Claude session's (another task's testing agent too) is put back. A change no session made (her editor, say)
// waits for her. No approved copy yet: approved as it is. owner: the task the file belongs to.
export function integrityStep(rel: string, nowHash: string | null, approvedHash: string | undefined, toucher: string | null, sessions: LockManifest['sessions'], owner: string | null = null): IntegrityStep {
  if (approvedHash === undefined) return nowHash === null ? { kind: 'keep', path: rel } : { kind: 'approve', path: rel };
  if (nowHash === approvedHash) return { kind: 'keep', path: rel };
  if (toucher === null) return { kind: 'unconfirmed', path: rel };
  const session = sessions[toucher];
  if (session?.role === 'tester' && (owner === null || session.taskId === owner)) return { kind: 'approve', path: rel };
  return { kind: 'restore', path: rel, by: session?.role ?? 'main' };
}

// "Main session changed a test. Restored." or the fixer's name in its place; an unconfirmed change asks instead.
export const restoredText = (flag: RestoredFlag, fixerName: string): string => {
  if (flag.by === 'unconfirmed') return `${flag.path} changed outside Claude. Keep it or restore the locked copy?`;
  const who = flag.by === 'fixer' ? fixerName : flag.by === 'tester' ? 'Another task’s testing agent' : 'Main session';
  return `${who} changed a test. Restored.`;
};

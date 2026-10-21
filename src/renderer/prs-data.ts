// Each session's PRs, asked of main when its log moves on and kept; the checks she runs are kept here too,
// so a result shows even when main had no main commit to cache it under.
import { isIpcError } from './dom';
import type { DeployOrder } from '../shared/deploy-order';
import type { MainSafe } from '../shared/main-safe';
import type { SessionPrsView } from '../shared/session-prs';

export type Check<T> = { state: 'running' } | { state: 'done'; value: T } | { state: 'failed'; note: string };

interface Entry { key: string; view: SessionPrsView | null }
const cache = new Map<string, Entry>();
const asking = new Set<string>();
const wanted = new Map<string, string>();
const again = new Set<string>();
const mainChecks = new Map<string, Check<MainSafe>>(); // `${sessionId} ${service key}`
const orderChecks = new Map<string, Check<DeployOrder>>(); // by session id
const listeners = new Set<(sessionId: string) => void>();

const changed = (sessionId: string): void => { for (const listener of listeners) listener(sessionId); };

function ask(sessionId: string, key: string): void {
  if (asking.has(sessionId)) { again.add(sessionId); return; }
  asking.add(sessionId);
  void window.pastel.prs.list(sessionId).then((result) => {
    asking.delete(sessionId);
    const view = isIpcError(result) ? null : result;
    const before = cache.get(sessionId)?.view ?? null;
    cache.set(sessionId, { key, view });
    if (JSON.stringify(before) !== JSON.stringify(view)) changed(sessionId);
    if (again.delete(sessionId)) ask(sessionId, wanted.get(sessionId) ?? key);
  }, () => { asking.delete(sessionId); again.delete(sessionId); });
}

// What is known now (null until main first answers); a new key (the log moved on) asks again.
export function prsFor(sessionId: string, key: string): SessionPrsView | null {
  const entry = cache.get(sessionId);
  wanted.set(sessionId, key);
  if (!entry || entry.key !== key) ask(sessionId, key);
  return entry?.view ?? null;
}

export const onPrsChanged = (listener: (sessionId: string) => void): void => { listeners.add(listener); };

async function track<T>(checks: Map<string, Check<T>>, id: string, sessionId: string, run: () => Promise<T | { error: string }>): Promise<void> {
  if (checks.get(id)?.state === 'running') return;
  checks.set(id, { state: 'running' });
  changed(sessionId);
  const result = await run().catch((error: Error) => ({ error: error.message }));
  checks.set(id, isIpcError(result) ? { state: 'failed', note: result.error } : { state: 'done', value: result as T });
  changed(sessionId);
}

export const mainCheck = (sessionId: string, service: string): Check<MainSafe> | null => mainChecks.get(`${sessionId} ${service}`) ?? null;
export const checkMain = (sessionId: string, service: string): Promise<void> =>
  track(mainChecks, `${sessionId} ${service}`, sessionId, () => window.pastel.prs.checkMain(sessionId, service));

export const orderCheck = (sessionId: string): Check<DeployOrder> | null => orderChecks.get(sessionId) ?? null;
export const proposeOrder = (sessionId: string): Promise<void> =>
  track(orderChecks, sessionId, sessionId, () => window.pastel.prs.deployOrder(sessionId));

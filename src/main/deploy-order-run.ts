// "Propose deploy order": a read-only reviewer reads the session's PRs and proposes the prod order, one reason each.
// Cached per session in <userData>/session-prs/order-<sessionId>.json for the PR heads it saw; a new push asks again.
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import { readJsonOrSetAside, writeJsonAtomic } from './atomic-file';
import { runHeadless } from './headless-claude';
import { branchHead, isFolder } from './git-read';
import { isSnapshotRun, prsFixture } from './snapshot-mode';
import { deployOrderPrompt } from './deploy-order-prompt';
import { prKey } from '../shared/pr-links';
import { parseDeployOrder, type DeployOrder } from '../shared/deploy-order';
import { serviceKey, type PrService, type SessionPr } from '../shared/session-prs';

const TIMEOUT_MS = 5 * 60_000;
const SAFE_ID = /^[\w-]{1,128}$/;
const REVIEWER_TOOLS = ['Read', 'Grep', 'Glob', 'Bash(git log*)', 'Bash(git diff*)', 'Bash(git show*)', 'Bash(gh pr view*)', 'Bash(gh pr diff*)'];

const fileFor = (sessionId: string): string | null =>
  (SAFE_ID.test(sessionId) ? path.join(app.getPath('userData'), 'session-prs', `order-${sessionId}.json`) : null);

const folderOf = (pr: SessionPr, services: readonly PrService[]): string | null =>
  pr.localPath ?? services.find((s) => s.key === serviceKey(pr))?.localPath ?? null;

// Which commit each PR's branch is at, as far as this Mac knows; a PR whose head can't be read counts by its link alone.
export async function headsKey(prs: readonly SessionPr[], services: readonly PrService[]): Promise<string> {
  const heads = await Promise.all(prs.map(async (pr) => `${prKey(pr)}@${(await branchHead(folderOf(pr, services), pr.branch)) ?? '?'}`));
  return crypto.createHash('sha256').update(heads.sort().join('\n')).digest('hex').slice(0, 16);
}

function load(sessionId: string): DeployOrder | null {
  const file = fileFor(sessionId);
  const data = file ? readJsonOrSetAside(file) as DeployOrder | undefined : undefined;
  return data && Array.isArray(data.steps) && typeof data.headsKey === 'string' ? data : null;
}

export async function cachedDeployOrder(sessionId: string, prs: readonly SessionPr[], services: readonly PrService[]): Promise<DeployOrder | null> {
  const order = load(sessionId);
  return order && order.headsKey === (await headsKey(prs, services)) ? order : null;
}

async function askReviewer(prs: readonly SessionPr[], services: readonly PrService[]): Promise<string> {
  const prompt = deployOrderPrompt(prs, services);
  if (isSnapshotRun()) {
    if (!prsFixture.deployOrder) throw new Error('Snapshot runs never start a real reviewer.');
    return prsFixture.deployOrder(prompt);
  }
  const folders = [...new Set(services.map((s) => s.localPath).filter(isFolder))];
  const [cwd = os.tmpdir(), ...addDirs] = folders;
  return runHeadless({ prompt, cwd, addDirs, model: 'sonnet', tools: ['Read', 'Grep', 'Glob', 'Bash'], allowed: REVIEWER_TOOLS, timeoutMs: TIMEOUT_MS, label: 'The reviewer' });
}

const running = new Map<string, Promise<DeployOrder>>(); // one proposal per session at a time

export function proposeDeployOrder(sessionId: string, prs: readonly SessionPr[], services: readonly PrService[]): Promise<DeployOrder> {
  const file = fileFor(sessionId);
  if (!file) return Promise.reject(new Error('A deploy order needs a Claude session.'));
  if (!prs.length) return Promise.reject(new Error('This session has no PRs to order.'));
  const pending = running.get(sessionId);
  if (pending) return pending;
  const run = (async () => {
    const heads = await headsKey(prs, services);
    const cached = load(sessionId);
    if (cached?.headsKey === heads) return cached;
    const order = parseDeployOrder(await askReviewer(prs, services), prs, services, heads);
    writeJsonAtomic(file, order);
    return order;
  })();
  running.set(sessionId, run);
  void run.finally(() => running.delete(sessionId)).catch(() => undefined);
  return run;
}

// The reviewer's answers, cached in <userData>/code-review/<sessionId>.json by turn and content hash:
// a turn whose functions or reasoning changed since (it was still being written) is asked again, never shown stale answers.
import crypto from 'node:crypto';
import path from 'node:path';
import { app } from 'electron';
import { readJsonOrSetAside, writeJsonAtomic } from './atomic-file';
import { cacheKey, type FunctionCard, type ReasoningExcerpt, type WhyAnswer } from '../shared/code-review';

interface CachedTurn {
  key: string; // cacheKey(sessionId, turnId, hash)
  answers: Record<string, WhyAnswer>; // by card key
  at: string;
}

type SessionCache = Record<string, CachedTurn>; // by turn id

const SAFE_ID = /^[\w-]{1,200}$/; // a subagent's cache is <sessionId>--<agentId>
const dir = () => path.join(app.getPath('userData'), 'code-review');
const fileFor = (sessionId: string): string | null => (SAFE_ID.test(sessionId) ? path.join(dir(), `${sessionId}.json`) : null);

// What the reviewer is shown for a turn; any change to it is a new hash.
export const turnHash = (cards: readonly FunctionCard[], reasoning: readonly ReasoningExcerpt[]): string =>
  crypto.createHash('sha256').update(JSON.stringify([cards.map((c) => [c.key, c.before, c.after, c.reasoning]), reasoning])).digest('hex').slice(0, 16);

function load(sessionId: string): SessionCache {
  const file = fileFor(sessionId);
  const data = file ? readJsonOrSetAside(file) : undefined;
  return data && typeof data === 'object' && !Array.isArray(data) ? data as SessionCache : {};
}

// The cached answers for exactly this content; null when this content was never explained.
export function cachedAnswers(sessionId: string, turnId: string, hash: string): Record<string, WhyAnswer> | null {
  const turn = load(sessionId)[turnId];
  return turn?.key === cacheKey(sessionId, turnId, hash) ? turn.answers : null;
}

// Adds answers to the same content's entry (a retry fills gaps); new content replaces the old entry.
export function saveAnswers(sessionId: string, turnId: string, hash: string, answers: Record<string, WhyAnswer>): void {
  const file = fileFor(sessionId);
  if (!file) return;
  const cache = load(sessionId);
  const key = cacheKey(sessionId, turnId, hash);
  const kept = cache[turnId]?.key === key ? cache[turnId].answers : {};
  cache[turnId] = { key, answers: { ...kept, ...answers }, at: new Date().toISOString() };
  writeJsonAtomic(file, cache);
}

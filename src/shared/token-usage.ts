// Tokens a Claude Code session used, summed from its transcript's message.usage, and a local estimate before a loop starts.
// Tokens only, never prices. Claude Code writes one entry per content block, each repeating its message's usage, so a
// message id counts once.

export interface TokenUsage { input: number; output: number; cacheWrite: number; cacheRead: number }

export const NO_TOKENS: TokenUsage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };

const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);

// One transcript entry's usage: message.usage's input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens.
export function usageOf(entry: unknown): { id: string | null; usage: TokenUsage } | null {
  const message = (entry as { message?: { id?: unknown; usage?: Record<string, unknown> } } | null)?.message;
  const usage = message?.usage;
  if (!usage || typeof usage !== 'object') return null;
  return {
    id: typeof message.id === 'string' ? message.id : null,
    usage: { input: count(usage.input_tokens), output: count(usage.output_tokens), cacheWrite: count(usage.cache_creation_input_tokens), cacheRead: count(usage.cache_read_input_tokens) },
  };
}

export const addUsage = (a: TokenUsage, b: TokenUsage): TokenUsage => ({ input: a.input + b.input, output: a.output + b.output, cacheWrite: a.cacheWrite + b.cacheWrite, cacheRead: a.cacheRead + b.cacheRead });
export const totalTokens = (u: TokenUsage): number => u.input + u.output + u.cacheWrite + u.cacheRead;
export const cachedTokens = (u: TokenUsage): number => u.cacheRead; // re-read context, far cheaper than new tokens

// Every message once, by id; entries without an id each count.
export function sumUsage(entries: readonly unknown[]): TokenUsage {
  const byId = new Map<string, TokenUsage>();
  let loose = NO_TOKENS;
  for (const entry of entries) {
    const found = usageOf(entry);
    if (!found) continue;
    if (found.id) byId.set(found.id, found.usage); else loose = addUsage(loose, found.usage);
  }
  return [...byId.values()].reduce(addUsage, loose);
}

// Rough: about four characters a token, each brief read again on a round's turns, plus the suite's output read back.
// Used only until this task has finished rounds to calibrate from.
export const CHARS_PER_TOKEN = 4;
export const TURNS_PER_ROUND = 6; // tool calls a round takes, each re-reading the context so far
export const BASE_CONTEXT_TOKENS = 15_000; // Claude Code's own system prompt and tools, per turn
export const CALIBRATE_ROUNDS = 5; // the newest finished rounds averaged
export const DRAFT_TURNS = 20; // a suite draft: reading the repo, writing tests, running them
export const FIX_TURNS = 8; // one bug: read the test, fix the code, run it again
export const SUITE_SKILL_CHARS = 4500; // the bundled testing-suite skill the drafting agent reads first

export function estimateRoundTokens({ briefChars, suiteOutputChars }: { briefChars: number[]; suiteOutputChars: number }): number {
  const perAgent = (chars: number) => (BASE_CONTEXT_TOKENS + Math.ceil(chars / CHARS_PER_TOKEN)) * TURNS_PER_ROUND;
  return briefChars.reduce((sum, chars) => sum + perAgent(chars), 0) + Math.ceil(suiteOutputChars / CHARS_PER_TOKEN) * 2;
}

// One agent started on a brief: the brief and Claude Code's own context, read again on each of its typical turns.
export const agentTokens = (briefChars: number, turns: number): number => (BASE_CONTEXT_TOKENS + Math.ceil(briefChars / CHARS_PER_TOKEN)) * turns;

// The line under a button that starts or sends to an agent.
export const agentEstimateText = (tokens: number): string => `About ${tokenText(tokens)} tokens. A rough estimate from the brief and typical turns.`;

// Per round: this task's newest finished rounds averaged when it has any (rounds > 0), else the rough figure.
export interface RoundEstimate { tokens: number; rounds: number }
export function roundEstimate(finished: readonly number[], rough: number): RoundEstimate {
  const recent = finished.filter((n) => n > 0).slice(-CALIBRATE_ROUNDS);
  return recent.length ? { tokens: Math.round(recent.reduce((a, b) => a + b, 0) / recent.length), rounds: recent.length } : { tokens: rough, rounds: 0 };
}

// "12k tokens (10k of them cached reads)": cache reads are named apart, since they cost far less than new tokens.
export const usageText = (total: number, cached: number): string =>
  (cached > 0 ? `${tokenText(total)} tokens (${tokenText(cached)} of them cached reads)` : `${tokenText(total)} tokens`);

// "12.3k", "1.2M": short enough for a lane.
export function tokenText(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

// Token cost of building the Library: an estimate before a run (counted locally, no API calls) and what a run used after.
// Tokens only, never money: Petal runs on her Claude plan, and a price would be a guess.

export const CHARS_PER_TOKEN = 4; // an approximation for English text; real counts come from Claude's usage after a run
export const CLAUDE_CODE_OVERHEAD_TOKENS = 3000; // Claude Code's own system prompt on each headless call, approximate
export const OUTPUT_TOKENS_PER_CALL = 600; // a typical topics JSON answer

export interface TokenEstimate {
  read: number; // tokens sent to Claude
  write: number; // tokens Claude writes back
  calls: number;
}

export const NO_ESTIMATE: TokenEstimate = { read: 0, write: 0, calls: 0 };

// What one Claude call sends: its digest plus the instructions around it, as characters.
export interface CallText {
  digestChars: number;
  promptChars: number; // the Library's instructions and known titles, without the digest
}

export const tokensOf = (chars: number): number => Math.ceil(chars / CHARS_PER_TOKEN);

export function estimateCalls(calls: readonly CallText[]): TokenEstimate {
  const read = calls.reduce((sum, c) => sum + tokensOf(c.digestChars + c.promptChars) + CLAUDE_CODE_OVERHEAD_TOKENS, 0);
  return { read, write: calls.length * OUTPUT_TOKENS_PER_CALL, calls: calls.length };
}

export const addEstimates = (a: TokenEstimate, b: TokenEstimate): TokenEstimate =>
  ({ read: a.read + b.read, write: a.write + b.write, calls: a.calls + b.calls });

// ---- What a run used, from Claude's own usage numbers.
export interface TokenUsage {
  input: number;
  output: number;
  cacheWrite: number; // cache_creation_input_tokens
  cacheRead: number; // cache_read_input_tokens
}

export const NO_USAGE: TokenUsage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };

const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);

// A usage object's four fields; a missing or odd field counts as 0. Null when there is no usage object at all.
export function usageFrom(value: unknown): TokenUsage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const u = value as Record<string, unknown>;
  return { input: count(u.input_tokens), output: count(u.output_tokens), cacheWrite: count(u.cache_creation_input_tokens), cacheRead: count(u.cache_read_input_tokens) };
}

// The usage on a headless reply's JSON envelope (`usage`) or a transcript's assistant entry (`message.usage`).
export function usageOfEntry(entry: unknown): TokenUsage | null {
  if (!entry || typeof entry !== 'object') return null;
  const e = entry as { usage?: unknown; message?: { usage?: unknown } };
  return usageFrom(e.usage) ?? usageFrom(e.message?.usage);
}

// The stdout of `claude -p --output-format json`; prose or broken JSON has no usage.
export function usageOfReply(stdout: string): TokenUsage | null {
  try { return usageOfEntry(JSON.parse(stdout)); } catch { return null; }
}

export const addUsage = (a: TokenUsage, b: TokenUsage): TokenUsage =>
  ({ input: a.input + b.input, output: a.output + b.output, cacheWrite: a.cacheWrite + b.cacheWrite, cacheRead: a.cacheRead + b.cacheRead });

export const sumUsage = (entries: readonly unknown[]): TokenUsage =>
  entries.reduce<TokenUsage>((sum, entry) => addUsage(sum, usageOfEntry(entry) ?? NO_USAGE), NO_USAGE);

export const readTokens = (u: TokenUsage): number => u.input + u.cacheWrite + u.cacheRead;
export const totalTokens = (u: TokenUsage): number => readTokens(u) + u.output;

// ---- Words.
// Two significant figures: 12,345 reads as 12,000. Small counts round to tens.
export function roundTokens(n: number): string {
  if (n < 1000) return String(Math.round(n / 10) * 10);
  const step = 10 ** (Math.floor(Math.log10(n)) - 1);
  return (Math.round(n / step) * step).toLocaleString('en-US');
}

export const estimateText = (e: TokenEstimate): string => `About ${roundTokens(e.read)} tokens to read, ${roundTokens(e.write)} to write.`;

export const usedText = (u: TokenUsage): string => (totalTokens(u)
  ? `Used about ${roundTokens(totalTokens(u))} tokens.`
  : 'Claude didn’t report token use.');

// Every session read costs between one small call and the per-run cap of full ones.
export function perSessionRange({ maxCalls, digestChars, promptChars }: { maxCalls: number; digestChars: number; promptChars: number }): { low: number; high: number } {
  const one = estimateCalls([{ digestChars: 0, promptChars }]);
  const most = estimateCalls(Array.from({ length: maxCalls }, () => ({ digestChars, promptChars })));
  return { low: one.read + one.write, high: most.read + most.write };
}

// ---- The last build, kept on the Library page.
export type LibraryRunKind = 'past' | 'add' | 'auto';

export interface LastLibraryRun {
  at: string; // ISO time it finished
  kind: LibraryRunKind;
  sessions: number;
  usage: TokenUsage;
}

const KIND_WORDS: Record<LibraryRunKind, string> = { past: 'Reading past sessions', add: 'Add to Library', auto: 'The last automatic build' };

export function lastRunText(run: LastLibraryRun): string {
  const sessions = `${run.sessions} session${run.sessions === 1 ? '' : 's'}`;
  const tokens = totalTokens(run.usage) ? `about ${roundTokens(totalTokens(run.usage))} tokens` : 'no reported tokens';
  return `Last build: ${KIND_WORDS[run.kind]}, ${sessions}, used ${tokens}.`;
}

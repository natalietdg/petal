// A session's spend as Petal counts it from the transcript (no Claude call, no tokens): new tokens, cache re-reads, context fill.
import { tokenText, type TokenUsage } from './token-usage';

export interface SessionSpend {
  newTokens: number; // input + cache write + output: what the session added, the part that costs
  cacheRead: number; // context read again from cache each turn, far cheaper
  contextTokens: number; // the latest main-chain turn's input + cache read + cache write
  contextWindow: number;
}

export const BOARD_CHIP_NEW_TOKENS = 1_000_000; // about the top tenth of her 162 sessions (p90 862k, 2026-11-15)
export const CONTEXT_NOTICE_RATIO = 0.6;
const SMALL_WINDOW = 200_000;
const LARGE_WINDOW = 1_000_000;
// Claude 5 models run with a 1M window: every one in her logs has gone past 200k (opus-5-5 up to 967k).
const LARGE_WINDOW_MODEL = /^claude-(opus|fable|sonnet)-5/;

export const newTokens = (u: TokenUsage): number => u.input + u.cacheWrite + u.output;

export function contextWindowFor(model: string | null, maxContext: number): number {
  return (model && LARGE_WINDOW_MODEL.test(model)) || maxContext > SMALL_WINDOW ? LARGE_WINDOW : SMALL_WINDOW;
}

export const contextPercent = (spend: SessionSpend): number => (spend.contextWindow ? spend.contextTokens / spend.contextWindow : 0);
export const contextNoticeDue = (spend: SessionSpend): boolean => contextPercent(spend) >= CONTEXT_NOTICE_RATIO;

// "Context about 60% full. /compact at a clean point." Rounded to tens, the way she'd say it.
export const contextNotice = (spend: SessionSpend): string =>
  `Context about ${Math.round(contextPercent(spend) * 10) * 10}% full. /compact at a clean point.`;

// The Board card's chip, only for a session past the threshold.
export const spendChip = (tokens: number | null | undefined): string | null =>
  tokens && tokens >= BOARD_CHIP_NEW_TOKENS ? `${tokenText(tokens)} new tokens` : null;

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resetForTests, sessionSpend } from '../src/main/session-spend';
import { BOARD_CHIP_NEW_TOKENS, contextNotice, contextNoticeDue, contextWindowFor, spendChip } from '../src/shared/session-spend';
import { spendText } from '../src/shared/session-info';
import { removeTempDirs, tempDir } from './helpers';

afterEach(() => { resetForTests(); removeTempDirs(); });

const turn = (id: string, usage: Record<string, number>, extra: Record<string, unknown> = {}): string =>
  `${JSON.stringify({ type: 'assistant', message: { id, model: 'claude-haiku-5-5', usage }, ...extra })}\n`;

describe('per-session spend, counted from the transcript', () => {
  it('sums new tokens (input + cache write + output) apart from cache reads, each message once', () => {
    const file = path.join(tempDir(), 's.jsonl');
    fs.writeFileSync(file, turn('m1', { input_tokens: 10, cache_creation_input_tokens: 1000, cache_read_input_tokens: 5000, output_tokens: 50 })
      + turn('m1', { input_tokens: 10, cache_creation_input_tokens: 1000, cache_read_input_tokens: 5000, output_tokens: 50 })); // same message, second block
    expect(sessionSpend(file)).toMatchObject({ newTokens: 1060, cacheRead: 5000, contextTokens: 6010, contextWindow: 200_000 });
  });

  it('reads only what was appended, keeps a half-written line for the next tick, and starts over on a rewrite', () => {
    const file = path.join(tempDir(), 's.jsonl');
    fs.writeFileSync(file, turn('m1', { input_tokens: 100, output_tokens: 1 }));
    expect(sessionSpend(file)?.newTokens).toBe(101);
    const next = turn('m2', { input_tokens: 200, output_tokens: 2 });
    fs.appendFileSync(file, next.slice(0, 20));
    expect(sessionSpend(file)?.newTokens).toBe(101);
    fs.appendFileSync(file, next.slice(20));
    expect(sessionSpend(file)?.newTokens).toBe(303);
    fs.writeFileSync(file, turn('m9', { input_tokens: 7 }));
    expect(sessionSpend(file)?.newTokens).toBe(7);
  });

  it('adds its subagents’ logs; sidechain turns never set the context fill', () => {
    const dir = tempDir();
    const file = path.join(dir, 'abc.jsonl');
    fs.writeFileSync(file, turn('m1', { input_tokens: 100, cache_read_input_tokens: 900 }) + turn('s1', { input_tokens: 99_000 }, { isSidechain: true }));
    fs.mkdirSync(path.join(dir, 'abc', 'subagents'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'abc', 'subagents', 'agent-1.jsonl'), turn('a1', { output_tokens: 40 }));
    expect(sessionSpend(file)).toMatchObject({ newTokens: 99_140, contextTokens: 1000 });
  });

  it('is null for a log that isn’t there yet', () => {
    expect(sessionSpend(path.join(tempDir(), 'missing.jsonl'))).toBeNull();
  });
});

describe('context window and the one-time notice', () => {
  it('Claude 5 models get 1M; others 200k unless a turn already went past it', () => {
    expect(contextWindowFor('claude-opus-5-5', 0)).toBe(1_000_000);
    expect(contextWindowFor('claude-fable-5-1', 0)).toBe(1_000_000);
    expect(contextWindowFor('claude-haiku-5-5', 0)).toBe(200_000);
    expect(contextWindowFor(null, 250_000)).toBe(1_000_000);
  });

  it('is due at 60% and says the fill in tens, with /compact', () => {
    const at = (contextTokens: number) => ({ newTokens: 0, cacheRead: 0, contextTokens, contextWindow: 200_000 });
    expect(contextNoticeDue(at(119_000))).toBe(false);
    expect(contextNoticeDue(at(120_000))).toBe(true);
    expect(contextNotice(at(140_000))).toBe('Context about 70% full. /compact at a clean point.');
  });
});

describe('Board chip and This session line', () => {
  it('shows only past 1M new tokens', () => {
    expect(spendChip(BOARD_CHIP_NEW_TOKENS - 1)).toBeNull();
    expect(spendChip(null)).toBeNull();
    expect(spendChip(1_250_000)).toBe('1.3M new tokens');
  });

  it('names new tokens and cache re-reads apart', () => {
    expect(spendText({ newTokens: 1_200_000, cacheRead: 34_000_000 })).toBe('1.2M new tokens, 34.0M re-read from cache');
  });
});

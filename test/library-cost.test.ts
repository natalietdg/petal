// Library token cost: the local estimate matches what the build sends, and a run's usage is summed from Claude's numbers.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assistantEntry, removeTempDirs, tempDir, useTempUserData, userEntry } from './helpers';
import {
  CHARS_PER_TOKEN, CLAUDE_CODE_OVERHEAD_TOKENS, OUTPUT_TOKENS_PER_CALL, estimateCalls, estimateText, lastRunText, perSessionRange,
  roundTokens, sumUsage, tokensOf, totalTokens, usageOfEntry, usageOfReply, usedText,
} from '../src/shared/library-cost';

const NOW = Date.UTC(2026, 9, 18, 12);
const USAGE = { input_tokens: 10, output_tokens: 200, cache_creation_input_tokens: 3000, cache_read_input_tokens: 40_000 };
// The shape `claude -p --output-format json` prints: the answer in result, the call's usage beside it.
const envelope = (result: object, usage: object | null = USAGE) => JSON.stringify({ type: 'result', is_error: false, result: JSON.stringify(result), usage });

afterEach(() => {
  delete process.env.PASTEL_SNAPSHOT;
  removeTempDirs();
  vi.resetModules();
});

describe('the usage summer', () => {
  it('reads all four fields from a reply envelope and from a transcript assistant entry', () => {
    expect(usageOfReply(envelope({ topics: [] }))).toEqual({ input: 10, output: 200, cacheWrite: 3000, cacheRead: 40_000 });
    // A real Claude Code transcript line carries message.usage with the same four names, plus extras that are ignored.
    const line = { type: 'assistant', message: { role: 'assistant', usage: { ...USAGE, service_tier: 'standard', cache_creation: { ephemeral_1h_input_tokens: 3000 } } } };
    expect(usageOfEntry(line)).toEqual({ input: 10, output: 200, cacheWrite: 3000, cacheRead: 40_000 });
  });

  it('counts a missing or odd field as 0, and skips entries with no usage at all', () => {
    expect(usageOfEntry({ usage: { output_tokens: 7 } })).toEqual({ input: 0, output: 7, cacheWrite: 0, cacheRead: 0 });
    expect(usageOfEntry({ usage: { input_tokens: 'many', output_tokens: -4, cache_read_input_tokens: Number.NaN } })).toEqual({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0 });
    expect(usageOfEntry({ type: 'user', message: { content: 'hi' } })).toBeNull();
    expect(usageOfReply('not json')).toBeNull();
    const total = sumUsage([{ usage: USAGE }, { message: { usage: { input_tokens: 5, output_tokens: 1 } } }, { type: 'user' }, null]);
    expect(total).toEqual({ input: 15, output: 201, cacheWrite: 3000, cacheRead: 40_000 });
    expect(totalTokens(total)).toBe(43_216);
  });

  it('says what it used in rounded tokens, never money', () => {
    expect(usedText({ input: 15, output: 201, cacheWrite: 3000, cacheRead: 40_000 })).toBe('Used about 43,000 tokens.');
    expect(usedText({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0 })).toBe('Claude didn’t report token use.');
    expect(lastRunText({ at: '2026-10-18T00:00:00Z', kind: 'past', sessions: 4, usage: { input: 0, output: 1200, cacheWrite: 0, cacheRead: 9000 } }))
      .toBe('Last build: Reading past sessions, 4 sessions, used about 10,000 tokens.');
    expect(roundTokens(987)).toBe('990');
    expect(roundTokens(12_345)).toBe('12,000');
    expect(roundTokens(1_250_000)).toBe('1,300,000');
  });
});

describe('the estimate constants', () => {
  it('chars over CHARS_PER_TOKEN plus the per-call overhead to read, a fixed answer per call to write', () => {
    expect(CHARS_PER_TOKEN).toBe(4);
    const one = estimateCalls([{ digestChars: 3999, promptChars: 1001 }]);
    expect(one).toEqual({ read: 1250 + CLAUDE_CODE_OVERHEAD_TOKENS, write: OUTPUT_TOKENS_PER_CALL, calls: 1 });
    expect(estimateCalls([])).toEqual({ read: 0, write: 0, calls: 0 });
    expect(estimateText({ read: 14_321, write: 1800, calls: 3 })).toBe('About 14,000 tokens to read, 1,800 to write.');
    const range = perSessionRange({ maxCalls: 3, digestChars: 30_000, promptChars: 2000 });
    expect(range.low).toBe(tokensOf(2000) + CLAUDE_CODE_OVERHEAD_TOKENS + OUTPUT_TOKENS_PER_CALL);
    expect(range.high).toBe(3 * (tokensOf(32_000) + CLAUDE_CODE_OVERHEAD_TOKENS + OUTPUT_TOKENS_PER_CALL));
  });
});

// A stand-in Claude folder and a stub extractor that records every prompt the build sends.
async function setUp({ lessons = false } = {}) {
  process.env.PASTEL_SNAPSHOT = '1';
  const userData = useTempUserData();
  fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({ claudeFolder: { choice: 'allowed' }, library: { autoBuild: false }, lessons: { learn: lessons } }));
  const home = tempDir('petal-fake-claude-');
  const project = path.join(home, 'projects', '-tmp-acme');
  fs.mkdirSync(project, { recursive: true });
  const mode = await import('../src/main/snapshot-mode');
  mode.folderFixture.home = home;
  const prompts: string[] = [];
  // Empty answers keep the Library unchanged, so every call's known titles match what the estimate measured.
  mode.libraryFixture.extract = async (prompt) => { prompts.push(prompt); return envelope({ topics: [], lessons: [] }); };
  const log = (id: string, lines: object[]) => {
    const file = path.join(project, `${id}.jsonl`);
    fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    const at = new Date(NOW - 24 * 60 * 60 * 1000);
    fs.utimesSync(file, at, at);
    return { sessionId: id, transcript: file };
  };
  return { prompts, log, userData };
}

// Enough talk to fill more than one digest, so the build makes two calls; tool lines and subagent talk are left out of both.
const longTalk = () => [
  ...Array.from({ length: 15 }, (_, i) => userEntry(`question ${i} ${'q'.repeat(2900)}`, { uuid: `u${i}` })),
  { type: 'user', uuid: 'tool', message: { role: 'user', content: [{ type: 'tool_result', content: 'x'.repeat(5000) }] } },
  userEntry('a subagent prompt', { uuid: 'side', isSidechain: true }),
  assistantEntry('Payouts after 3pm settle the next day.', 'a-last'),
];

const readOf = (prompts: string[]) => prompts.reduce((sum, p) => sum + tokensOf(p.length) + CLAUDE_CODE_OVERHEAD_TOKENS, 0);

describe('the estimate matches what the build sends', () => {
  it('counts the exact prompts, call by call, for Read past sessions', async () => {
    const { prompts, log } = await setUp();
    const target = log('s-long', longTalk());
    const small = log('s-small', [userEntry('when do payouts settle?'), assistantEntry('After 3pm, the next day.')]);
    const { estimateSessions } = await import('../src/main/library-estimate');
    const { planBackfill, startBackfill, whenIdle, backfillState } = await import('../src/main/library-backfill');
    const estimate = estimateSessions([target, small]);
    const plan = planBackfill(30, NOW);
    expect(plan).toMatchObject({ sessions: 2, estimate });
    startBackfill(30, NOW);
    await whenIdle();
    expect(prompts).toHaveLength(3); // two for the long log, one for the small
    expect(estimate).toEqual({ read: readOf(prompts), write: 3 * OUTPUT_TOKENS_PER_CALL, calls: 3 });
    expect(prompts.join('\n')).not.toContain('a subagent prompt');
    // After: each call's usage summed, and kept as the last build.
    expect(backfillState().usage).toEqual({ input: 30, output: 600, cacheWrite: 9000, cacheRead: 120_000 });
    const { lastRun } = await import('../src/main/library-cost-store');
    expect(lastRun()).toMatchObject({ kind: 'past', sessions: 2, usage: { input: 30, output: 600, cacheWrite: 9000, cacheRead: 120_000 } });
    // Everything read: nothing left to estimate.
    expect(estimateSessions([target, small])).toEqual({ read: 0, write: 0, calls: 0 });
  });

  it('starts from the saved offset, and measures the combined prompt when Learn lessons is on', async () => {
    const { prompts, log } = await setUp({ lessons: true });
    const target = log('s-part', longTalk());
    const { saveOffset, queueSession } = await import('../src/main/library-extract');
    const firstLine = fs.readFileSync(target.transcript, 'utf8').indexOf('\n') + 1;
    saveOffset('s-part', firstLine * 12); // past the first dozen questions, so one call is left
    const { estimateSessions } = await import('../src/main/library-estimate');
    const estimate = estimateSessions([target]);
    const result = await queueSession(target, { force: true });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('"lessons"');
    expect(prompts[0]).not.toContain('question 0 ');
    expect(estimate).toEqual({ read: readOf(prompts), write: OUTPUT_TOKENS_PER_CALL, calls: 1 });
    expect(result.usage).toEqual({ input: 10, output: 200, cacheWrite: 3000, cacheRead: 40_000 });
  });

  it('a reply without usage still runs, and the run has no usage to show', async () => {
    const { log } = await setUp();
    const target = log('s-bare', [userEntry('what is an SI?'), assistantEntry('A settlement instruction.')]);
    const mode = await import('../src/main/snapshot-mode');
    mode.libraryFixture.extract = async () => envelope({ topics: [] }, null);
    const { queueSession } = await import('../src/main/library-extract');
    const result = await queueSession(target, { force: true });
    expect(result).toEqual({ added: 0, updated: 0 });
  });
});

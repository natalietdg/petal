// Big session logs (hers reach hundreds of MB) are read a chunk at a time, async: the main thread keeps getting turns.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { JsonlTail, READ_CHUNK_BYTES, TranscriptTail, type TranscriptView } from '../src/main/transcript';
import { ReplyCollector } from '../src/main/replies';
import { parseEntry } from '../src/main/transcript-entry';
import { AgentTimeline, listAgents } from '../src/main/agents';
import { forgetLogs, scanLog } from '../src/main/testing-claude';
import { assistantEntry, removeTempDirs, tempDir, userEntry } from './helpers';

const TARGET_BYTES = 16 * READ_CHUNK_BYTES;
const PAD = 'x'.repeat(1500);

afterEach(() => {
  vi.restoreAllMocks();
  forgetLogs();
});
afterAll(removeTempDirs);

// Prompts, Bash test calls with results, and replies, until the file passes TARGET_BYTES.
function writeBigLog(): { file: string; lines: string[] } {
  const file = path.join(tempDir('petal-big-log-'), 'big.jsonl');
  const lines: string[] = [];
  let size = 0;
  for (let i = 0; size < TARGET_BYTES; i += 1) {
    const batch = [
      userEntry(`prompt ${i}`, { uuid: `u${i}` }),
      { type: 'assistant', uuid: `t${i}`, timestamp: '2026-10-06T00:00:00.000Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: `tool${i}`, name: 'Bash', input: { command: 'npx vitest run' } }] } },
      { type: 'user', uuid: `r${i}`, timestamp: '2026-10-06T00:00:01.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `tool${i}`, content: `Tests 3 passed (3)\n${PAD}` }] } },
      assistantEntry(`reply ${i} ${PAD.slice(0, 400)}`, `a${i}`),
    ].map((entry) => JSON.stringify(entry));
    lines.push(...batch);
    size += batch.reduce((sum, line) => sum + Buffer.byteLength(line) + 1, 0);
  }
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  return { file, lines };
}

// Counts event-loop turns while `work` runs; a synchronous read of the whole file would allow none.
async function turnsDuring<T>(work: () => Promise<T>): Promise<{ result: T; turns: number }> {
  let turns = 0;
  let running = true;
  const spin = (): void => { if (running) { turns += 1; setImmediate(spin); } };
  setImmediate(spin);
  const result = await work();
  running = false;
  return { result, turns };
}

// Sync reads bigger than the small head/tail windows (64-256 KB) the listings use: none may happen on these paths.
const SMALL_WINDOW = 256 * 1024;
function watchBigSyncReads(): string[] {
  const seen: string[] = [];
  const realRead = fs.readSync;
  vi.spyOn(fs, 'readSync').mockImplementation(((...args: unknown[]) => {
    const length = typeof args[3] === 'number' ? args[3] : (args[1] as Buffer).length;
    if (length > SMALL_WINDOW) seen.push(`readSync ${length}`);
    return realRead.apply(fs, args as Parameters<typeof fs.readSync>);
  }) as never);
  const realReadFile = fs.readFileSync;
  vi.spyOn(fs, 'readFileSync').mockImplementation(((...args: Parameters<typeof fs.readFileSync>) => {
    if (String(args[0]).endsWith('.jsonl')) seen.push(`readFileSync ${String(args[0])}`);
    return realReadFile.apply(fs, args);
  }) as never);
  return seen;
}

let shared: { file: string; lines: string[] };
beforeAll(() => { shared = writeBigLog(); });

// The shared log, or a private copy for a test that changes it.
function bigLog({ copy = false } = {}): { file: string; lines: string[] } {
  if (!copy) return shared;
  const file = path.join(tempDir('petal-big-log-'), 'big.jsonl');
  fs.copyFileSync(shared.file, file);
  return { file, lines: shared.lines };
}

describe('a large log', () => {
  it('JsonlTail hands over every line, in batches of at most one chunk, with turns between them', async () => {
    const { file, lines } = bigLog();
    expect(fs.statSync(file).size).toBeGreaterThan(TARGET_BYTES);
    const batches: string[][] = [];
    const reads = watchBigSyncReads();
    const { turns } = await turnsDuring(async () => {
      const tail = new JsonlTail(file, { lines: (batch) => batches.push(batch) });
      await tail.firstRead;
      tail.stop();
    });
    expect(reads).toEqual([]);
    expect(batches.flat()).toEqual(lines);
    expect(batches.length).toBeGreaterThanOrEqual(16);
    for (const batch of batches) expect(batch.reduce((sum, line) => sum + Buffer.byteLength(line) + 1, 0)).toBeLessThanOrEqual(READ_CHUNK_BYTES + 4096);
    expect(turns).toBeGreaterThanOrEqual(batches.length / 2);
  });

  it('TranscriptTail sends one update once caught up, the same view a whole-file read gives', async () => {
    const { file, lines } = bigLog();
    const expected = new ReplyCollector();
    for (const line of lines) expected.add(parseEntry(line));
    const views: TranscriptView[] = [];
    const { turns } = await turnsDuring(async () => {
      const tail = new TranscriptTail(file, (view) => views.push(view));
      await tail.poll();
      tail.stop();
    });
    expect(views).toHaveLength(1);
    expect(views[0]).toEqual({ replies: expected.newestFirst(), waiting: expected.waiting(), promptCount: expected.promptCount });
    expect(turns).toBeGreaterThan(10);
  });

  it('lines appended during the first read are read once, after it', async () => {
    const { file, lines } = bigLog({ copy: true });
    const seen: string[] = [];
    let appended = false;
    const tail = new JsonlTail(file, {
      lines: (batch) => {
        seen.push(...batch);
        if (!appended) { appended = true; fs.appendFileSync(file, 'late\n'); void tail.poll(); }
      },
    });
    await tail.firstRead;
    tail.stop();
    expect(seen).toEqual([...lines, 'late']);
  });

  it('stop() during the read hands over nothing more', async () => {
    const { file } = bigLog();
    let batches = 0;
    const tail = new JsonlTail(file, { lines: () => { batches += 1; if (batches === 2) tail.stop(); } });
    await tail.firstRead;
    expect(batches).toBe(2);
  });

  it('the testing scan and the agents list read it async too, with the same results', async () => {
    const { file, lines } = bigLog();
    const reads = watchBigSyncReads();
    const scan = await turnsDuring(() => scanLog(file, 'sess'));
    expect(scan.result.calls).toHaveLength(400); // MAX_CALLS, newest kept
    expect(scan.result.calls.at(-1)?.id).toBe(`tool${lines.length / 4 - 1}`);
    expect(scan.turns).toBeGreaterThan(10);

    const dir = tempDir('petal-big-agents-');
    fs.copyFileSync(file, path.join(dir, 'agent-big.jsonl'));
    const listing = await turnsDuring(() => listAgents(dir));
    expect(listing.result.agents[0]?.toolCalls).toBe(lines.length / 4);
    expect(listing.turns).toBeGreaterThan(10);

    const timeline = new AgentTimeline(path.join(dir, 'agent-big.jsonl'), () => {});
    const started = await turnsDuring(() => timeline.start());
    timeline.stop();
    expect(started.result.items.length).toBeGreaterThan(0); // a log this long once overflowed the stack here
    expect(started.turns).toBeGreaterThan(10);
    expect(reads).toEqual([]);
  });

  it('two scans of one log at once never read a line twice', async () => {
    const { file, lines } = bigLog();
    const [a, b] = await Promise.all([scanLog(file, 'sess'), scanLog(file, 'sess')]);
    expect(a.calls.map((c) => c.id)).toEqual(b.calls.map((c) => c.id));
    expect(new Set(b.calls.map((c) => c.id)).size).toBe(b.calls.length);
    expect(b.calls.at(-1)?.id).toBe(`tool${lines.length / 4 - 1}`);
  });
});

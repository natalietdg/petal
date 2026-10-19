// Each session's code turns, read incrementally: a log is parsed once, and later asks read only what was appended.
// Async, a chunk at a time, so a long log never blocks the main process. The few most recent logs stay in memory.
import fs from 'node:fs';
import { CodeChangeCollector, type CodeTurn } from './code-changes';
import { READ_CHUNK_BYTES, splitCompleteLines } from './transcript';
import { parseEntry } from './transcript-entry';

const KEPT_LOGS = 6;
const MAX_CURRENT_BYTES = 2 * 1024 * 1024; // a file on disk read for context only up to this size

interface Indexed {
  collector: CodeChangeCollector;
  offset: number;
  inode: number;
  carry: Buffer;
}

const logs = new Map<string, Indexed>(); // by transcript path, oldest first

// Only plain, smallish files: this reads code for context, never anything else.
export function readCurrent(file: string): string | null {
  try {
    const stat = fs.statSync(file);
    return stat.isFile() && stat.size <= MAX_CURRENT_BYTES ? fs.readFileSync(file, 'utf8') : null;
  } catch {
    return null;
  }
}

const fresh = (inode: number): Indexed => ({ collector: new CodeChangeCollector(readCurrent), offset: 0, inode, carry: Buffer.alloc(0) });

async function readAppended(indexed: Indexed, file: string): Promise<Indexed> {
  const handle = await fs.promises.open(file, 'r');
  try {
    const { size, ino } = await handle.stat();
    const target = size < indexed.offset || ino !== indexed.inode ? fresh(ino) : indexed; // rewritten: start over
    const buffer = Buffer.alloc(Math.min(READ_CHUNK_BYTES, Math.max(0, size - target.offset)));
    while (target.offset < size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, size - target.offset), target.offset);
      if (!bytesRead) break;
      target.offset += bytesRead;
      const { lines, rest } = splitCompleteLines(target.carry, buffer.subarray(0, bytesRead));
      target.carry = rest;
      for (const line of lines) {
        try { if (line) target.collector.add(parseEntry(line)); } catch { /* a malformed line */ }
      }
      await new Promise((resolve) => setImmediate(resolve)); // let the main process breathe between chunks
    }
    return target;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

const queued = new Map<string, Promise<CodeTurn[]>>(); // one read at a time per log

async function readOne(file: string): Promise<CodeTurn[]> {
  const indexed = await readAppended(logs.get(file) ?? fresh(-1), file);
  logs.delete(file);
  logs.set(file, indexed); // most recent last
  while (logs.size > KEPT_LOGS) logs.delete(logs.keys().next().value as string);
  return indexed.collector.changed();
}

// The session's turns that changed code, up to the end of its log right now.
export function codeTurns(file: string): Promise<CodeTurn[]> {
  const run = (queued.get(file) ?? Promise.resolve([])).catch(() => []).then(() => readOne(file));
  queued.set(file, run);
  void run.catch(() => undefined).finally(() => { if (queued.get(file) === run) queued.delete(file); });
  return run;
}

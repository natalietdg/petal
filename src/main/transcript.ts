// Tails one Claude Code session log and reports its replies.
import fs from 'node:fs';
import path from 'node:path';
import { ReplyCollector } from './replies';
import { parseEntry } from './transcript-entry';
import type { Reply, WaitingPrompt } from '../shared/types';

export interface TranscriptView {
  replies: Reply[];
  waiting: WaitingPrompt[];
  promptCount: number;
}

export type OnTranscript = (view: TranscriptView) => void;

const NEWLINE = 0x0a;

// Splits on newline bytes, so a read that ends mid-line (or mid-character) keeps the tail for the next read.
export function splitCompleteLines(carry: Buffer, chunk: Buffer): { lines: string[]; rest: Buffer } {
  const data = carry.length ? Buffer.concat([carry, chunk]) : chunk;
  const lines: string[] = [];
  let start = 0;
  for (let end = data.indexOf(NEWLINE); end !== -1; end = data.indexOf(NEWLINE, start)) {
    lines.push(data.toString('utf8', start, end));
    start = end + 1;
  }
  return { lines, rest: Buffer.from(data.subarray(start)) };
}

// Bytes per read: a long log is taken in a chunk at a time, so the main thread gets a turn between chunks.
export const READ_CHUNK_BYTES = 1024 * 1024;

export interface JsonlTailHandlers {
  lines: (lines: string[]) => void;
  restart?: () => void; // the file was truncated or replaced: everything read so far is gone, lines come again from the top
  caughtUp?: () => void; // a read reached the end of the file
}

// Follows one append-only jsonl: fs.watch reads new lines as they land, poll() is the tick fallback.
// Reads are async and one at a time; a change during a read gets one more pass, so no line is missed or read twice.
export class JsonlTail {
  private readonly file: string;
  private readonly handlers: JsonlTailHandlers;
  private offset = 0;
  private inode: number | null = null;
  private partialLine: Buffer = Buffer.alloc(0);
  private watcher: fs.FSWatcher | null = null;
  private reading: Promise<void> | null = null;
  private readAgain = false;
  private stopped = false;
  readonly firstRead: Promise<void>;

  constructor(file: string, handlers: JsonlTailHandlers) {
    this.file = file;
    this.handlers = handlers;
    this.firstRead = this.poll();
  }

  // Resolves once everything the file held when called has been handed to `lines`.
  poll(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (!this.watcher) this.watch();
    return this.readAppended();
  }

  private watch(): void {
    try {
      this.watcher = fs.watch(this.file, (event) => {
        if (event === 'rename') this.unwatch(); // replaced or removed: the next tick re-attaches
        void this.readAppended();
      });
    } catch {
      this.watchForCreation();
    }
  }

  // Claude writes the log on its first message; watch its folder so that message isn't a tick late.
  private watchForCreation(): void {
    try {
      const name = path.basename(this.file);
      this.watcher = fs.watch(path.dirname(this.file), (_event, changed) => {
        if (changed !== name || !fs.existsSync(this.file)) return;
        this.unwatch();
        void this.poll();
      });
    } catch {
      // No folder yet either; the next tick retries.
    }
  }

  private unwatch(): void {
    this.watcher?.close();
    this.watcher = null;
  }

  private readAppended(): Promise<void> {
    if (this.reading) {
      this.readAgain = true;
      return this.reading;
    }
    const run = async (): Promise<void> => {
      do {
        this.readAgain = false;
        await this.readToEnd();
      } while (this.readAgain && !this.stopped);
    };
    this.reading = run().finally(() => { this.reading = null; });
    return this.reading;
  }

  // Never throws: it runs from a watch callback too, and an unreadable log is retried on the next tick.
  private async readToEnd(): Promise<void> {
    let handle: fs.promises.FileHandle;
    try {
      handle = await fs.promises.open(this.file, 'r');
    } catch {
      return;
    }
    try {
      const { size, ino } = await handle.stat();
      if (size < this.offset || (this.inode !== null && ino !== this.inode)) this.restart();
      this.inode = ino;
      const buffer = Buffer.alloc(Math.min(READ_CHUNK_BYTES, Math.max(0, size - this.offset)));
      while (this.offset < size && !this.stopped) {
        const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, size - this.offset), this.offset);
        if (!bytesRead) break;
        this.offset += bytesRead;
        const { lines, rest } = splitCompleteLines(this.partialLine, buffer.subarray(0, bytesRead));
        this.partialLine = rest;
        if (lines.length && !this.stopped) this.handlers.lines(lines);
      }
    } catch {
      return;
    } finally {
      await handle.close().catch(() => undefined);
    }
    if (!this.stopped) this.handlers.caughtUp?.();
  }

  private restart(): void {
    this.offset = 0;
    this.partialLine = Buffer.alloc(0);
    this.handlers.restart?.();
  }

  stop(): void {
    this.stopped = true;
    this.unwatch();
  }
}

// One update per read that reached the end of the log, however many chunks it took.
export class TranscriptTail {
  private readonly onUpdate: OnTranscript;
  private collector = new ReplyCollector();
  private changed = false;
  private readonly tail: JsonlTail;

  constructor(file: string, onUpdate: OnTranscript) {
    this.onUpdate = onUpdate;
    this.tail = new JsonlTail(file, { lines: (lines) => this.add(lines), restart: () => this.restart(), caughtUp: () => this.flush() });
  }

  // A rewritten log is re-read from the top; the old replies go first so none is counted twice.
  private restart(): void {
    this.collector = new ReplyCollector();
    this.changed = false;
    this.onUpdate(this.view());
  }

  // Called on every session tick as a fallback; fs.watch reads new lines as soon as they land.
  poll(): Promise<void> {
    return this.tail.poll();
  }

  private add(lines: string[]): void {
    for (const line of lines) {
      try {
        const entry = parseEntry(line);
        this.changed = this.collector.add(entry) || this.changed;
      } catch {
        // Skip malformed lines.
      }
    }
  }

  private flush(): void {
    if (!this.changed) return;
    this.changed = false;
    this.onUpdate(this.view());
  }

  private view(): TranscriptView {
    return {
      replies: this.collector.newestFirst(),
      waiting: this.collector.waiting(),
      promptCount: this.collector.promptCount,
    };
  }

  stop(): void {
    this.tail.stop();
  }
}

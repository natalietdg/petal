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

export class TranscriptTail {
  private readonly file: string;
  private readonly onUpdate: OnTranscript;
  private offset = 0;
  private partialLine: Buffer = Buffer.alloc(0);
  private readonly collector = new ReplyCollector();
  private watcher: fs.FSWatcher | null = null;

  constructor(file: string, onUpdate: OnTranscript) {
    this.file = file;
    this.onUpdate = onUpdate;
    this.poll();
  }

  // Called on every session tick as a fallback; fs.watch reads new lines as soon as they land.
  poll(): void {
    if (!this.watcher) this.watch();
    this.readAppended();
  }

  private watch(): void {
    try {
      this.watcher = fs.watch(this.file, (event) => {
        if (event === 'rename') this.unwatch(); // replaced or removed: the next tick re-attaches
        this.readAppended();
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
        this.poll();
      });
    } catch {
      // No folder yet either; the next tick retries.
    }
  }

  private unwatch(): void {
    this.watcher?.close();
    this.watcher = null;
  }

  private readAppended(): void {
    let size: number;
    try {
      size = fs.statSync(this.file).size;
    } catch {
      return;
    }
    if (size <= this.offset) return;

    const buffer = Buffer.alloc(size - this.offset);
    let read: number;
    try {
      const fd = fs.openSync(this.file, 'r');
      try {
        read = fs.readSync(fd, buffer, 0, buffer.length, this.offset);
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return; // runs from a watch callback too, where a throw would be uncaught
    }
    this.offset += read;

    const { lines, rest } = splitCompleteLines(this.partialLine, buffer.subarray(0, read));
    this.partialLine = rest;
    let changed = false;
    for (const line of lines) {
      try {
        const entry = parseEntry(line);
        changed = this.collector.add(entry) || changed;
      } catch {
        // Skip malformed lines.
      }
    }
    if (changed) this.onUpdate(this.view());
  }

  private view(): TranscriptView {
    return {
      replies: this.collector.newestFirst(),
      waiting: this.collector.waiting(),
      promptCount: this.collector.promptCount,
    };
  }

  stop(): void {
    this.unwatch();
  }
}

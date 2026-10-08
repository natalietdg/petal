// Tails one Claude Code session log and reports its replies and any question Claude is waiting on.
import fs from 'node:fs';
import path from 'node:path';
import { ReplyCollector } from './replies';
import { PendingQuestionTracker } from './pending-question';
import { parseEntry } from './transcript-entry';
import type { PendingQuestion } from '../shared/prompt-answer';
import type { Reply, WaitingPrompt } from '../shared/types';

export interface TranscriptView {
  replies: Reply[];
  waiting: WaitingPrompt[];
  promptCount: number;
  question: PendingQuestion | null;
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

// Follows one append-only jsonl: fs.watch reads new lines as they land, poll() is the tick fallback.
export class JsonlTail {
  private readonly file: string;
  private readonly onLines: (lines: string[]) => void;
  private offset = 0;
  private partialLine: Buffer = Buffer.alloc(0);
  private watcher: fs.FSWatcher | null = null;

  constructor(file: string, onLines: (lines: string[]) => void) {
    this.file = file;
    this.onLines = onLines;
    this.poll();
  }

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
    if (lines.length) this.onLines(lines);
  }

  stop(): void {
    this.unwatch();
  }
}

export class TranscriptTail {
  private readonly onUpdate: OnTranscript;
  private readonly collector = new ReplyCollector();
  private readonly question = new PendingQuestionTracker();
  private readonly tail: JsonlTail;

  constructor(file: string, onUpdate: OnTranscript) {
    this.onUpdate = onUpdate;
    this.tail = new JsonlTail(file, (lines) => this.add(lines));
  }

  // Called on every session tick as a fallback; fs.watch reads new lines as soon as they land.
  poll(): void {
    this.tail.poll();
  }

  private add(lines: string[]): void {
    let changed = false;
    for (const line of lines) {
      try {
        const entry = parseEntry(line);
        const repliesChanged = this.collector.add(entry);
        changed = this.question.add(entry) || repliesChanged || changed;
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
      question: this.question.current(),
    };
  }

  stop(): void {
    this.tail.stop();
  }
}

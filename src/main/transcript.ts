// Tails one Claude Code session log and reports its replies and any question Claude is waiting on.
import fs from 'node:fs';
import { ReplyCollector } from './replies';
import { PendingQuestionTracker } from './pending-question';
import { parseEntry } from './transcript-entry';
import type { PendingQuestion } from '../shared/prompt-answer';
import type { Reply } from '../shared/types';

export type OnTranscript = (replies: Reply[], question: PendingQuestion | null) => void;

const DEBOUNCE_MS = 80;

export class TranscriptTail {
  private readonly file: string;
  private readonly onReplies: OnTranscript;
  private offset = 0;
  private partialLine = '';
  private readonly collector = new ReplyCollector();
  private readonly question = new PendingQuestionTracker();
  private watcher: fs.FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | undefined;

  constructor(file: string, onReplies: OnTranscript) {
    this.file = file;
    this.onReplies = onReplies;
    this.poll();
  }

  // Called on every session tick; fs.watch only speeds it up once the file exists.
  poll(): void {
    if (!this.watcher) this.watch();
    this.readAppended();
  }

  private watch(): void {
    try {
      this.watcher = fs.watch(this.file, () => {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => this.readAppended(), DEBOUNCE_MS);
      });
    } catch {
      // Claude writes the log on its first message; the next tick retries.
    }
  }

  private readAppended(): void {
    let size: number;
    try {
      size = fs.statSync(this.file).size;
    } catch {
      return;
    }
    if (size <= this.offset) return;

    const fd = fs.openSync(this.file, 'r');
    const buffer = Buffer.alloc(size - this.offset);
    fs.readSync(fd, buffer, 0, buffer.length, this.offset);
    fs.closeSync(fd);
    this.offset = size;

    const lines = (this.partialLine + buffer.toString('utf8')).split('\n');
    this.partialLine = lines.pop() ?? '';
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
    if (changed) this.onReplies(this.collector.newestFirst(), this.question.current());
  }

  stop(): void {
    clearTimeout(this.debounceTimer);
    this.watcher?.close();
  }
}

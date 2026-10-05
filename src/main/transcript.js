// Tails one Claude Code session log and reports its replies.
const fs = require('node:fs');
const { ReplyCollector } = require('./replies');

const DEBOUNCE_MS = 80;

class TranscriptTail {
  constructor(file, onReplies) {
    this.file = file;
    this.onReplies = onReplies;
    this.offset = 0;
    this.partialLine = '';
    this.collector = new ReplyCollector();
    this.watcher = null;
    this.debounceTimer = null;
    this.poll();
  }

  // Called on every session tick; fs.watch only speeds it up once the file exists.
  poll() {
    if (!this.watcher) this.watch();
    this.readAppended();
  }

  watch() {
    try {
      this.watcher = fs.watch(this.file, () => {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => this.readAppended(), DEBOUNCE_MS);
      });
    } catch {
      // Claude writes the log on its first message; the next tick retries.
    }
  }

  readAppended() {
    let size;
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
    this.partialLine = lines.pop();
    let changed = false;
    for (const line of lines) {
      try {
        changed = this.collector.add(JSON.parse(line)) || changed;
      } catch {
        // Skip malformed lines.
      }
    }
    if (changed) this.onReplies(this.collector.newestFirst());
  }

  stop() {
    clearTimeout(this.debounceTimer);
    this.watcher?.close();
  }
}

module.exports = { TranscriptTail };

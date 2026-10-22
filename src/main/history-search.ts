// Full-text search over History's transcripts: her prompts and Claude's replies, no tool noise.
// Each log is read once, in chunks with a yield between them, then only its new lines as it grows.
import fs from 'node:fs';
import { READ_CHUNK_BYTES, splitCompleteLines } from './transcript';
import { isTextItem, parseEntry, type TranscriptEntry } from './transcript-entry';
import { contentItems, promptText } from './prompts';

export const MIN_QUERY_CHARS = 2; // one letter matches nearly every conversation
const MAX_TEXT_CHARS = 1_000_000; // per log; a longer one is searched up to here
const SNIPPET_BEFORE = 40;
const SNIPPET_AFTER = 90;

export interface TranscriptMatch {
  file: string;
  snippet: string;
}

interface Indexed {
  ino: number; // a replaced log is read from the top
  size: number;
  mtimeMs: number;
  offset: number; // bytes read as whole lines; a partial last line is read again next time
  text: string;
}

const yieldToEvents = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

// The searchable words of one log entry: her prompt, or Claude's text; '' for tool calls, results and side chains.
export function entryText(entry: TranscriptEntry): string {
  if (entry.type === 'assistant' && !entry.isSidechain) return contentItems(entry).filter(isTextItem).map((item) => item.text).join('\n');
  return promptText(entry);
}

function textOfLines(lines: string[]): string {
  const parts: string[] = [];
  for (const line of lines) {
    if (!line) continue;
    try {
      const text = entryText(parseEntry(line));
      if (text) parts.push(text);
    } catch {
      // a line still being written, or not JSON: skipped
    }
  }
  return parts.join('\n');
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A short window around the match, on one line, with … where it was cut.
export function snippetAround(text: string, at: number, length: number): string {
  const start = Math.max(0, at - SNIPPET_BEFORE);
  const end = Math.min(text.length, at + length + SNIPPET_AFTER);
  const body = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${body}${end < text.length ? '…' : ''}`;
}

export class TranscriptIndex {
  private readonly indexed = new Map<string, Indexed>();
  private pass: Promise<void> = Promise.resolve();

  // Brings every given log up to date, one pass at a time; logs no longer listed are dropped.
  refresh(files: readonly string[]): Promise<void> {
    this.pass = this.pass.then(() => this.refreshNow(files));
    return this.pass;
  }

  async search(files: readonly string[], query: string): Promise<TranscriptMatch[]> {
    const needle = query.trim();
    if (needle.length < MIN_QUERY_CHARS) return [];
    await this.refresh(files);
    const pattern = new RegExp(escapeRegExp(needle), 'i');
    return files.flatMap((file) => {
      const text = this.indexed.get(file)?.text ?? '';
      const found = pattern.exec(text);
      return found ? [{ file, snippet: snippetAround(text, found.index, found[0].length) }] : [];
    });
  }

  // How far each log has been read, for tests.
  readOffset(file: string): number | undefined {
    return this.indexed.get(file)?.offset;
  }

  private async refreshNow(files: readonly string[]): Promise<void> {
    const wanted = new Set(files);
    for (const file of this.indexed.keys()) if (!wanted.has(file)) this.indexed.delete(file);
    for (const file of files) {
      await this.update(file);
      await yieldToEvents();
    }
  }

  private async update(file: string): Promise<void> {
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(file);
    } catch {
      this.indexed.delete(file); // deleted since it was listed
      return;
    }
    const known = this.indexed.get(file);
    if (known && known.size === stat.size && known.mtimeMs === stat.mtimeMs) return;
    const grew = known && known.ino === stat.ino && stat.size >= known.offset;
    const from = grew ? known : { ino: stat.ino, size: 0, mtimeMs: 0, offset: 0, text: '' }; // new, shrunk or replaced: read from the top
    this.indexed.set(file, await this.readFrom(file, from, stat));
  }

  private async readFrom(file: string, from: Indexed, stat: fs.Stats): Promise<Indexed> {
    let { offset, text } = from;
    let handle: fs.promises.FileHandle | undefined;
    try {
      handle = await fs.promises.open(file, 'r');
      let carry: Buffer = Buffer.alloc(0);
      while (offset + carry.length < stat.size && text.length < MAX_TEXT_CHARS) {
        const chunk = Buffer.alloc(Math.min(READ_CHUNK_BYTES, stat.size - offset - carry.length));
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, offset + carry.length);
        if (!bytesRead) break;
        const { lines, rest } = splitCompleteLines(carry, chunk.subarray(0, bytesRead));
        offset += carry.length + bytesRead - rest.length;
        carry = rest;
        const added = textOfLines(lines);
        if (added) text = (text ? `${text}\n${added}` : added).slice(0, MAX_TEXT_CHARS);
        await yieldToEvents();
      }
    } catch {
      // unreadable right now: keep what was read, try again next search
    } finally {
      await handle?.close();
    }
    return { ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, offset, text };
  }
}

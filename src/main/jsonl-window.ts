// Reads a bounded slice of a jsonl file (head or tail) and parses whole lines only.
import fs from 'node:fs';
import { parseEntry, type TranscriptEntry } from './transcript-entry';

export interface JsonlSlice {
  entries: TranscriptEntry[];
  covered: boolean;
}

function readSlice(file: string, fromEnd: boolean, bytes: number): JsonlSlice {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, 'r');
    const { size } = fs.fstatSync(fd);
    const length = Math.min(size, bytes);
    const start = fromEnd ? size - length : 0;
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, start);
    const lines = buffer.toString('utf8').split('\n');
    if (fromEnd && start > 0) lines.shift(); // cut mid-line
    if (!fromEnd && length < size) lines.pop();
    const entries = lines.flatMap((line) => {
      try { return line ? [parseEntry(line)] : []; } catch { return []; }
    });
    return { entries, covered: length === size };
  } catch {
    return { entries: [], covered: false };
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

export const readHead = (file: string, bytes: number): JsonlSlice => readSlice(file, false, bytes);
export const readTail = (file: string, bytes: number): JsonlSlice => readSlice(file, true, bytes);

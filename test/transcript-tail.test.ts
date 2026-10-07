// Tailing the session log: whole lines only, byte-safe across reads, and her prompt reported before any reply.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TranscriptTail, splitCompleteLines, type TranscriptView } from '../src/main/transcript';
import { assistantEntry, removeTempDirs, tempDir, userEntry } from './helpers';

afterEach(removeTempDirs);

const bytes = (text: string): Buffer => Buffer.from(text, 'utf8');

describe('splitCompleteLines', () => {
  it('returns complete lines and keeps the unfinished tail', () => {
    const { lines, rest } = splitCompleteLines(Buffer.alloc(0), bytes('one\ntwo\nthr'));
    expect(lines).toEqual(['one', 'two']);
    expect(rest.toString('utf8')).toBe('thr');
  });

  it('joins the carried tail with the next read', () => {
    const first = splitCompleteLines(Buffer.alloc(0), bytes('{"a":'));
    const second = splitCompleteLines(first.rest, bytes('1}\n'));
    expect(first.lines).toEqual([]);
    expect(second.lines).toEqual(['{"a":1}']);
    expect(second.rest.length).toBe(0);
  });

  it('keeps a character split across two reads intact', () => {
    const line = bytes('pastel 🌸 café\n');
    const cut = line.indexOf(0xf0) + 2; // inside the 4-byte flower
    const first = splitCompleteLines(Buffer.alloc(0), line.subarray(0, cut));
    const second = splitCompleteLines(first.rest, line.subarray(cut));
    expect(second.lines).toEqual(['pastel 🌸 café']);
  });

  it('copies the tail, so reusing the read buffer cannot change it', () => {
    const chunk = bytes('a\nbc');
    const { rest } = splitCompleteLines(Buffer.alloc(0), chunk);
    chunk.fill(0);
    expect(rest.toString('utf8')).toBe('bc');
  });
});

describe('TranscriptTail', () => {
  const line = (entry: object): string => `${JSON.stringify(entry)}\n`;

  it('reports her prompt as waiting before Claude writes any text, then moves it onto the reply', () => {
    const file = path.join(tempDir(), 's.jsonl');
    fs.writeFileSync(file, line(userEntry('first question')));
    const views: TranscriptView[] = [];
    const tail = new TranscriptTail(file, (view) => views.push(view));
    expect(views.at(-1)).toMatchObject({ replies: [], promptCount: 1, waiting: [{ id: 'u-first qu', prompt: 'first question' }] });

    fs.appendFileSync(file, line(assistantEntry('the answer', 'a1')));
    tail.poll();
    tail.stop();
    expect(views.at(-1)).toMatchObject({ waiting: [], promptCount: 1, replies: [{ id: 'a1', prompt: 'first question', markdown: 'the answer' }] });
  });

  it('parses a line written in two pieces, split inside a character, exactly once', () => {
    const file = path.join(tempDir(), 's.jsonl');
    const full = bytes(line(assistantEntry('hello 🌸', 'a1')));
    const cut = full.indexOf(0xf0) + 1;
    fs.writeFileSync(file, full.subarray(0, cut));
    const views: TranscriptView[] = [];
    const tail = new TranscriptTail(file, (view) => views.push(view));
    expect(views).toHaveLength(0);
    fs.appendFileSync(file, full.subarray(cut));
    tail.poll();
    tail.poll();
    tail.stop();
    expect(views).toHaveLength(1);
    expect(views[0]?.replies[0]?.markdown).toBe('hello 🌸');
  });

  it('starts reading once the log is created after it was followed', () => {
    const file = path.join(tempDir(), 'later.jsonl');
    const views: TranscriptView[] = [];
    const tail = new TranscriptTail(file, (view) => views.push(view));
    fs.writeFileSync(file, line(userEntry('hi')));
    tail.poll(); // the session tick's fallback
    tail.stop();
    expect(views.at(-1)?.waiting.map((w) => w.prompt)).toEqual(['hi']);
  });
});

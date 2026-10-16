// Tailing the session log: whole lines only, byte-safe across reads, and her prompt reported before any reply.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { JsonlTail, TranscriptTail, splitCompleteLines, type TranscriptView } from '../src/main/transcript';
import { assistantEntry, removeTempDirs, tempDir, userEntry } from './helpers';

afterEach(removeTempDirs);

const bytes = (text: string): Buffer => Buffer.from(text, 'utf8');

describe('splitCompleteLines', () => {
  it('returns complete lines and keeps the unfinished tail', async () => {
    const { lines, rest } = splitCompleteLines(Buffer.alloc(0), bytes('one\ntwo\nthr'));
    expect(lines).toEqual(['one', 'two']);
    expect(rest.toString('utf8')).toBe('thr');
  });

  it('joins the carried tail with the next read', async () => {
    const first = splitCompleteLines(Buffer.alloc(0), bytes('{"a":'));
    const second = splitCompleteLines(first.rest, bytes('1}\n'));
    expect(first.lines).toEqual([]);
    expect(second.lines).toEqual(['{"a":1}']);
    expect(second.rest.length).toBe(0);
  });

  it('keeps a character split across two reads intact', async () => {
    const line = bytes('pastel 🌸 café\n');
    const cut = line.indexOf(0xf0) + 2; // inside the 4-byte flower
    const first = splitCompleteLines(Buffer.alloc(0), line.subarray(0, cut));
    const second = splitCompleteLines(first.rest, line.subarray(cut));
    expect(second.lines).toEqual(['pastel 🌸 café']);
  });

  it('copies the tail, so reusing the read buffer cannot change it', async () => {
    const chunk = bytes('a\nbc');
    const { rest } = splitCompleteLines(Buffer.alloc(0), chunk);
    chunk.fill(0);
    expect(rest.toString('utf8')).toBe('bc');
  });
});

describe('TranscriptTail', () => {
  const line = (entry: object): string => `${JSON.stringify(entry)}\n`;

  it('reports her prompt as waiting before Claude writes any text, then moves it onto the reply', async () => {
    const file = path.join(tempDir(), 's.jsonl');
    fs.writeFileSync(file, line(userEntry('first question')));
    const views: TranscriptView[] = [];
    const tail = new TranscriptTail(file, (view) => views.push(view));
    await tail.poll(); // the first read is async
    expect(views.at(-1)).toMatchObject({ replies: [], promptCount: 1, waiting: [{ id: 'u-first qu', prompt: 'first question' }] });

    fs.appendFileSync(file, line(assistantEntry('the answer', 'a1')));
    await tail.poll();
    tail.stop();
    expect(views.at(-1)).toMatchObject({ waiting: [], promptCount: 1, replies: [{ id: 'a1', prompt: 'first question', markdown: 'the answer' }] });
  });

  it('parses a line written in two pieces, split inside a character, exactly once', async () => {
    const file = path.join(tempDir(), 's.jsonl');
    const full = bytes(line(assistantEntry('hello 🌸', 'a1')));
    const cut = full.indexOf(0xf0) + 1;
    fs.writeFileSync(file, full.subarray(0, cut));
    const views: TranscriptView[] = [];
    const tail = new TranscriptTail(file, (view) => views.push(view));
    await tail.poll(); // the first read is async
    expect(views).toHaveLength(0);
    fs.appendFileSync(file, full.subarray(cut));
    await tail.poll();
    await tail.poll();
    tail.stop();
    expect(views).toHaveLength(1);
    expect(views[0]?.replies[0]?.markdown).toBe('hello 🌸');
  });

  it('starts reading once the log is created after it was followed', async () => {
    const file = path.join(tempDir(), 'later.jsonl');
    const views: TranscriptView[] = [];
    const tail = new TranscriptTail(file, (view) => views.push(view));
    await tail.poll(); // the first read is async
    fs.writeFileSync(file, line(userEntry('hi')));
    await tail.poll(); // the session tick's fallback
    tail.stop();
    expect(views.at(-1)?.waiting.map((w) => w.prompt)).toEqual(['hi']);
  });
});

describe('rewritten or truncated logs', () => {
  const line = (entry: object): string => `${JSON.stringify(entry)}\n`;
  it('a truncated file is re-read from the top instead of stalling', async () => {
    const file = path.join(tempDir(), 't.jsonl');
    fs.writeFileSync(file, 'one\ntwo\nthree\n');
    const seen: string[][] = [];
    let restarts = 0;
    const tail = new JsonlTail(file, { lines: (lines) => seen.push(lines), restart: () => { restarts += 1; } });
    await tail.firstRead;
    fs.writeFileSync(file, 'new\n'); // shorter than what was read
    await tail.poll();
    fs.appendFileSync(file, 'more\n');
    await tail.poll();
    tail.stop();
    expect(seen).toEqual([['one', 'two', 'three'], ['new'], ['more']]);
    expect(restarts).toBe(1);
  });

  it('a file replaced by another (new inode) is re-read even when it is longer', async () => {
    const dir = tempDir();
    const file = path.join(dir, 'r.jsonl');
    fs.writeFileSync(file, 'a\n');
    const seen: string[][] = [];
    const tail = new JsonlTail(file, { lines: (lines) => seen.push(lines) });
    await tail.firstRead;
    const next = path.join(dir, 'r.next');
    fs.writeFileSync(next, 'b1\nb2\n');
    fs.renameSync(next, file);
    await tail.poll();
    tail.stop();
    expect(seen).toEqual([['a'], ['b1', 'b2']]);
  });

  it('TranscriptTail drops the old replies on a rewrite, so none is counted twice', async () => {
    const file = path.join(tempDir(), 's.jsonl');
    fs.writeFileSync(file, line(userEntry('first prompt')) + line(assistantEntry('old reply', 'a1')) + line(assistantEntry('another', 'a2')));
    const views: TranscriptView[] = [];
    const tail = new TranscriptTail(file, (view) => views.push(view));
    await tail.poll(); // the first read is async
    fs.writeFileSync(file, line(assistantEntry('only reply', 'a3')));
    await tail.poll();
    tail.stop();
    expect(views.at(-1)?.replies.map((r) => r.markdown)).toEqual(['only reply']);
  });
});

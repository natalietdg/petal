import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeFileAtomic, writeJsonAtomic } from '../src/main/atomic-file';
import { removeTempDirs, tempDir, tmpLeftovers } from './helpers';

afterEach(removeTempDirs);

describe('atomic-file', () => {
  it('writes the contents and leaves no .tmp', () => {
    const dir = tempDir();
    const file = path.join(dir, 'a.txt');
    writeFileAtomic(file, 'hello');
    expect(fs.readFileSync(file, 'utf8')).toBe('hello');
    expect(tmpLeftovers(dir)).toEqual([]);
  });

  it('overwrites an existing file', () => {
    const dir = tempDir();
    const file = path.join(dir, 'a.txt');
    writeFileAtomic(file, 'first, and longer');
    writeFileAtomic(file, 'second');
    expect(fs.readFileSync(file, 'utf8')).toBe('second');
    expect(fs.readdirSync(dir)).toEqual(['a.txt']);
  });

  it('creates missing parent folders', () => {
    const dir = tempDir();
    const file = path.join(dir, 'x', 'y', 'z.json');
    writeJsonAtomic(file, { ok: true });
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ ok: true });
  });

  it('writeJsonAtomic is compact by default and indents on request', () => {
    const dir = tempDir();
    const file = path.join(dir, 'd.json');
    writeJsonAtomic(file, { a: [1] });
    expect(fs.readFileSync(file, 'utf8')).toBe('{"a":[1]}');
    writeJsonAtomic(file, { a: [1] }, 2);
    expect(fs.readFileSync(file, 'utf8')).toBe('{\n  "a": [\n    1\n  ]\n}');
  });

  it('a failed write leaves the old file intact', () => {
    const dir = tempDir();
    const file = path.join(dir, 'keep.txt');
    writeFileAtomic(file, 'old');
    fs.mkdirSync(`${file}.${process.pid}.tmp`); // the temp path is taken, so writing it throws
    expect(() => writeFileAtomic(file, 'new')).toThrow();
    expect(fs.readFileSync(file, 'utf8')).toBe('old');
  });

  it('unserialisable JSON throws before touching the file', () => {
    const dir = tempDir();
    const file = path.join(dir, 'keep.json');
    writeJsonAtomic(file, { v: 1 });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => writeJsonAtomic(file, cyclic)).toThrow();
    expect(fs.readFileSync(file, 'utf8')).toBe('{"v":1}');
    expect(tmpLeftovers(dir)).toEqual([]);
  });
});

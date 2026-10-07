import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_AGE_MS, pasteDir, pasteFileName, removeStale, savePng } from '../src/main/paste-files';
import { pathsFromUriList, quotePath, quotePaths } from '../src/shared/quote-path';
import { removeTempDirs, tempDir } from './helpers';

afterEach(removeTempDirs);

// What a POSIX shell sees after parsing the typed words.
const throughShell = (typed: string): string[] =>
  execFileSync('/bin/sh', ['-c', `for w in ${typed}; do printf '%s\\0' "$w"; done`], { encoding: 'utf8' }).split('\0').slice(0, -1);

describe('quotePath', () => {
  it('leaves a plain path bare, like Terminal', () => {
    expect(quotePath('/var/folders/ab/T/petal-paste/paste-2026-10-07T01-02-03-004Z-a1b2c3d4.png')).toBe('/var/folders/ab/T/petal-paste/paste-2026-10-07T01-02-03-004Z-a1b2c3d4.png');
  });

  it.each([
    '/Users/n/Screen Shot 2026-10-07 at 9.41.12 AM.png',
    "/Users/n/it's here.txt",
    '/tmp/$HOME/`id`/$(touch x).md',
    '/tmp/semi;colon & amp|pipe',
    '/tmp/glob*?[x]',
    '/tmp/new\nline',
    '/tmp/ünïcode café.png',
  ])('a shell reads %j back as one word', (raw) => {
    expect(throughShell(quotePath(raw))).toEqual([raw]);
  });

  it('joins several paths as separate words', () => {
    const paths = ['/a/one.png', '/b/two words.png', "/c/it's.pdf"];
    expect(throughShell(quotePaths(paths))).toEqual(paths);
    expect(quotePaths(paths)).toBe("/a/one.png '/b/two words.png' '/c/it'\\''s.pdf'");
  });
});

describe('pathsFromUriList', () => {
  it('decodes file URLs and skips comments and web links', () => {
    const list = '# dragged\r\nfile:///Users/n/Screen%20Shot.png\r\nhttps://example.com/x.png\nfile:///tmp/it\'s.txt\n';
    expect(pathsFromUriList(list)).toEqual(['/Users/n/Screen Shot.png', "/tmp/it's.txt"]);
  });

  it('returns nothing for an empty list', () => {
    expect(pathsFromUriList('')).toEqual([]);
  });
});

describe('paste temp files', () => {
  it('lives in petal-paste under the temp root', () => {
    expect(pasteDir('/var/T')).toBe(path.join('/var/T', 'petal-paste'));
  });

  it('names files by time with a suffix, nothing a shell would split', () => {
    const name = pasteFileName(new Date('2026-10-07T01:02:03.004Z'), 'a1b2c3d4');
    expect(name).toBe('paste-2026-10-07T01-02-03-004Z-a1b2c3d4.png');
    expect(quotePath(name)).toBe(name);
  });

  it('saves the PNG bytes into a new folder, a fresh file each time', () => {
    const dir = path.join(tempDir(), 'petal-paste');
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const now = new Date('2026-10-07T01:02:03.004Z');
    const first = savePng(dir, png, now);
    const second = savePng(dir, png, now);
    expect(path.dirname(first)).toBe(dir);
    expect(first).not.toBe(second);
    expect(fs.readFileSync(first)).toEqual(png);
  });

  it('removes only its own files older than 24 hours', () => {
    const dir = tempDir();
    const now = Date.now();
    const touch = (name: string, ageMs: number) => {
      const file = path.join(dir, name);
      fs.writeFileSync(file, 'x');
      const at = new Date(now - ageMs);
      fs.utimesSync(file, at, at);
    };
    touch('paste-old.png', MAX_AGE_MS + 60_000);
    touch('paste-fresh.png', MAX_AGE_MS - 60_000);
    touch('not-ours.png', MAX_AGE_MS * 3);
    touch('paste-old.txt', MAX_AGE_MS * 3);
    expect(removeStale(dir, now)).toEqual(['paste-old.png']);
    expect(fs.readdirSync(dir).sort()).toEqual(['not-ours.png', 'paste-fresh.png', 'paste-old.txt']);
  });

  it('is quiet when the folder does not exist yet', () => {
    expect(removeStale(path.join(tempDir(), 'missing'))).toEqual([]);
  });
});

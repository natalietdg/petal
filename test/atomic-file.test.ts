import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { brokenName, readJsonOrSetAside, writeFileAtomic, writeFileDurable, writeJsonAtomic } from '../src/main/atomic-file';
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

  it('fsyncs the temp file before the rename', () => {
    const dir = tempDir();
    const order: string[] = [];
    const fsync = vi.spyOn(fs, 'fsyncSync').mockImplementation(() => { order.push('fsync'); });
    const rename = vi.spyOn(fs, 'renameSync');
    rename.mockImplementation((from, to) => { order.push('rename'); rename.mockRestore(); fs.renameSync(from, to); });
    writeFileAtomic(path.join(dir, 'f.txt'), 'x');
    fsync.mockRestore();
    expect(order).toEqual(['fsync', 'rename']);
  });
});

describe('readJsonOrSetAside', () => {
  it('names the set-aside file <name>.broken-<timestamp>.json', () => {
    expect(brokenName('/u/config.json', 123)).toBe('/u/config.broken-123.json');
  });

  it('returns parsed JSON, and undefined for a missing file without warning', () => {
    const dir = tempDir();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeJsonAtomic(path.join(dir, 'ok.json'), { a: 1 });
    expect(readJsonOrSetAside(path.join(dir, 'ok.json'))).toEqual({ a: 1 });
    expect(readJsonOrSetAside(path.join(dir, 'missing.json'))).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('moves an unparseable file aside with its bytes intact and warns once', () => {
    const dir = tempDir();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const file = path.join(dir, 'x.json');
    fs.writeFileSync(file, '{oops');
    expect(readJsonOrSetAside(file)).toBeUndefined();
    expect(readJsonOrSetAside(file)).toBeUndefined();
    const files = fs.readdirSync(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^x\.broken-\d+\.json$/);
    expect(fs.readFileSync(path.join(dir, files[0]), 'utf8')).toBe('{oops');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('writes over a symlink keep the link', () => {
  // A dotfiles-style setup: the real file lives in another folder and the path is a link to it.
  function linked(name = 'settings.json'): { dir: string; dotfiles: string; link: string; real: string } {
    const dir = tempDir();
    const dotfiles = tempDir('petal-dotfiles-');
    const real = path.join(dotfiles, name);
    fs.writeFileSync(real, 'old');
    const link = path.join(dir, name);
    fs.symlinkSync(real, link);
    return { dir, dotfiles, link, real };
  }

  it.each([
    ['writeFileAtomic', (file: string, text: string) => writeFileAtomic(file, text)],
    ['writeFileDurable', (file: string, text: string) => writeFileDurable(file, text)],
  ])('%s writes the target and leaves the link in place', (_name, write) => {
    const { dir, dotfiles, link, real } = linked();
    write(link, 'new');
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(link)).toBe(real);
    expect(fs.readFileSync(real, 'utf8')).toBe('new');
    expect([...tmpLeftovers(dir), ...tmpLeftovers(dotfiles)]).toEqual([]);
    expect(fs.readdirSync(dotfiles).filter((f) => f.startsWith('.'))).toEqual([]);
  });

  it('a relative link and a chain of links resolve to the last file', () => {
    const { dir, real } = linked('CLAUDE.md');
    const hop = path.join(dir, 'hop.md');
    fs.symlinkSync('CLAUDE.md', hop); // relative, to the first link
    writeFileDurable(hop, 'through two links');
    expect(fs.lstatSync(hop).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(real, 'utf8')).toBe('through two links');
  });

  it('a dangling link is filled in at its target, not replaced', () => {
    const dir = tempDir();
    const target = path.join(tempDir('petal-dotfiles-'), 'settings.json');
    const link = path.join(dir, 'settings.json');
    fs.symlinkSync(target, link);
    writeFileDurable(link, '{}');
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(target, 'utf8')).toBe('{}');
  });

  it('keeps the target file mode when asked', () => {
    const { link, real } = linked();
    fs.chmodSync(real, 0o600);
    writeFileDurable(link, 'new', fs.statSync(link).mode & 0o7777);
    expect(fs.statSync(real).mode & 0o777).toBe(0o600);
  });

  it('a loop of links is refused with a clear error', () => {
    const dir = tempDir();
    fs.symlinkSync(path.join(dir, 'b'), path.join(dir, 'a'));
    fs.symlinkSync(path.join(dir, 'a'), path.join(dir, 'b'));
    expect(() => writeFileDurable(path.join(dir, 'a'), 'x')).toThrow(/loop of symlinks/);
  });

  describe('within a root', () => {
    it('a link leading outside the root is refused and nothing is written', () => {
      const repo = tempDir('petal-repo-');
      const outside = path.join(tempDir('petal-outside-'), 'zshrc');
      fs.writeFileSync(outside, 'hers');
      fs.mkdirSync(path.join(repo, '.petal'));
      fs.symlinkSync(outside, path.join(repo, '.petal', 'factory.json'));
      expect(() => writeFileDurable(path.join(repo, '.petal', 'factory.json'), '{}', undefined, { within: repo }))
        .toThrow(/^Petal didn’t write .*factory\.json: it leads to .*zshrc, outside /);
      expect(fs.readFileSync(outside, 'utf8')).toBe('hers');
      expect(fs.lstatSync(path.join(repo, '.petal', 'factory.json')).isSymbolicLink()).toBe(true);
    });

    it('a linked folder leading outside the root is refused too', () => {
      const repo = tempDir('petal-repo-');
      const outside = tempDir('petal-outside-');
      fs.symlinkSync(outside, path.join(repo, '.petal'));
      expect(() => writeFileDurable(path.join(repo, '.petal', 'factory.json'), '{}', undefined, { within: repo })).toThrow(/outside/);
      expect(fs.readdirSync(outside)).toEqual([]);
    });

    it('a link that stays inside the root is written through', () => {
      const repo = tempDir('petal-repo-');
      fs.writeFileSync(path.join(repo, 'real.json'), 'old');
      fs.mkdirSync(path.join(repo, '.petal'));
      fs.symlinkSync('../real.json', path.join(repo, '.petal', 'factory.json'));
      writeFileDurable(path.join(repo, '.petal', 'factory.json'), 'new', undefined, { within: repo });
      expect(fs.readFileSync(path.join(repo, 'real.json'), 'utf8')).toBe('new');
    });

    it('a plain new file inside the root is written', () => {
      const repo = tempDir('petal-repo-');
      writeFileDurable(path.join(repo, 'new.txt'), 'hi', undefined, { within: repo });
      expect(fs.readFileSync(path.join(repo, 'new.txt'), 'utf8')).toBe('hi');
    });
  });
});

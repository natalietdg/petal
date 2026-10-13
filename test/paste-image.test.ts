import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readPromptImage, sniffImage, type ImagePlaces } from '../src/main/paste-image';
import { removeTempDirs, tempDir } from './helpers';

afterEach(removeTempDirs);

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGP439CAFTEMLQkACnZ/wR8hFMgAAAAASUVORK5CYII=', 'base64');

let places: ImagePlaces;
let outside: string;

beforeEach(() => {
  const root = tempDir('petal-guard-');
  places = { home: path.join(root, 'home'), temp: path.join(root, 'temp'), pasteDir: path.join(root, 'temp', 'petal-paste'), maxBytes: 1024 };
  outside = path.join(root, 'elsewhere');
  for (const dir of [places.home, places.pasteDir, outside]) fs.mkdirSync(dir, { recursive: true });
});

const write = (file: string, bytes: Buffer = PNG): string => {
  fs.writeFileSync(file, bytes);
  return file;
};

describe('readPromptImage', () => {
  it('serves a paste as a PNG data URL', async () => {
    const file = write(path.join(places.pasteDir, 'paste-1.png'));
    const result = await readPromptImage(file, '', places);
    expect(result).toEqual({ status: 'ok', dataUrl: `data:image/png;base64,${PNG.toString('base64')}` });
  });

  it('serves an image the prompt names under home, ~ included', async () => {
    const file = write(path.join(places.home, 'Shot 1.png'));
    expect((await readPromptImage(file, `see '${file}'`, places)).status).toBe('ok');
    expect((await readPromptImage('~/Shot 1.png', "see '~/Shot 1.png'", places)).status).toBe('ok');
  });

  it('refuses a home image the prompt does not name', async () => {
    const file = write(path.join(places.home, 'secret.png'));
    expect(await readPromptImage(file, 'nothing here', places)).toEqual({ status: 'refused' });
  });

  it('refuses an image outside home and temp even when named', async () => {
    const file = write(path.join(outside, 'x.png'));
    expect(await readPromptImage(file, file, places)).toEqual({ status: 'refused' });
  });

  it('refuses traversal out of the paste folder', async () => {
    write(path.join(outside, 'x.png'));
    const sneaky = path.join(places.pasteDir, '..', '..', 'elsewhere', 'x.png');
    expect(await readPromptImage(sneaky, '', places)).toEqual({ status: 'refused' });
    expect(await readPromptImage(sneaky, sneaky, places)).toEqual({ status: 'refused' });
  });

  it('refuses a symlink in the paste folder that points out of it', async () => {
    const target = write(path.join(outside, 'x.png'));
    const link = path.join(places.pasteDir, 'paste-link.png');
    fs.symlinkSync(target, link);
    expect(await readPromptImage(link, link, places)).toEqual({ status: 'refused' });
    const homeTarget = write(path.join(places.home, 'h.png'));
    const homeLink = path.join(places.pasteDir, 'paste-home.png');
    fs.symlinkSync(homeTarget, homeLink);
    expect(await readPromptImage(homeLink, '', places)).toEqual({ status: 'refused' }); // not named, not really a paste
  });

  it('refuses a symlink named .png that points at a non-image', async () => {
    const target = write(path.join(places.home, 'notes.txt'), Buffer.from('hello'));
    const link = path.join(places.home, 'notes.png');
    fs.symlinkSync(target, link);
    expect(await readPromptImage(link, link, places)).toEqual({ status: 'refused' });
  });

  it('refuses wrong magic bytes, an empty file and a non-image extension', async () => {
    const fake = write(path.join(places.pasteDir, 'paste-fake.png'), Buffer.from('#!/bin/sh\necho hi\n'));
    expect(await readPromptImage(fake, '', places)).toEqual({ status: 'refused' });
    const empty = write(path.join(places.pasteDir, 'paste-empty.png'), Buffer.alloc(0));
    expect(await readPromptImage(empty, '', places)).toEqual({ status: 'refused' });
    const text = write(path.join(places.pasteDir, 'paste.txt'));
    expect(await readPromptImage(text, '', places)).toEqual({ status: 'refused' });
  });

  it('refuses a file over the size limit', async () => {
    const big = write(path.join(places.pasteDir, 'paste-big.png'), Buffer.concat([PNG, Buffer.alloc(places.maxBytes)]));
    expect(await readPromptImage(big, '', places)).toEqual({ status: 'refused' });
  });

  it('says missing for a cleaned-up paste, refused for a missing file elsewhere', async () => {
    expect(await readPromptImage(path.join(places.pasteDir, 'paste-gone.png'), '', places)).toEqual({ status: 'missing' });
    const homeGone = path.join(places.home, 'gone.png');
    expect(await readPromptImage(homeGone, homeGone, places)).toEqual({ status: 'missing' });
    expect(await readPromptImage(homeGone, '', places)).toEqual({ status: 'refused' });
    const outsideGone = path.join(outside, 'gone.png');
    expect(await readPromptImage(outsideGone, outsideGone, places)).toEqual({ status: 'refused' });
  });

  it('refuses relative paths, directories and non-strings', async () => {
    expect(await readPromptImage('petal-paste/x.png', 'petal-paste/x.png', places)).toEqual({ status: 'refused' });
    const dir = path.join(places.pasteDir, 'paste-dir.png');
    fs.mkdirSync(dir);
    expect(await readPromptImage(dir, '', places)).toEqual({ status: 'refused' });
    expect(await readPromptImage(42, '', places)).toEqual({ status: 'refused' });
  });
});

describe('sniffImage', () => {
  it('knows PNG, JPEG, GIF and WebP by their bytes', () => {
    expect(sniffImage(PNG)).toBe('image/png');
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImage(Buffer.from('GIF89a......'))).toBe('image/gif');
    expect(sniffImage(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
  });
});

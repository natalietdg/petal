// petal-img:// is the only way a reply's picture reaches the reader; these hold its door shut on everything but images she may see.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkReplyImage, handleReplyImageRequest, replyImageStatus, resolveReplyImagePath, type ReplyImagePlaces } from '../src/main/reply-image';
import { replyImageUrl } from '../src/shared/reply-image-url';
import { removeTempDirs, tempDir } from './helpers';

afterEach(removeTempDirs);

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGP439CAFTEMLQkACnZ/wR8hFMgAAAAASUVORK5CYII=', 'base64');

let places: ReplyImagePlaces;
let home: string;
let outside: string;

beforeEach(() => {
  const root = tempDir('petal-reply-image-');
  home = path.join(root, 'home');
  outside = path.join(root, 'elsewhere');
  places = { home, cwds: [], claudeHome: path.join(home, '.claude'), claudeAllowed: false, maxBytes: 1024 };
  for (const dir of [home, outside, places.claudeHome, path.join(home, 'Desktop')]) fs.mkdirSync(dir, { recursive: true });
});

const write = (file: string, bytes: Buffer = PNG): string => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  return file;
};

const fetchImage = (file: string, cwd: string | null = null) => handleReplyImageRequest(replyImageUrl(file, cwd), places);

describe('petal-img:// serves', () => {
  it('a PNG under home by absolute path, ~/ and file: URL, typed from its bytes', async () => {
    const file = write(path.join(home, 'Desktop', 'petal-discord', '1-testing-pipeline.png'));
    for (const name of [file, '~/Desktop/petal-discord/1-testing-pipeline.png', `file://${file}`]) {
      const response = await fetchImage(name);
      expect(response.status, name).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/png');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(Buffer.from(await response.arrayBuffer()).equals(PNG)).toBe(true);
    }
  });

  it('a relative path against the session folder', async () => {
    const repo = path.join(home, 'repo');
    write(path.join(repo, 'docs', 'shot.png'));
    expect((await fetchImage('docs/shot.png', repo)).status).toBe(200);
    expect((await fetchImage('./docs/shot.png', repo)).status).toBe(200);
  });

  it('a file in an open tab’s folder outside home', async () => {
    write(path.join(outside, 'shot.png'));
    places.cwds = [outside];
    expect((await fetchImage('shot.png', outside)).status).toBe(200);
  });

  it('a symlink in home that stays in home', async () => {
    const real = write(path.join(home, 'Pictures', 'real.png'));
    fs.symlinkSync(real, path.join(home, 'Desktop', 'link.png'));
    expect((await fetchImage(path.join(home, 'Desktop', 'link.png'))).status).toBe(200);
  });

  it('the Claude folder once she allowed reading it', async () => {
    const file = write(path.join(places.claudeHome, 'shots', 'a.png'));
    places.claudeAllowed = true;
    expect((await fetchImage(file)).status).toBe(200);
  });
});

describe('petal-img:// refuses', () => {
  it('path traversal out of home, absolute or relative', async () => {
    write(path.join(outside, 'secret.png'));
    expect((await fetchImage('~/../elsewhere/secret.png')).status).toBe(403);
    expect((await fetchImage(`${home}/Desktop/../../elsewhere/secret.png`)).status).toBe(403);
    expect((await fetchImage('../elsewhere/secret.png', home)).status).toBe(403);
    expect((await handleReplyImageRequest(`petal-img://local/?path=${encodeURIComponent(home)}%2F..%2Felsewhere%2Fsecret.png`, places)).status).toBe(403);
  });

  it('a cwd the URL names but no open tab has, so the renderer cannot widen the roots', async () => {
    write(path.join(outside, 'shot.png'));
    expect((await fetchImage('shot.png', outside)).status).toBe(403);
    expect((await fetchImage(path.join(outside, 'shot.png'), outside)).status).toBe(403);
  });

  it('a symlink in home that points outside it', async () => {
    const target = write(path.join(outside, 'secret.png'));
    fs.symlinkSync(target, path.join(home, 'Desktop', 'escape.png'));
    fs.symlinkSync(outside, path.join(home, 'Desktop', 'escape-dir'));
    expect((await fetchImage(path.join(home, 'Desktop', 'escape.png'))).status).toBe(403);
    expect((await fetchImage(path.join(home, 'Desktop', 'escape-dir', 'secret.png'))).status).toBe(403);
  });

  it('a non-image named .png, an image named .txt, an empty file and a folder named .png', async () => {
    const text = write(path.join(home, 'notes.png'), Buffer.from('not a picture at all'));
    const html = write(path.join(home, 'page.png'), Buffer.from('<html><script>alert(1)</script></html>'));
    const misnamed = write(path.join(home, 'shot.txt'));
    const empty = write(path.join(home, 'empty.png'), Buffer.alloc(0));
    fs.mkdirSync(path.join(home, 'folder.png'));
    for (const file of [text, html, misnamed, empty, path.join(home, 'folder.png')]) expect((await fetchImage(file)).status, file).toBe(403);
  });

  it('a symlink with an image name that points at a non-image', async () => {
    const real = write(path.join(home, 'keys.txt'), Buffer.from('secret'));
    fs.symlinkSync(real, path.join(home, 'keys.png'));
    expect((await fetchImage(path.join(home, 'keys.png'))).status).toBe(403);
  });

  it('a file over the size limit', async () => {
    const big = write(path.join(home, 'big.png'), Buffer.concat([PNG, Buffer.alloc(places.maxBytes)]));
    expect((await fetchImage(big)).status).toBe(403);
  });

  it('remote URLs and other schemes, as the path or as the request', async () => {
    for (const name of ['https://example.com/a.png', 'http://127.0.0.1/a.png', 'data:image/png;base64,AAAA.png', 'javascript:alert(1)//.png']) {
      expect((await fetchImage(name)).status, name).toBe(403);
    }
    expect((await handleReplyImageRequest('https://example.com/a.png', places)).status).toBe(403);
    expect((await handleReplyImageRequest(`petal-img://evil/?path=${encodeURIComponent(write(path.join(home, 'a.png')))}`, places)).status).toBe(403);
    expect((await handleReplyImageRequest('petal-img://local/elsewhere?path=/a.png', places)).status).toBe(403);
    expect((await handleReplyImageRequest('not a url', places)).status).toBe(403);
  });

  it('the Claude folder without her consent, also through a symlink in home', async () => {
    const file = write(path.join(places.claudeHome, 'shots', 'a.png'));
    fs.symlinkSync(file, path.join(home, 'Desktop', 'via-link.png'));
    expect((await fetchImage(file)).status).toBe(403);
    expect((await fetchImage('~/.claude/shots/a.png')).status).toBe(403);
    expect((await fetchImage(path.join(home, 'Desktop', 'via-link.png'))).status).toBe(403);
    expect(await replyImageStatus(file, null, places)).toEqual({ status: 'refused', reason: 'claude-folder' });
    expect(await replyImageStatus(path.join(places.claudeHome, 'gone.png'), null, places)).toEqual({ status: 'refused', reason: 'claude-folder' });
  });

  it('system folders, even when a tab was started in one or at /', async () => {
    places.cwds = ['/', '/System/Library'];
    expect((await fetchImage('/System/Library/CoreServices/Finder.app/Contents/Resources/Finder.png')).status).toBe(403);
    expect((await fetchImage('CoreServices/x.png', '/System/Library')).status).toBe(403);
  });

  it('a path that is not a string', async () => {
    expect(await checkReplyImage(42, null, places)).toEqual({ status: 'refused', reason: 'not-allowed' });
    expect(await checkReplyImage('/a.png', 7, places)).toEqual({ status: 'refused', reason: 'not-allowed' });
  });
});

describe('a missing picture', () => {
  it('is 404 where it was allowed to be, 403 anywhere else', async () => {
    expect((await fetchImage(path.join(home, 'Desktop', 'gone.png'))).status).toBe(404);
    expect(await replyImageStatus('~/Desktop/gone.png', null, places)).toEqual({ status: 'missing' });
    expect((await fetchImage(path.join(outside, 'gone.png'))).status).toBe(403);
  });
});

describe('resolveReplyImagePath', () => {
  it('needs a cwd for a relative path and ignores a relative cwd', () => {
    expect(resolveReplyImagePath('docs/a.png', null, '/h')).toBeNull();
    expect(resolveReplyImagePath('docs/a.png', 'repo', '/h')).toBeNull();
    expect(resolveReplyImagePath('docs/a.png', '/h/repo', '/h')).toBe('/h/repo/docs/a.png');
    expect(resolveReplyImagePath('~/a.png', null, '/h')).toBe('/h/a.png');
    expect(resolveReplyImagePath('/a\0.png', null, '/h')).toBeNull();
  });
});

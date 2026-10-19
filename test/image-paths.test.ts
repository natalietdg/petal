import { describe, expect, it } from 'vitest';
import { findImageRefs, placeImageSources, splitPromptImages } from '../src/shared/image-paths';
import { quotePaths } from '../src/shared/quote-path';

const paths = (text: string): string[] => findImageRefs(text).map((r) => r.path);

describe('findImageRefs', () => {
  it('finds a pasted temp path like the one in her screenshot', () => {
    const file = '/var/folders/fs/ab/T/petal-paste/paste-2026-10-13T05-38-54-028Z-06cad08d.png';
    expect(paths(`…my colleague is showing me: ${file}`)).toEqual([file]);
  });

  it('reads quoted paths with spaces and apostrophes, as the reply box types them', () => {
    const files = ['/Users/n/Screen Shot 2026-10-07 at 9.41.12 AM.png', "/tmp/petal drop/it's a file.JPG", '/a/plain.webp'];
    expect(paths(`compare ${quotePaths(files)} please`)).toEqual(files);
  });

  it('reads double quotes, backslash-escaped spaces and ~', () => {
    expect(paths('"/Users/n/My Pics/cat.gif" and /Users/n/two\\ words.jpeg and ~/Desktop/shot.png')).toEqual(['/Users/n/My Pics/cat.gif', '/Users/n/two words.jpeg', '~/Desktop/shot.png']);
  });

  it('finds several per prompt, in order, and drops trailing punctuation', () => {
    expect(paths('first /a/1.png, then (/b/2.jpg). Last: /c/3.gif.')).toEqual(['/a/1.png', '/b/2.jpg', '/c/3.gif']);
  });

  it('reads Claude Code\'s own "[Image: source: …]" note', () => {
    expect(paths('[Image: source: /Users/n/Screen Shot 1.png]')).toEqual(['/Users/n/Screen Shot 1.png']);
  });

  it('ignores non-image paths, relative paths, URLs and apostrophes in words', () => {
    expect(paths("it's /Users/n/notes.md and src/app.png and https://x.test/a.png and /tmp/a.png.txt and isn't")).toEqual([]);
  });
});

describe('splitPromptImages', () => {
  it('leaves text without images as one text part', () => {
    expect(splitPromptImages('just words /a/b.md')).toEqual([{ kind: 'text', text: 'just words /a/b.md' }]);
  });

  it('puts each picture where its path was and trims the space around it', () => {
    expect(splitPromptImages('look: /a/1.png\nand /b/2.png')).toEqual([
      { kind: 'text', text: 'look:' },
      { kind: 'image', path: '/a/1.png', raw: '/a/1.png' },
      { kind: 'text', text: 'and' },
      { kind: 'image', path: '/b/2.png', raw: '/b/2.png' },
    ]);
  });

  it('shows "[Image #n]" as the nth path\'s picture and takes that path out of the text', () => {
    expect(splitPromptImages('see [Image #2] and [Image #1] /a/1.png /b/2.png')).toEqual([
      { kind: 'text', text: 'see' },
      { kind: 'image', path: '/b/2.png', raw: '[Image #2] /b/2.png' },
      { kind: 'text', text: 'and' },
      { kind: 'image', path: '/a/1.png', raw: '[Image #1] /a/1.png' },
    ]);
  });

  it('keeps a placeholder with no path as text', () => {
    expect(splitPromptImages('[Image #1] [Image #2] /a/1.png')).toEqual([
      { kind: 'image', path: '/a/1.png', raw: '[Image #1] /a/1.png' },
      { kind: 'text', text: '[Image #2]' },
    ]);
  });
});

describe('placeImageSources', () => {
  const pasted = '/var/folders/fs/ab/T/petal-paste/paste-2026-10-19T08-55-19-646Z-0b0b0b0b.png';

  it('puts each path where its "[Image #id]" sits, matched by imagePasteIds', () => {
    expect(placeImageSources('[Image #3] [Image #4] compare these', ['/a/3.png', '/b/4.png'], [3, 4]))
      .toBe('[Image: source: /a/3.png] [Image: source: /b/4.png] compare these');
  });

  it('an image-only send becomes just the picture', () => {
    expect(splitPromptImages(placeImageSources('[Image #3]', [pasted], [3]))).toEqual([{ kind: 'image', path: pasted, raw: `[Image: source: ${pasted}]` }]);
  });

  it('without ids, pairs paths with the placeholders in order', () => {
    expect(placeImageSources('see [Image #7] then [Image #8]', ['/a.png', '/b.png'])).toBe('see [Image: source: /a.png] then [Image: source: /b.png]');
  });

  it('a path with no placeholder for it goes on its own line, and "$" in a path stays literal', () => {
    expect(placeImageSources('[Image #1] hi', ['/x/$&.png', '/y/2.png'], [1])).toBe('[Image: source: /x/$&.png] hi\n[Image: source: /y/2.png]');
  });
});

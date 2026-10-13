import { describe, expect, it } from 'vitest';
import { findImageRefs, splitPromptImages } from '../src/shared/image-paths';
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

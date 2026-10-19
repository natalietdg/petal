// Dropped and pasted file paths, typed the way Terminal and iTerm do: one shell word each.

// Characters a shell never splits or expands; anything else gets single quotes.
const SAFE = /^[\w@%+=:,./-]+$/;

export const quotePath = (path: string): string => (SAFE.test(path) ? path : `'${path.replace(/'/g, `'\\''`)}'`);

export const quotePaths = (paths: readonly string[]): string => paths.map(quotePath).join(' ');

// file:// entries of a drop's text/uri-list, as absolute paths; comments and other schemes are skipped.
export function pathsFromUriList(list: string): string[] {
  return list.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith('file://')).flatMap((line) => {
    try {
      return [decodeURIComponent(new URL(line).pathname)];
    } catch {
      return [];
    }
  });
}

// Claude Code splits a paste before each absolute path and at newlines, then attaches pieces ending in these.
const PASTE_PIECE = / (?=\/|[A-Za-z]:\\)|\n/;
const IMAGE_FILE = /\.(png|jpe?g|gif|webp)$/i;
const unquote = (piece: string): string => piece.replace(/^(['"])(.*)\1$/, '$2');

// True when Claude Code will read part of this paste as an image file, which it does after the paste ends.
export const pastesImagePath = (text: string): boolean => text.split(PASTE_PIECE).some((piece) => IMAGE_FILE.test(unquote(piece.trim())));

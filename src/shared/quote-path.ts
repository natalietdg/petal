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

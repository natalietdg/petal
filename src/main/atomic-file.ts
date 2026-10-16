// Writes go to a temp file renamed over the target: a reader never sees half a file.
// A symlinked path (dotfiles, stow) is written at the file it points to, so the link itself stays a link.
import fs from 'node:fs';
import path from 'node:path';

// within: the folder the write must land in, after following links; a write outside it is refused.
export interface WriteGuard {
  within?: string;
}

const MAX_LINK_HOPS = 32;

// The path through every link in the chain; a dangling link still names where its file would be.
function followLinks(file: string): string {
  let target = file;
  for (let hop = 0; hop <= MAX_LINK_HOPS; hop += 1) {
    let link: string;
    try {
      link = fs.readlinkSync(target);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EINVAL' || code === 'ENOENT') return target; // not a link, or nothing there yet
      throw error;
    }
    target = path.resolve(path.dirname(target), link);
  }
  throw new Error(`Petal didn’t write ${file}: it is a loop of symlinks.`);
}

// The real path of a file that may not exist yet: its nearest existing folder resolved, the rest appended.
function realPathOf(file: string): string {
  const rest: string[] = [];
  for (let dir = file; ; dir = path.dirname(dir)) {
    try {
      return path.join(fs.realpathSync(dir), ...rest.reverse());
    } catch {
      if (path.dirname(dir) === dir) return file;
      rest.push(path.basename(dir));
    }
  }
}

const isInside = (child: string, root: string): boolean => {
  const relative = path.relative(root, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

// Where a write to `file` lands: the end of its symlink chain, checked against `within` when given.
export function writeTarget(file: string, { within }: WriteGuard = {}): string {
  const target = followLinks(file);
  if (within && !isInside(realPathOf(target), realPathOf(within))) {
    throw new Error(`Petal didn’t write ${file}: it leads to ${realPathOf(target)}, outside ${within}.`);
  }
  return target;
}

export function writeFileAtomic(file: string, contents: string): void {
  const target = writeTarget(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, contents);
    fs.fsyncSync(fd); // on disk before the rename, so a crash can't leave an empty file
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, target);
}

// a.json -> a.broken-<timestamp>.json, beside it.
export const brokenName = (file: string, now = Date.now()): string => {
  const ext = path.extname(file);
  return `${file.slice(0, file.length - ext.length)}.broken-${now}${ext || '.json'}`;
};

// Parsed JSON, or undefined when missing or unreadable. Unparseable files move aside so a later save can't erase them.
export function readJsonOrSetAside(file: string): unknown {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn(`[petal] could not read ${file}:`, error);
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    const aside = brokenName(file);
    try {
      fs.renameSync(file, aside);
      console.warn(`[petal] ${file} was not valid JSON; moved it to ${aside} and started from defaults`);
    } catch (error) {
      console.warn(`[petal] ${file} was not valid JSON and could not be moved aside:`, error);
    }
    return undefined;
  }
}

// indent as in JSON.stringify; omitted means compact.
export const writeJsonAtomic = (file: string, data: unknown, indent?: number): void =>
  writeFileAtomic(file, JSON.stringify(data, null, indent));

// For a file that isn't Petal's: fsync before the rename, keep `mode`, and leave no temp file if a step fails.
// A file in someone's repo passes `within: repo`, so a link in a cloned repo can't aim the write elsewhere.
export function writeFileDurable(file: string, contents: string, mode?: number, guard: WriteGuard = {}): void {
  const target = writeTarget(file, guard);
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
  let fd: number | null = null;
  try {
    fd = fs.openSync(tmp, 'wx', mode ?? 0o666);
    fs.writeFileSync(fd, contents);
    if (mode !== undefined) fs.fchmodSync(fd, mode); // the umask can't strip bits the original had
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmp, target);
  } catch (error) {
    if (fd !== null) try { fs.closeSync(fd); } catch { /* the first error is the one to report */ }
    fs.rmSync(tmp, { force: true });
    throw error;
  }
}

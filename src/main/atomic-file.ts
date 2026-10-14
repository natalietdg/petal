// Writes go to a temp file renamed over the target: a reader never sees half a file.
import fs from 'node:fs';
import path from 'node:path';

export function writeFileAtomic(file: string, contents: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, contents);
    fs.fsyncSync(fd); // on disk before the rename, so a crash can't leave an empty file
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
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
export function writeFileDurable(file: string, contents: string, mode?: number): void {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  let fd: number | null = null;
  try {
    fd = fs.openSync(tmp, 'wx', mode ?? 0o666);
    fs.writeFileSync(fd, contents);
    if (mode !== undefined) fs.fchmodSync(fd, mode); // the umask can't strip bits the original had
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmp, file);
  } catch (error) {
    if (fd !== null) try { fs.closeSync(fd); } catch { /* the first error is the one to report */ }
    fs.rmSync(tmp, { force: true });
    throw error;
  }
}

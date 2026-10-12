// Writes go to a temp file renamed over the target: a reader never sees half a file.
import fs from 'node:fs';
import path from 'node:path';

export function writeFileAtomic(file: string, contents: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, contents);
  fs.renameSync(tmp, file);
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

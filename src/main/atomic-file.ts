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

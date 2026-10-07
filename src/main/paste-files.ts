// Images pasted into the reply box, saved as PNGs in Petal's own temp folder (never ~/.claude).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const PASTE_DIR_NAME = 'petal-paste';
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const PASTE_FILE = /^paste-.+\.png$/;

export const pasteDir = (tempRoot: string): string => path.join(tempRoot, PASTE_DIR_NAME);

// Sortable by time, unique by the random suffix, and free of characters a shell would split on.
export const pasteFileName = (now: Date, suffix: string): string => `paste-${now.toISOString().replace(/[:.]/g, '-')}-${suffix}.png`;

export function savePng(dir: string, png: Buffer, now = new Date()): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, pasteFileName(now, crypto.randomBytes(4).toString('hex')));
  fs.writeFileSync(file, png, { flag: 'wx' });
  return file;
}

// Removes pastes older than a day; only files Petal named, so nothing else in the folder is touched.
export function removeStale(dir: string, now = Date.now()): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return []; // no pastes yet
  }
  return names.filter((name) => {
    if (!PASTE_FILE.test(name)) return false;
    const file = path.join(dir, name);
    try {
      if (now - fs.statSync(file).mtimeMs <= MAX_AGE_MS) return false;
      fs.rmSync(file);
      return true;
    } catch {
      return false;
    }
  });
}

// Petal's own reply styles (resources/output-styles/petal-*.md), offered for ~/.claude/output-styles on request.
// Writes only petal-*.md files there, never overwrites a file Petal didn't write or one the user edited, never deletes.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { writeFileDurable, writeJsonAtomic } from './atomic-file';
import { frontmatter } from './workflow-frontmatter';

export const PETAL_STYLE = /^petal-[a-z0-9-]+\.md$/;

// missing: not there yet · current: as bundled · outdated: Petal's older copy · edited: changed since Petal wrote it ·
// foreign: a same-named file Petal never wrote.
export type PetalStyleState = 'missing' | 'current' | 'outdated' | 'edited' | 'foreign';

export interface PetalStyle {
  file: string; // e.g. petal-magazine.md
  name: string;
  state: PetalStyleState;
}

export interface PetalStyles {
  styles: PetalStyle[];
  installable: boolean; // any missing or outdated
}

export interface PetalPaths {
  claudeDir: string;
  bundleDir: string;
  recordFile: string; // in Petal's userData: file name → hash of what Petal last wrote
}

const hash = (text: string): string => crypto.createHash('sha256').update(text).digest('hex');

function readOrNull(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function readRecord(recordFile: string): Record<string, string> {
  try {
    const record: unknown = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
    return typeof record === 'object' && record !== null && !Array.isArray(record) ? (record as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function bundled(bundleDir: string): { file: string; text: string }[] {
  let names: string[];
  try {
    names = fs.readdirSync(bundleDir).filter((f) => PETAL_STYLE.test(f)).sort();
  } catch {
    return [];
  }
  return names.map((file) => ({ file, text: fs.readFileSync(path.join(bundleDir, file), 'utf8') }));
}

function stateOf(onDisk: string | null, text: string, recorded: string | undefined): PetalStyleState {
  if (onDisk === null) return 'missing';
  const diskHash = hash(onDisk);
  if (diskHash === hash(text)) return 'current';
  if (recorded === undefined) return 'foreign';
  return diskHash === recorded ? 'outdated' : 'edited';
}

// Each bundled style and how its copy in <claudeDir>/output-styles stands.
export function petalStyles({ claudeDir, bundleDir, recordFile }: PetalPaths): PetalStyles {
  const record = readRecord(recordFile);
  const stylesDir = path.join(claudeDir, 'output-styles');
  const styles = bundled(bundleDir).map(({ file, text }) => ({
    file,
    name: frontmatter(text).name?.trim() || file,
    state: stateOf(readOrNull(path.join(stylesDir, file)), text, record[file]),
  }));
  return { styles, installable: styles.some((s) => s.state === 'missing' || s.state === 'outdated') };
}

// A temp file linked into place: fails with EEXIST rather than replace a file that appeared meanwhile.
function createNew(target: string, text: string): void {
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
  writeFileDurable(tmp, text);
  try {
    fs.linkSync(tmp, target);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

// Adds missing styles and updates Petal's own unedited copies; everything else is left as it is.
export function installPetalStyles(paths: PetalPaths): PetalStyles {
  const record = readRecord(paths.recordFile);
  const stylesDir = path.join(paths.claudeDir, 'output-styles');
  fs.mkdirSync(stylesDir, { recursive: true });
  for (const { file, text } of bundled(paths.bundleDir)) {
    const target = path.join(stylesDir, file);
    const onDisk = readOrNull(target);
    const state = stateOf(onDisk, text, record[file]);
    if (state === 'missing') createNew(target, text);
    else if (state === 'outdated') writeFileDurable(target, text, fs.statSync(target).mode & 0o7777);
    if (state === 'missing' || state === 'outdated' || (state === 'current' && record[file] === undefined)) record[file] = hash(text);
  }
  writeJsonAtomic(paths.recordFile, record, 2);
  return petalStyles(paths);
}

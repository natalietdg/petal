// Her Claude Code output styles (~/.claude/output-styles/*.md), read-only: Petal never writes under ~/.claude.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { frontmatter } from './workflow-frontmatter';

export const MAX_STYLE_BYTES = 256 * 1024;
export const defaultClaudeDir = (): string => path.join(os.homedir(), '.claude');

export interface OutputStyle {
  file: string;
  name: string;
  description: string;
  active: boolean;
  text: string;
  truncated: boolean;
  problem: string | null; // one short line when the file can't be read
}

export interface OutputStyles {
  dir: string;
  active: string | null;
  styles: OutputStyle[];
  problem: string | null; // one short line when the folder is missing or unreadable
}

// The `outputStyle` in settings.json; null when unset or unreadable.
export function activeStyleName(claudeDir = defaultClaudeDir()): string | null {
  try {
    const value = (JSON.parse(fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf8')) as { outputStyle?: unknown }).outputStyle;
    return typeof value === 'string' && value.trim() ? value : null;
  } catch {
    return null;
  }
}

// At most MAX_STYLE_BYTES, so a huge file can't stall the Customize page.
function readCapped(file: string): { text: string; truncated: boolean } {
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(MAX_STYLE_BYTES + 1);
    const read = fs.readSync(fd, buffer, 0, buffer.length, 0);
    return { text: buffer.subarray(0, Math.min(read, MAX_STYLE_BYTES)).toString('utf8'), truncated: read > MAX_STYLE_BYTES };
  } finally {
    fs.closeSync(fd);
  }
}

// Settings name the style by its frontmatter name; the file name is accepted too.
const isActive = (active: string | null, name: string, stem: string): boolean =>
  active !== null && [name, stem].some((candidate) => candidate.toLowerCase() === active.toLowerCase());

function readStyle(file: string, active: string | null): OutputStyle {
  const stem = path.basename(file, '.md');
  try {
    const { text, truncated } = readCapped(file);
    const fields = frontmatter(text);
    const name = fields.name?.trim() || stem;
    return { file, name, description: fields.description?.trim() ?? '', active: isActive(active, name, stem), text, truncated, problem: null };
  } catch {
    return { file, name: stem, description: '', active: isActive(active, stem, stem), text: '', truncated: false, problem: 'Couldn’t read this file.' };
  }
}

// Every *.md in <claudeDir>/output-styles, by name, with the active one marked.
export function listOutputStyles(claudeDir = defaultClaudeDir()): OutputStyles {
  const dir = path.join(claudeDir, 'output-styles');
  const active = activeStyleName(claudeDir);
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.md'));
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    return { dir, active, styles: [], problem: missing ? `No output styles folder at ${dir}.` : `Couldn’t read ${dir}.` };
  }
  const styles = names.map((f) => readStyle(path.join(dir, f), active)).sort((a, b) => a.name.localeCompare(b.name));
  return { dir, active, styles, problem: styles.length ? null : `No .md files in ${dir}.` };
}

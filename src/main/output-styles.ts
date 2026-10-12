// Her Claude Code output styles (~/.claude/output-styles/*.md), read-only.
// Petal's one write under ~/.claude: the `outputStyle` key of ~/.claude/settings.json (setOutputStyle); nothing else there.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeFileDurable } from './atomic-file';
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

export interface StyleSwitch {
  name: string;
  override: string | null; // the different style ~/.claude/settings.local.json names, which wins over settings.json
}

// The `outputStyle` in <claudeDir>/<file>; null when unset or unreadable.
function styleIn(claudeDir: string, file: string): string | null {
  try {
    const value = (JSON.parse(fs.readFileSync(path.join(claudeDir, file), 'utf8')) as { outputStyle?: unknown }).outputStyle;
    return typeof value === 'string' && value.trim() ? value : null;
  } catch {
    return null;
  }
}

// The `outputStyle` in settings.json; null when unset or unreadable.
export const activeStyleName = (claudeDir = defaultClaudeDir()): string | null => styleIn(claudeDir, 'settings.json');

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

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

// The file's own indent: the first indented line's whitespace; a one-line file stays compact.
function indentOf(text: string, settings: Record<string, unknown>): string {
  const indented = /\n([ \t]+)\S/.exec(text);
  if (indented) return indented[1];
  return text.trim().includes('\n') || Object.keys(settings).length === 0 ? '  ' : '';
}

// settings.json with only `outputStyle` changed: other keys, their order, the indent and the file mode stay as they were.
function writeStyleSetting(claudeDir: string, name: string): void {
  const linked = path.join(claudeDir, 'settings.json');
  const file = fs.existsSync(linked) ? fs.realpathSync(linked) : linked; // a symlinked settings.json stays a symlink
  let text: string | null;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`Couldn’t read ${linked}.`, { cause: error });
    text = null;
  }
  if (text === null) {
    writeFileDurable(file, `${JSON.stringify({ outputStyle: name }, null, 2)}\n`);
    return;
  }
  let settings: unknown;
  try {
    settings = JSON.parse(text);
  } catch {
    settings = null;
  }
  if (!isObject(settings)) throw new Error(`${linked} isn’t a valid JSON object, so Petal left it unchanged.`);
  settings.outputStyle = name; // an existing key keeps its place; a new one goes last
  const newline = text.endsWith('\n') ? '\n' : '';
  writeFileDurable(file, JSON.stringify(settings, null, indentOf(text, settings)) + newline, fs.statSync(file).mode & 0o7777);
}

// Makes a listed style the active one, by its frontmatter name as Claude Code's /output-style stores it.
export function setOutputStyle(name: string, claudeDir = defaultClaudeDir()): StyleSwitch {
  const listed = typeof name === 'string' && listOutputStyles(claudeDir).styles.some((s) => !s.problem && s.name === name);
  if (!listed) throw new Error('not one of your output styles');
  writeStyleSetting(claudeDir, name);
  const local = styleIn(claudeDir, 'settings.local.json');
  return { name, override: local !== null && local !== name ? local : null };
}

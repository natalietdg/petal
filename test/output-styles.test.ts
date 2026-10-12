import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_STYLE_BYTES, activeStyleName, listOutputStyles, setOutputStyle } from '../src/main/output-styles';
import { removeTempDirs, tempDir } from './helpers';

const RESEARCH = '---\nname: Research Paper\ndescription: "Abstract first, then sections"\n---\n\n# Research paper\nBody text.\n';
const FOLDED = '---\nname: Magazine\ndescription: >\n  Headline, dek and\n  sidebars.\n---\nMagazine body.\n';

// A stand-in ~/.claude: settings.json plus output-styles/<name>.md files.
function claudeDir(files: Record<string, string>, settings?: unknown): string {
  const dir = tempDir('petal-styles-');
  fs.mkdirSync(path.join(dir, 'output-styles'));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, 'output-styles', name), text);
  if (settings !== undefined) fs.writeFileSync(path.join(dir, 'settings.json'), typeof settings === 'string' ? settings : JSON.stringify(settings));
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  removeTempDirs();
});

describe('listOutputStyles', () => {
  it('reads name and description from frontmatter, including folded values', () => {
    const { styles, problem } = listOutputStyles(claudeDir({ 'research-paper.md': RESEARCH, 'magazine.md': FOLDED }));
    expect(problem).toBeNull();
    expect(styles.map((s) => [s.name, s.description])).toEqual([
      ['Magazine', 'Headline, dek and sidebars.'],
      ['Research Paper', 'Abstract first, then sections'],
    ]);
  });

  it('falls back to the file name when there is no frontmatter or no name', () => {
    const { styles } = listOutputStyles(claudeDir({ 'plain.md': 'Just a prompt.\n', 'nameless.md': '---\ndescription: d\n---\nx' }));
    expect(styles.map((s) => [s.name, s.description])).toEqual([['nameless', 'd'], ['plain', '']]);
  });

  it('keeps the whole file text, frontmatter included, and the absolute path', () => {
    const dir = claudeDir({ 'research-paper.md': RESEARCH });
    const [style] = listOutputStyles(dir).styles;
    expect(style.text).toBe(RESEARCH);
    expect(style.file).toBe(path.join(dir, 'output-styles', 'research-paper.md'));
    expect(style.truncated).toBe(false);
  });

  it('ignores files that are not .md', () => {
    const { styles } = listOutputStyles(claudeDir({ 'a.md': 'a', 'notes.txt': 'b', '.DS_Store': 'c' }));
    expect(styles.map((s) => s.name)).toEqual(['a']);
  });

  it('caps a huge file at 256 KB and says so', () => {
    const [style] = listOutputStyles(claudeDir({ 'big.md': 'x'.repeat(MAX_STYLE_BYTES + 5000) })).styles;
    expect(style.text.length).toBe(MAX_STYLE_BYTES);
    expect(style.truncated).toBe(true);
  });

  it('marks only the style named in settings.json as active, by name or file name, any case', () => {
    const files = { 'research-paper.md': RESEARCH, 'magazine.md': FOLDED };
    const byName = listOutputStyles(claudeDir(files, { outputStyle: 'Research Paper' }));
    expect(byName.active).toBe('Research Paper');
    expect(byName.styles.filter((s) => s.active).map((s) => s.name)).toEqual(['Research Paper']);
    expect(listOutputStyles(claudeDir(files, { outputStyle: 'magazine' })).styles.filter((s) => s.active).map((s) => s.name)).toEqual(['Magazine']);
    expect(listOutputStyles(claudeDir(files, { outputStyle: 'Explanatory' })).styles.some((s) => s.active)).toBe(false);
    expect(listOutputStyles(claudeDir(files)).styles.some((s) => s.active)).toBe(false);
  });

  it('gives one short line for a missing folder or an empty one', () => {
    const missing = listOutputStyles(tempDir('petal-styles-'));
    expect(missing.styles).toEqual([]);
    expect(missing.problem).toMatch(/^No output styles folder at .*output-styles\.$/);
    expect(listOutputStyles(claudeDir({})).problem).toMatch(/^No \.md files in /);
  });

  it('lists an unreadable file with one short line instead of failing the rest', () => {
    const dir = claudeDir({ 'locked.md': '---\nname: Locked\n---\n', 'ok.md': RESEARCH });
    const locked = path.join(dir, 'output-styles', 'locked.md');
    fs.chmodSync(locked, 0o000);
    try {
      const { styles } = listOutputStyles(dir);
      const lockedStyle = styles.find((s) => s.file === locked);
      expect(lockedStyle?.problem).toBe('Couldn’t read this file.');
      expect(lockedStyle?.name).toBe('locked');
      expect(styles.find((s) => s.name === 'Research Paper')?.problem).toBeNull();
    } finally {
      fs.chmodSync(locked, 0o644);
    }
  });

  it('never writes to the styles folder', () => {
    const dir = claudeDir({ 'research-paper.md': RESEARCH }, { outputStyle: 'Research Paper' });
    const before = fs.readdirSync(dir, { recursive: true }).map(String).sort();
    const mtime = fs.statSync(path.join(dir, 'output-styles', 'research-paper.md')).mtimeMs;
    listOutputStyles(dir);
    expect(fs.readdirSync(dir, { recursive: true }).map(String).sort()).toEqual(before);
    expect(fs.statSync(path.join(dir, 'output-styles', 'research-paper.md')).mtimeMs).toBe(mtime);
  });
});

describe('activeStyleName', () => {
  it('is null for missing, broken or non-string settings', () => {
    expect(activeStyleName(tempDir('petal-styles-'))).toBeNull();
    expect(activeStyleName(claudeDir({}, '{not json'))).toBeNull();
    expect(activeStyleName(claudeDir({}, { outputStyle: 3 }))).toBeNull();
    expect(activeStyleName(claudeDir({}, { outputStyle: 'Magazine' }))).toBe('Magazine');
  });
});

describe('setOutputStyle', () => {
  const files = { 'research-paper.md': RESEARCH, 'magazine.md': FOLDED };
  const OTHER = { permissions: { allow: ['Bash(ls)'], deny: [] }, outputStyle: 'Research Paper', model: 'opus', hooks: { Stop: [{ command: 'x' }] }, zeta: 1 };
  const settingsPath = (dir: string) => path.join(dir, 'settings.json');
  const read = (dir: string) => fs.readFileSync(settingsPath(dir), 'utf8');

  it('changes only outputStyle, keeping every other key, the key order and the 2-space indent', () => {
    const dir = claudeDir(files);
    fs.writeFileSync(settingsPath(dir), `${JSON.stringify(OTHER, null, 2)}\n`);
    expect(setOutputStyle('Magazine', dir)).toEqual({ name: 'Magazine', override: null });
    const after = JSON.parse(read(dir));
    expect(after).toEqual({ ...OTHER, outputStyle: 'Magazine' });
    expect(Object.keys(after)).toEqual(Object.keys(OTHER));
    expect(read(dir)).toBe(`${JSON.stringify({ ...OTHER, outputStyle: 'Magazine' }, null, 2)}\n`);
    expect(activeStyleName(dir)).toBe('Magazine');
  });

  it('keeps tab and 4-space indents, a compact one-liner, and a missing final newline', () => {
    for (const indent of ['\t', '    ', '']) {
      const dir = claudeDir(files);
      fs.writeFileSync(settingsPath(dir), JSON.stringify(OTHER, null, indent));
      setOutputStyle('Magazine', dir);
      expect(read(dir)).toBe(JSON.stringify({ ...OTHER, outputStyle: 'Magazine' }, null, indent));
    }
  });

  it('adds outputStyle last when it was not set', () => {
    const dir = claudeDir(files, { model: 'opus', theme: 'dark' });
    setOutputStyle('Research Paper', dir);
    expect(read(dir)).toBe('{"model":"opus","theme":"dark","outputStyle":"Research Paper"}');
  });

  it('creates a missing settings.json with just that key', () => {
    const dir = claudeDir(files);
    setOutputStyle('Magazine', dir);
    expect(read(dir)).toBe('{\n  "outputStyle": "Magazine"\n}\n');
  });

  it('refuses a settings.json that does not parse, or is not an object, and leaves it byte for byte', () => {
    for (const broken of ['{"model": "opus",', '[1, 2]', 'null', '']) {
      const dir = claudeDir(files, broken);
      expect(() => setOutputStyle('Magazine', dir)).toThrow(/isn’t a valid JSON object, so Petal left it unchanged/);
      expect(read(dir)).toBe(broken);
      expect(fs.readdirSync(dir).sort()).toEqual(['output-styles', 'settings.json']);
    }
  });

  it('rejects a name that is not one of the listed styles and writes nothing', () => {
    const dir = claudeDir(files, OTHER);
    const before = read(dir);
    for (const name of ['Explanatory', 'magazine', 'magazine.md', '', '../settings', 3 as unknown as string]) {
      expect(() => setOutputStyle(name, dir)).toThrow('not one of your output styles');
    }
    expect(read(dir)).toBe(before);
    expect(fs.existsSync(path.join(tempDir('petal-styles-'), 'settings.json'))).toBe(false);
  });

  it('keeps the file mode', () => {
    const dir = claudeDir(files, OTHER);
    fs.chmodSync(settingsPath(dir), 0o600);
    setOutputStyle('Magazine', dir);
    expect(fs.statSync(settingsPath(dir)).mode & 0o7777).toBe(0o600);
    fs.chmodSync(settingsPath(dir), 0o664);
    setOutputStyle('Research Paper', dir);
    expect(fs.statSync(settingsPath(dir)).mode & 0o7777).toBe(0o664);
  });

  it('is atomic: a failure at fsync or rename leaves the old file whole and no temp file', () => {
    for (const step of ['fsyncSync', 'renameSync'] as const) {
      const dir = claudeDir(files, OTHER);
      const before = read(dir);
      const spy = vi.spyOn(fs, step).mockImplementation(() => { throw new Error(`disk full at ${step}`); });
      expect(() => setOutputStyle('Magazine', dir)).toThrow(`disk full at ${step}`);
      spy.mockRestore();
      expect(read(dir)).toBe(before);
      expect(fs.readdirSync(dir).sort()).toEqual(['output-styles', 'settings.json']);
    }
  });

  it('writes through a symlinked settings.json, which stays a symlink', () => {
    const dir = claudeDir(files);
    const real = path.join(tempDir('petal-dotfiles-'), 'settings.json');
    fs.writeFileSync(real, JSON.stringify(OTHER));
    fs.symlinkSync(real, settingsPath(dir));
    setOutputStyle('Magazine', dir);
    expect(fs.lstatSync(settingsPath(dir)).isSymbolicLink()).toBe(true);
    expect(JSON.parse(fs.readFileSync(real, 'utf8')).outputStyle).toBe('Magazine');
  });

  it('names a different style in settings.local.json as the override, never writing that file', () => {
    const dir = claudeDir(files, OTHER);
    fs.writeFileSync(path.join(dir, 'settings.local.json'), '{"outputStyle":"Explanatory"}');
    expect(setOutputStyle('Magazine', dir)).toEqual({ name: 'Magazine', override: 'Explanatory' });
    expect(fs.readFileSync(path.join(dir, 'settings.local.json'), 'utf8')).toBe('{"outputStyle":"Explanatory"}');
    fs.writeFileSync(path.join(dir, 'settings.local.json'), '{"outputStyle":"Magazine"}');
    expect(setOutputStyle('Magazine', dir).override).toBeNull();
  });

  it('never touches the style files', () => {
    const dir = claudeDir(files, OTHER);
    const stylesDir = path.join(dir, 'output-styles');
    const snapshot = () => fs.readdirSync(stylesDir).sort().map((f) => [f, fs.readFileSync(path.join(stylesDir, f), 'utf8'), fs.statSync(path.join(stylesDir, f)).mtimeMs]);
    const before = snapshot();
    setOutputStyle('Magazine', dir);
    expect(snapshot()).toEqual(before);
  });
});

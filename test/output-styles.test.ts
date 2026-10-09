import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_STYLE_BYTES, activeStyleName, listOutputStyles } from '../src/main/output-styles';
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

afterEach(() => removeTempDirs());

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

import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PETAL_STYLE, installPetalStyles, petalStyles, type PetalPaths } from '../src/main/petal-styles';
import { listOutputStyles } from '../src/main/output-styles';
import { removeTempDirs, tempDir } from './helpers';

const REPO_BUNDLE = path.join(__dirname, '..', 'resources', 'output-styles');
const style = (name: string, body = 'Body.') => `---\nname: ${name}\nkeep-coding-instructions: true\n---\n${body}\n`;

// A stand-in bundle, ~/.claude and userData record, all in temp dirs.
function setup(bundle: Record<string, string> = { 'petal-a.md': style('Petal · A'), 'petal-b.md': style('Petal · B') }): PetalPaths & { stylesDir: string } {
  const bundleDir = tempDir('petal-bundle-');
  for (const [file, text] of Object.entries(bundle)) fs.writeFileSync(path.join(bundleDir, file), text);
  const claudeDir = tempDir('petal-claude-');
  return { bundleDir, claudeDir, recordFile: path.join(tempDir('petal-userdata-'), 'petal-styles.json'), stylesDir: path.join(claudeDir, 'output-styles') };
}

// Every file under dir with its contents, for before/after comparisons.
const tree = (dir: string): Record<string, string> => Object.fromEntries(
  fs.readdirSync(dir, { recursive: true }).map(String).sort()
    .filter((f) => fs.statSync(path.join(dir, f)).isFile())
    .map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]),
);

const states = (paths: PetalPaths) => Object.fromEntries(petalStyles(paths).styles.map((s) => [s.file, s.state]));

afterEach(removeTempDirs);

describe('installPetalStyles', () => {
  it('fresh install: creates output-styles and copies every bundled style', () => {
    const paths = setup();
    expect(petalStyles(paths)).toMatchObject({ installable: true, styles: [{ file: 'petal-a.md', name: 'Petal · A', state: 'missing' }, { state: 'missing' }] });
    const result = installPetalStyles(paths);
    expect(result.installable).toBe(false);
    expect(tree(paths.claudeDir)).toEqual({ 'output-styles/petal-a.md': style('Petal · A'), 'output-styles/petal-b.md': style('Petal · B') });
    expect(listOutputStyles(paths.claudeDir).styles.map((s) => s.name)).toEqual(['Petal · A', 'Petal · B']);
  });

  it('skips an existing non-Petal file with the same name and says so', () => {
    const paths = setup();
    fs.mkdirSync(paths.stylesDir);
    fs.writeFileSync(path.join(paths.stylesDir, 'petal-a.md'), 'my own prompt\n');
    installPetalStyles(paths);
    expect(fs.readFileSync(path.join(paths.stylesDir, 'petal-a.md'), 'utf8')).toBe('my own prompt\n');
    expect(states(paths)).toEqual({ 'petal-a.md': 'foreign', 'petal-b.md': 'current' });
    expect(petalStyles(paths).installable).toBe(false);
  });

  it('updates its own copy when the user has not edited it', () => {
    const paths = setup();
    installPetalStyles(paths);
    fs.chmodSync(path.join(paths.stylesDir, 'petal-a.md'), 0o640);
    fs.writeFileSync(path.join(paths.bundleDir, 'petal-a.md'), style('Petal · A', 'Better body.'));
    expect(states(paths)['petal-a.md']).toBe('outdated');
    expect(petalStyles(paths).installable).toBe(true);
    installPetalStyles(paths);
    expect(fs.readFileSync(path.join(paths.stylesDir, 'petal-a.md'), 'utf8')).toBe(style('Petal · A', 'Better body.'));
    expect(fs.statSync(path.join(paths.stylesDir, 'petal-a.md')).mode & 0o777).toBe(0o640);
    expect(states(paths)).toEqual({ 'petal-a.md': 'current', 'petal-b.md': 'current' });
  });

  it('leaves an edited copy alone, even when the bundle has a newer one', () => {
    const paths = setup();
    installPetalStyles(paths);
    const edited = style('Petal · A', 'Edited by hand.');
    fs.writeFileSync(path.join(paths.stylesDir, 'petal-a.md'), edited);
    fs.writeFileSync(path.join(paths.bundleDir, 'petal-a.md'), style('Petal · A', 'Better body.'));
    installPetalStyles(paths);
    expect(fs.readFileSync(path.join(paths.stylesDir, 'petal-a.md'), 'utf8')).toBe(edited);
    expect(states(paths)['petal-a.md']).toBe('edited');
    expect(petalStyles(paths).installable).toBe(false);
  });

  it('writes nothing outside petal-*.md: other styles, settings.json and stray bundle files are untouched, nothing deleted', () => {
    const paths = setup({ 'petal-a.md': style('Petal · A'), 'notes.md': style('Not Petal'), 'petal-b.txt': 'x' });
    fs.mkdirSync(paths.stylesDir);
    fs.writeFileSync(path.join(paths.stylesDir, 'mine.md'), style('Mine'));
    fs.writeFileSync(path.join(paths.claudeDir, 'settings.json'), '{\n  "outputStyle": "Mine"\n}\n');
    const before = tree(paths.claudeDir);
    installPetalStyles(paths);
    const after = tree(paths.claudeDir);
    expect(Object.keys(after)).toEqual([...Object.keys(before), 'output-styles/petal-a.md'].sort());
    for (const [file, text] of Object.entries(before)) expect(after[file]).toBe(text);
    expect(fs.readdirSync(paths.stylesDir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('records hashes only in its own userData file', () => {
    const paths = setup();
    installPetalStyles(paths);
    expect(Object.keys(JSON.parse(fs.readFileSync(paths.recordFile, 'utf8'))).sort()).toEqual(['petal-a.md', 'petal-b.md']);
  });
});

describe('bundled styles', () => {
  const files = fs.readdirSync(REPO_BUNDLE).filter((f) => f.endsWith('.md')).sort();
  const texts = files.map((f) => [f, fs.readFileSync(path.join(REPO_BUNDLE, f), 'utf8')] as const);

  it('are the four petal-*.md styles with Petal names and keep-coding-instructions', () => {
    expect(files).toEqual(['petal-landing-page.md', 'petal-magazine.md', 'petal-pyramid.md', 'petal-research-paper.md']);
    expect(files.every((f) => PETAL_STYLE.test(f))).toBe(true);
    const named = petalStyles({ claudeDir: tempDir('petal-claude-'), bundleDir: REPO_BUNDLE, recordFile: path.join(tempDir(), 'r.json') }).styles.map((s) => s.name);
    expect(named).toEqual(['Petal · Landing Page', 'Petal · Magazine', 'Petal · Pyramid', 'Petal · Research Paper']);
    for (const [, text] of texts) expect(text).toMatch(/^---\n[\s\S]*\nkeep-coding-instructions: true\n---\n/);
  });

  it('contain nothing personal', () => {
    const banned = ['Natalie', 'natalie', 'ADHD', 'Paywatch', 'audit', 'AUDIT', 'her '];
    for (const [file, text] of texts) {
      for (const word of banned) expect(`${file}: ${text.includes(word)}`, word).toBe(`${file}: false`);
      expect(`${file}: ${/\b(her|natalie|adhd|paywatch|audit|mckinsey)\b/i.test(text)}`).toBe(`${file}: false`); // any case, any position
    }
  });

  it('keep every shape the reader renders, across the set', () => {
    const all = texts.map(([, text]) => text).join('\n');
    for (const shape of ['**Abstract.**', '**Bottom line.**', '**Doing:**', '**Recommend:**', '**Next:**', '## Steps', 'Check:', '## 1.', '==double equals==',
      '**Decide:**', '**Watch out:**', '*Table 1.', '```mermaid', '*Figure 1.', '## References', '## Sources', '> **At a glance**']) {
      expect(all.includes(shape) ? shape : `missing ${shape}`).toBe(shape);
    }
  });
});

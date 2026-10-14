// First-run copy: no Petal source paths or dev notes in what any user sees, and the magazine style is found under its bundled name.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { removeTempDirs, tempDir } from './helpers';
import { findMagazineStyle } from '../src/main/customize-ipc';

const RENDERER = path.join(__dirname, '..', 'src', 'renderer');
const source = (file: string) => fs.readFileSync(path.join(RENDERER, file), 'utf8');
const previewOf = (text: string) => /const PREVIEW = `([\s\S]*?)`;\n/.exec(text)?.[1] ?? '';

describe('Customize copy', () => {
  it('names no Petal source file', () => {
    for (const file of ['customize-look.ts', 'customize-prompts.ts']) {
      const strings = source(file).replace(/^\s*(\/\/|import ).*$/gm, '');
      expect(strings, file).not.toMatch(/src\/(main|renderer)|session-organizer|handoff\.js/);
    }
  });

  it('the live preview is a neutral reply in the research-paper shape', () => {
    const preview = previewOf(source('customize-look.ts'));
    expect(preview).toMatch(/^\*\*.+\*\*\n\n\*\*Abstract\.\*\*/);
    for (const shape of ['**Doing:**', '**Recommend:**', '**Next:**', '## 1. ', '## 2. ', '> **At a glance**', '==', '|---|', '## References']) expect(preview).toContain(shape);
    expect(preview).not.toMatch(/Petal|organizer|\.js\b|—/);
  });

  it('a missing magazine style points at the bundled one and the add action', () => {
    const text = source('customize-look.ts');
    expect(text).toContain('petal-magazine.md');
    expect(text).toContain('Add Petal’s reply styles');
    expect(text).not.toContain('No magazine.md found');
  });
});

describe('findMagazineStyle', () => {
  afterEach(removeTempDirs);

  it('prefers the bundled petal-magazine.md, then magazine.md, else none', () => {
    const dir = tempDir('petal-styles-');
    expect(findMagazineStyle(dir)).toBeNull();
    fs.writeFileSync(path.join(dir, 'magazine.md'), '');
    expect(findMagazineStyle(dir)).toBe(path.join(dir, 'magazine.md'));
    fs.writeFileSync(path.join(dir, 'petal-magazine.md'), '');
    expect(findMagazineStyle(dir)).toBe(path.join(dir, 'petal-magazine.md'));
  });
});

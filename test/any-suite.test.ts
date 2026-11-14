// The dock's Testing button: shown only once some repo has a saved suite.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { removeTempDirs, tempDir, useTempUserData } from './helpers';
import { anySuite } from '../src/main/repo-suite-store';

afterEach(removeTempDirs);

describe('anySuite', () => {
  it('is false with no repos folder, and with repo folders that hold no suite', () => {
    useTempUserData();
    const root = tempDir();
    expect(anySuite(path.join(root, 'missing'))).toBe(false);
    fs.mkdirSync(path.join(root, 'repo-a'));
    expect(anySuite(root)).toBe(false);
  });

  it('is true once one repo has suite.json', () => {
    useTempUserData();
    const root = tempDir();
    fs.mkdirSync(path.join(root, 'repo-a'));
    fs.mkdirSync(path.join(root, 'repo-b'));
    fs.writeFileSync(path.join(root, 'repo-b', 'suite.json'), '{}');
    expect(anySuite(root)).toBe(true);
  });
});

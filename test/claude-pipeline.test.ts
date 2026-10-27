import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES, parseClaudePipeline, readClaudePipeline, type ClaudePipeline } from '../src/main/testing-claude-pipeline';
import { removeTempDirs, tempDir, useTempUserData } from './helpers';
import { repoDir } from '../src/main/petal-home';

const STAGES = [{ name: 'Typecheck', command: 'npm run typecheck' }, { name: 'Unit', command: 'npm test' }];
const project = (text?: string): string => {
  const root = tempDir('petal-pipeline-');
  if (text !== undefined) {
    fs.mkdirSync(path.join(root, '.petal'));
    fs.writeFileSync(path.join(root, '.petal', 'pipeline.json'), text);
  }
  return root;
};
const problem = (value: unknown) => {
  const parsed = parseClaudePipeline(typeof value === 'string' ? value : JSON.stringify(value));
  return 'problem' in parsed ? parsed.problem : null;
};

afterEach(removeTempDirs);

describe('parseClaudePipeline', () => {
  it('takes an ordered list of names and commands, with ids', () => {
    expect(parseClaudePipeline(JSON.stringify([...STAGES, { name: ' Unit ', command: ' npm run test:e2e ' }]))).toEqual({ stages: [
      { id: 'typecheck', name: 'Typecheck', command: 'npm run typecheck' },
      { id: 'unit', name: 'Unit', command: 'npm test' },
      { id: 'unit-2', name: 'Unit', command: 'npm run test:e2e' },
    ] });
  });

  it('refuses anything else', () => {
    expect(problem('{nope')).toMatch(/valid JSON/);
    expect(problem({ stages: STAGES })).toMatch(/list of stages/);
    expect(problem([])).toMatch(/no stages/);
    expect(problem(Array.from({ length: 13 }, (_, i) => ({ name: `S${i}`, command: 'true' })))).toMatch(/more than 12/);
    expect(problem(Array.from({ length: 12 }, (_, i) => ({ name: `S${i}`, command: 'true' })))).toBeNull();
    expect(problem([{ name: 'Unit', command: 'npm test', cwd: '/' }])).toMatch(/only a name and a command/);
    expect(problem(['npm test'])).toMatch(/only a name and a command/);
    expect(problem([{ name: '', command: 'npm test' }])).toMatch(/name/);
    expect(problem([{ name: 'x'.repeat(41), command: 'npm test' }])).toMatch(/name of 40/);
    expect(problem([{ name: 'x'.repeat(40), command: 'npm test' }])).toBeNull();
    expect(problem([{ name: 'Unit', command: 42 }])).toMatch(/command/);
    expect(problem([{ name: 'Unit', command: 'npm test\nrm -rf ~' }])).toMatch(/one-line command/);
    expect(problem([{ name: 'Unit', command: 'y'.repeat(501) }])).toMatch(/500/);
    expect(problem([{ name: 'Unit', command: 'y'.repeat(500) }])).toBeNull();
  });
});

describe('readClaudePipeline', () => {
  beforeEach(() => { useTempUserData(); });

  it('null without the file; an older in-repo file is read from Petal’s copy, keyed by the checkout, with its mtime', () => {
    expect(readClaudePipeline(project())).toBeNull();
    const root = project(JSON.stringify(STAGES));
    const read = readClaudePipeline(root) as ClaudePipeline;
    expect(read.stages.map((s) => s.command)).toEqual(['npm run typecheck', 'npm test']);
    expect(read.updatedAt).toBe(fs.statSync(path.join(repoDir(root), 'pipeline.json')).mtimeMs);
    expect(fs.readFileSync(path.join(root, '.petal', 'pipeline.json'), 'utf8')).toBe(JSON.stringify(STAGES));
  });

  it('a problem for an invalid or oversized file', () => {
    expect(readClaudePipeline(project('[1]'))).toEqual({ problem: 'stage 1 should have only a name and a command' });
    expect(readClaudePipeline(project(`[${' '.repeat(MAX_FILE_BYTES)}]`))).toEqual({ problem: 'it is over 16 KB' });
  });

  it('never follows a symlinked file or folder', () => {
    const outside = project(JSON.stringify(STAGES));
    const linkedFile = project();
    fs.mkdirSync(path.join(linkedFile, '.petal'));
    fs.symlinkSync(path.join(outside, '.petal', 'pipeline.json'), path.join(linkedFile, '.petal', 'pipeline.json'));
    expect(readClaudePipeline(linkedFile)).toBeNull(); // a link in the repo isn't copied into Petal
    const linkedCopy = project();
    fs.mkdirSync(repoDir(linkedCopy), { recursive: true });
    fs.symlinkSync(path.join(outside, '.petal', 'pipeline.json'), path.join(repoDir(linkedCopy), 'pipeline.json'));
    expect(readClaudePipeline(linkedCopy)).toEqual({ problem: 'it isn’t a plain file' });
    const linkedDir = project();
    fs.symlinkSync(path.join(outside, '.petal'), path.join(linkedDir, '.petal'));
    expect(readClaudePipeline(linkedDir)).toBeNull();
  });
});

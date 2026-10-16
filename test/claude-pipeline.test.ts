import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES, adoptClaudePipeline, offersClaudePipeline, parseClaudePipeline, readClaudePipeline, type ClaudePipeline } from '../src/main/testing-claude-pipeline';
import type { PipelineConfig } from '../src/shared/testing';
import { removeTempDirs, tempDir } from './helpers';

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
  it('null without the file; the stages and mtime with it', () => {
    expect(readClaudePipeline(project())).toBeNull();
    const root = project(JSON.stringify(STAGES));
    const read = readClaudePipeline(root) as ClaudePipeline;
    expect(read.stages.map((s) => s.command)).toEqual(['npm run typecheck', 'npm test']);
    expect(read.updatedAt).toBe(fs.statSync(path.join(root, '.petal', 'pipeline.json')).mtimeMs);
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
    expect(readClaudePipeline(linkedFile)).toEqual({ problem: 'it isn’t a plain file' });
    const linkedDir = project();
    fs.symlinkSync(path.join(outside, '.petal'), path.join(linkedDir, '.petal'));
    expect(readClaudePipeline(linkedDir)).toBeNull();
  });
});

describe('the newer-file offer', () => {
  const claude = (updatedAt: number, stages = STAGES): ClaudePipeline => ({ updatedAt, stages: stages.map((s, i) => ({ id: `s${i}`, ...s })) });
  const saved = (savedAt: number | undefined, stages = [{ id: 'unit', name: 'Unit', command: 'npm test' }]): PipelineConfig => ({ stages, keepGoing: true, autoRun: true, confirmed: ['npm test'], ...(savedAt === undefined ? {} : { savedAt }) });

  it('no saved pipeline: no offer, the file is the proposal', () => {
    expect(offersClaudePipeline(null, claude(5000))).toBe(false);
  });

  it('offered only when the file is newer than her last save and different', () => {
    expect(offersClaudePipeline(saved(1000), claude(2000))).toBe(true);
    expect(offersClaudePipeline(saved(3000), claude(2000))).toBe(false);
    expect(offersClaudePipeline(saved(undefined), claude(2000))).toBe(true); // saved before Petal kept a time
    expect(offersClaudePipeline(saved(1000, [{ id: 'a', ...STAGES[0] }, { id: 'b', ...STAGES[1] }]), claude(2000))).toBe(false); // same stages
  });

  it('Use it replaces the stages, keeps her settings and confirmations, and ends the offer', () => {
    const before = saved(1000);
    const after = adoptClaudePipeline(before, claude(2000), 1500);
    expect(after).toEqual({ stages: claude(2000).stages, keepGoing: true, autoRun: true, confirmed: ['npm test'], savedAt: 2000 });
    expect(offersClaudePipeline(after, claude(2000))).toBe(false);
    expect(adoptClaudePipeline(null, claude(2000), 9000)).toMatchObject({ keepGoing: false, autoRun: false, confirmed: [], savedAt: 9000 });
  });
});

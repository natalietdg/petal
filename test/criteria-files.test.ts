// One criteria file per task: the path rule, moving the old shared file's tagged lines once, and reading every file back.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CRITERIA_SKELETON, LEGACY_CRITERIA_PATH, addCriteriaLines, buildLoopBrief, criteriaPath, parseCriteria, splitLegacyCriteria } from '../src/shared/test-loop';
import { migrateCriteria, prepareLoop, readCriteria } from '../src/main/criteria-store';
import type { Task } from '../src/shared/tasks';

const OLD = [
  '# Test criteria',
  '',
  '## Scenarios',
  '- [pass] cart rounds · test: src/cart.test.ts::rounds · round 1 · task: t-cart',
  '- [pass] an old scenario · round 1',
  '',
  '## Bugs',
  '- [fail] coupon 500s · round 1 · task: t-coupon',
  '- [fixed] cent off · round 1 · task: t-cart',
  '- a stray note',
  '',
].join('\n');

const task = (id: string): Task => ({ id, title: id, notes: '', status: 'open', owner: null, createdAt: 0, claimedAt: null, doneAt: null, doneBy: null, prdId: null, parentId: null }) as Task;

describe('the criteria path', () => {
  it('names one file per task, and the old shared file for no task or an id that cannot name a file', () => {
    expect(criteriaPath('t-cart')).toBe('.petal/criteria/t-cart.md');
    expect(criteriaPath(null)).toBe(LEGACY_CRITERIA_PATH);
    expect(criteriaPath('../etc')).toBe(LEGACY_CRITERIA_PATH);
  });

  it('the testing agent’s brief points at its task’s own file', () => {
    expect(buildLoopBrief({ focus: '', rounds: 2, stages: [], stack: [], taskId: 't-cart', agent: true })).toContain('Criteria file: .petal/criteria/t-cart.md');
    expect(buildLoopBrief({ focus: '', rounds: 2, stages: [], stack: [] })).toContain(`Criteria file: ${LEGACY_CRITERIA_PATH}`);
  });
});

describe('splitting the old shared file', () => {
  it('moves tagged lines by section and keeps everything else as written', () => {
    const { keep, moved } = splitLegacyCriteria(OLD);
    expect(moved).toEqual({
      't-cart': { scenarios: ['- [pass] cart rounds · test: src/cart.test.ts::rounds · round 1 · task: t-cart'], bugs: ['- [fixed] cent off · round 1 · task: t-cart'] },
      't-coupon': { scenarios: [], bugs: ['- [fail] coupon 500s · round 1 · task: t-coupon'] },
    });
    expect(keep).toContain('- [pass] an old scenario · round 1');
    expect(keep).toContain('- a stray note');
    expect(keep).not.toContain('task:');
    expect(splitLegacyCriteria(keep).moved).toEqual({}); // a second pass moves nothing
  });

  it('adds lines at the end of their sections, from the skeleton, never twice', () => {
    const text = addCriteriaLines(null, { scenarios: ['- [pass] a · round 1'], bugs: ['- [fail] b · round 1'] });
    expect(text).toBe('# Test criteria\n\nKept by Claude during Petal’s test loop.\n\n## Scenarios\n- [pass] a · round 1\n\n## Bugs\n- [fail] b · round 1\n');
    expect(addCriteriaLines(text, { scenarios: ['- [pass] a · round 1'], bugs: [] })).toBe(text);
    const more = addCriteriaLines(text, { scenarios: ['- [flaky] c · round 2'], bugs: [] });
    expect(parseCriteria(more).scenarios.map((s) => s.name)).toEqual(['a', 'c']);
    expect(addCriteriaLines('# Notes only\n', { scenarios: [], bugs: ['- [fail] d · round 1'] })).toContain('## Bugs\n- [fail] d · round 1');
  });
});

describe('the criteria files on disk', () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'petal-criteria-')); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
  const legacy = () => path.join(root, '.petal', 'test-criteria.md');
  const own = (id: string) => path.join(root, '.petal', 'criteria', `${id}.md`);
  const writeOld = (text = OLD) => { fs.mkdirSync(path.join(root, '.petal'), { recursive: true }); fs.writeFileSync(legacy(), text); };

  it('a loop start makes its task’s own file and keeps .petal/ out of git', () => {
    prepareLoop(root, 't-cart');
    expect(fs.readFileSync(own('t-cart'), 'utf8')).toBe(CRITERIA_SKELETON);
    expect(fs.readFileSync(path.join(root, '.petal', '.gitignore'), 'utf8')).toBe('*\n');
    expect(fs.existsSync(legacy())).toBe(false);
  });

  it('moves tagged lines into each task’s file once, keeping the rest in the old file', () => {
    writeOld();
    migrateCriteria(root);
    expect(parseCriteria(fs.readFileSync(own('t-cart'), 'utf8')).bugs.map((b) => b.name)).toEqual(['cent off']);
    expect(parseCriteria(fs.readFileSync(own('t-coupon'), 'utf8')).bugs.map((b) => b.name)).toEqual(['coupon 500s']);
    const left = fs.readFileSync(legacy(), 'utf8');
    expect(left).not.toContain('task:');
    expect(left).toContain('an old scenario');
    const cart = fs.readFileSync(own('t-cart'), 'utf8');
    migrateCriteria(root);
    expect(fs.readFileSync(own('t-cart'), 'utf8')).toBe(cart); // once
  });

  it('reads every file as one list, each item filed under its task; untagged old lines go to the only task', () => {
    writeOld();
    const many = readCriteria(root, [task('t-cart'), task('t-coupon')]);
    const taskOf = (name: string) => [...(many?.scenarios ?? []), ...(many?.bugs ?? [])].find((i) => i.name === name)?.taskId;
    expect([taskOf('coupon 500s'), taskOf('cent off'), taskOf('cart rounds'), taskOf('an old scenario')]).toEqual(['t-coupon', 't-cart', 't-cart', null]);
    expect(many?.malformed).toBe(1); // the stray note still counts
    const only = readCriteria(root, [task('t-cart')]);
    expect(only?.scenarios.find((s) => s.name === 'an old scenario')?.taskId).toBe('t-cart');
    expect(only?.bugs.find((b) => b.name === 'coupon 500s')?.taskId).toBe('t-coupon'); // a task file's lines stay its own
  });

  it('a line in a task’s file belongs to it even untagged; no file at all reads as none', () => {
    expect(readCriteria(root, [])).toBeNull();
    fs.mkdirSync(path.join(root, '.petal', 'criteria'), { recursive: true });
    fs.writeFileSync(own('t-cart'), '## Bugs\n- [fail] total off · round 1\n');
    fs.writeFileSync(path.join(root, '.petal', 'criteria', 'bad name!.md'), '## Bugs\n- [fail] ignored · round 1\n');
    expect(readCriteria(root, [])?.bugs.map((b) => [b.name, b.taskId])).toEqual([['total off', 't-cart']]);
  });

  it('a linked old file is left alone', () => {
    fs.mkdirSync(path.join(root, '.petal'), { recursive: true });
    const outside = path.join(root, 'elsewhere.md');
    fs.writeFileSync(outside, OLD);
    fs.symlinkSync(outside, legacy());
    migrateCriteria(root);
    expect(fs.existsSync(path.join(root, '.petal', 'criteria'))).toBe(false);
    expect(fs.readFileSync(outside, 'utf8')).toBe(OLD);
  });
});

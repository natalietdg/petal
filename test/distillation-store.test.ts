// <repo>/.petal/distillation.jsonl: written only where a loop was started, self-ignoring, symlink-safe, and each new course is one Activity item.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const recorded: { id?: string; text: string; kind: string; detail?: string[] }[] = [];
vi.mock('../src/main/activity-feed', () => ({ recordActivity: (input: { id?: string; text: string; kind: string; detail?: string[] }) => { recorded.push(input); return null; } }));
vi.mock('../src/main/session-title', () => ({ sessionTitleFor: () => 'Checkout loop' }));
vi.mock('../src/main/repo-label', () => ({ repoBranch: () => 'main' }));

const { captureReplies, readDistillation } = await import('../src/main/distillation-store');
const { useTempUserData, removeTempDirs } = await import('./helpers');

const ROUND = (round: number, extra = '') => `## Distillation\n- Q: What changed? · A: The cap moved into totals.ts.\n**Course:** retest · needs a green run\n## Open threads\n- Free orders allowed? *Check: needs you · the product rule*${extra}\n**Loop:** round ${round}/5 · testing · 0 open`;
const reply = (id: string, round: number, s: number) => ({ id, markdown: ROUND(round), timestamp: new Date(1_000_000 + s * 1000).toISOString() });

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'petal-distill-'));
  fs.mkdirSync(path.join(root, '.git'));
  recorded.length = 0;
  useTempUserData(); // a session that held no task is looked up among the testing agents
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); removeTempDirs(); });

const prepare = () => { fs.mkdirSync(path.join(root, '.petal')); fs.writeFileSync(path.join(root, '.petal', 'test-criteria.md'), '# Test criteria\n'); };

describe('distillation store', () => {
  it('writes nothing in a repo with no test loop', () => {
    expect(captureReplies(root, [reply('a', 1, 1)], 's1')).toEqual([]);
    expect(fs.existsSync(path.join(root, '.petal'))).toBe(false);
  });

  it('stores each round once, keeps .petal out of git, and records one Activity item per course', () => {
    prepare();
    expect(captureReplies(root, [reply('a', 1, 1)], 's1').map((r) => r.id)).toEqual(['a']);
    expect(captureReplies(root, [reply('b', 2, 2), reply('a', 1, 1)], 's1').map((r) => r.id)).toEqual(['b']);
    expect(captureReplies(root, [reply('b', 2, 2), reply('a', 1, 1)], 's1')).toEqual([]); // read again: nothing new
    expect(fs.readFileSync(path.join(root, '.petal', '.gitignore'), 'utf8')).toBe('*\n');
    const stored = readDistillation(root);
    expect(stored.map((r) => [r.id, r.round, r.course, r.threads.length])).toEqual([['a', 1, 'retest', 1], ['b', 2, 'retest', 1]]);
    expect(fs.readFileSync(path.join(root, '.petal', 'distillation.jsonl'), 'utf8').trim().split('\n')).toHaveLength(2);
    expect(recorded.map((e) => [e.id, e.kind, e.text])).toEqual([
      ['distill:a', 'test', `Test loop round 1 in ${path.basename(root)}: retest · needs a green run`],
      ['distill:b', 'test', `Test loop round 2 in ${path.basename(root)}: retest · needs a green run`],
    ]);
    expect(recorded[0].detail).toEqual(['Course: Retest', 'Needs you: Free orders allowed?']);
  });

  it('skips a reply still being written (no Course line yet)', () => {
    prepare();
    expect(captureReplies(root, [{ id: 'c', markdown: '## Distillation\n- Q: a? · A: b', timestamp: new Date().toISOString() }], 's1')).toEqual([]);
  });

  it('never reads or writes through a link', () => {
    prepare();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'petal-outside-'));
    const target = path.join(outside, 'elsewhere.jsonl');
    fs.writeFileSync(target, `${JSON.stringify({ id: 'x', course: 'retest', questions: [], threads: [] })}\n`);
    fs.symlinkSync(target, path.join(root, '.petal', 'distillation.jsonl'));
    expect(readDistillation(root)).toEqual([]);
    expect(() => captureReplies(root, [reply('a', 1, 1)], 's1')).not.toThrow();
    expect(fs.readFileSync(target, 'utf8')).toContain('"id":"x"'); // the link's target is untouched
    fs.rmSync(outside, { recursive: true, force: true });
  });
  it('files a new round under the task its session held then; a stored round keeps what it had', () => {
    prepare();
    captureReplies(root, [reply('old', 1, 1)], 's1'); // stored before any task: untagged for good
    const owner = { sessionId: 's1', name: 'Cart', branch: null };
    const task = { id: 't-cart', title: 'Fix the cart', notes: '', status: 'claimed', owner, createdAt: 0, claimedAt: 1_000_000 + 1500, doneAt: null, doneBy: null, prdId: null, parentId: null };
    fs.writeFileSync(path.join(root, '.petal', 'tasks.json'), JSON.stringify({ version: 2, prds: [], tasks: [task] }));
    captureReplies(root, [reply('new', 2, 2), reply('old', 1, 1)], 's1');
    captureReplies(root, [reply('other', 3, 3)], 's2');
    expect(readDistillation(root).map((r) => [r.id, r.taskId ?? null])).toEqual([['old', null], ['new', 't-cart'], ['other', null]]);
  });
});

// Per-task suites: the suite file, taking the testing agent's changes (agent only, Undo, bad files kept out), a subtask falling back
// to its parent's suite, the seed from the project's old pipeline, the task picker and a PRD's overview.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { removeTempDirs, tempDir, useTempUserData } from './helpers';
import { addTask, assignTask, type Task, type TaskData } from '../src/shared/tasks';
import { addPrd, setTaskPrd, splitTask } from '../src/shared/task-groups';
import { OUTSIDE_AGENT, checkSuite, parseSuiteText, suiteFor, suiteText, takeSuiteFile, type SuiteViews, type TaskSuite } from '../src/shared/task-suite';
import { defaultTarget, keepTarget, parseTarget, prdOverview, targetValue, tasksInOrder } from '../src/shared/task-testing';
import { parseCriteria, buildLoopBrief } from '../src/shared/test-loop';
import { agentTaskOf, rememberAgent, suiteFile, syncSuites, undoSuiteChange, writeSuite } from '../src/main/task-suites';
import { updateTasks } from '../src/main/tasks-store';
import { taskIdAt } from '../src/main/testing-tasks';
import { projectSeed } from '../src/main/testing-ipc';
import { forgetLogs, scanLog } from '../src/main/testing-claude';
import * as store from '../src/main/testing-store';
import type { PipelineRun } from '../src/shared/testing';

afterEach(removeTempDirs);

const suite = (...names: string[]): TaskSuite => ({ stages: names.map((name) => ({ id: name.toLowerCase(), name, command: `npm run ${name.toLowerCase()}` })), keepGoing: false, autoRun: false });
const views = (entries: Record<string, TaskSuite | null>): SuiteViews =>
  Object.fromEntries(Object.entries(entries).map(([id, s]) => [id, { suite: s, change: null, problem: null }]));

// PRD "Checkout" holds a and b; b is split into b1 and b2; c is ungrouped; a is held by session s1.
function board(): TaskData {
  let tasks: Task[] = [];
  tasks = addTask(tasks, { title: 'Fix the cart total' }, 'a', 1);
  tasks = addTask(tasks, { title: 'Coupons' }, 'b', 2);
  tasks = addTask(tasks, { title: 'Docs' }, 'c', 3);
  const prds = addPrd([], { title: 'Checkout' }, 'p1', 4);
  tasks = setTaskPrd({ tasks, prds }, 'a', 'p1');
  tasks = setTaskPrd({ tasks, prds }, 'b', 'p1');
  tasks = splitTask(tasks, 'b', ['Coupon API', 'Coupon UI'], ['b1', 'b2'], 5);
  const given = assignTask(tasks, 'a', { sessionId: 's1', name: 'Cart work', branch: null }, 10);
  return { tasks: 'tasks' in given ? given.tasks : tasks, prds };
}

describe('the suite file', () => {
  it('reads a list or { stages }, with ids from names; refuses what it can’t run', () => {
    expect(parseSuiteText(JSON.stringify({ stages: [{ name: 'Unit', command: 'npm test' }, { name: 'Unit', command: 'npm run e2e' }], keepGoing: true }))).toEqual({
      suite: { stages: [{ id: 'unit', name: 'Unit', command: 'npm test' }, { id: 'unit-2', name: 'Unit', command: 'npm run e2e' }], keepGoing: true, autoRun: false },
    });
    expect(parseSuiteText('[{"name":"Lint","command":"npm run lint"}]')).toMatchObject({ suite: { stages: [{ id: 'lint' }] } });
    expect(parseSuiteText('{')).toEqual({ problem: 'it isn’t valid JSON' });
    expect(parseSuiteText('{"stages":[]}')).toEqual({ problem: 'it has no stages' });
    expect(parseSuiteText('{"stages":[{"name":"Unit","command":"npm test\\nrm -rf ~"}]}')).toEqual({ problem: 'stage 1 needs a one-line command' });
  });

  it('round-trips the shape Petal writes, so Claude edits the same thing', () => {
    const s = suite('Typecheck', 'Unit');
    expect(parseSuiteText(suiteText(s))).toEqual({ suite: s });
    expect(JSON.parse(suiteText(s))).toEqual({ stages: [{ name: 'Typecheck', command: 'npm run typecheck' }, { name: 'Unit', command: 'npm run unit' }], keepGoing: false, autoRun: false });
  });

  it('the editor’s suite: every stage good or nothing; no stages removes it', () => {
    expect(checkSuite({ stages: [{ id: 'x', name: 'X', command: 'echo a\nrm -rf /' }] })).toEqual({ ok: false });
    expect(checkSuite({ stages: [{ id: 'x', name: '', command: 'npm test' }] })).toEqual({ ok: false });
    expect(checkSuite({ stages: [] })).toEqual({ ok: true, suite: null });
    expect(checkSuite({ stages: [{ name: 'Unit', command: 'npm test' }], autoRun: true })).toMatchObject({ ok: true, suite: { autoRun: true } });
  });
});

describe('taking a change to the file', () => {
  const before = { text: suiteText(suite('Unit')), good: suite('Unit'), change: null, problem: null };
  const agents = ['agent-1'];

  it('the task’s testing agent changes it: taken, with the old suite kept for Undo', () => {
    const next = takeSuiteFile(before, { text: suiteText(suite('Unit', 'Lint')), at: 50 }, 'agent-1', agents);
    expect(next).toEqual({ text: suiteText(suite('Unit', 'Lint')), good: suite('Unit', 'Lint'), change: { at: 50, previous: suite('Unit') }, problem: null });
  });

  it('any other session, even the one holding the task, is not applied and is flagged', () => {
    for (const writer of ['coding-session', null]) {
      const next = takeSuiteFile(before, { text: suiteText(suite('Wipe')), at: 5 }, writer, agents);
      expect(next).toEqual({ ...before, problem: OUTSIDE_AGENT });
    }
    expect(OUTSIDE_AGENT).toBe('Changed outside the testing agent, not applied.');
  });

  it('a rejected file is checked again, so the agent’s log catching up still counts; putting it back clears the flag', () => {
    const rejected = takeSuiteFile(before, { text: suiteText(suite('Lint')), at: 5 }, null, agents);
    expect(takeSuiteFile(rejected, { text: suiteText(suite('Lint')), at: 5 }, 'agent-1', agents)?.good).toEqual(suite('Lint'));
    expect(takeSuiteFile(rejected, { text: before.text, at: 9 }, null, agents)).toEqual(before);
  });

  it('a file from the agent that doesn’t parse keeps the old suite and says why; unchanged text is left alone', () => {
    const bad = takeSuiteFile(before, { text: '{"stages": [', at: 5 }, 'agent-1', agents);
    expect(bad).toEqual({ ...before, problem: 'The testing agent’s change was not used: it isn’t valid JSON.' });
    expect(takeSuiteFile(before, { text: before.text, at: 9 }, 'agent-1', agents)).toBe(before);
  });

  it('a file seen for the first time with no writer is taken quietly', () => {
    expect(takeSuiteFile(null, { text: suiteText(suite('Unit')), at: 5 }, null, [])).toEqual({ text: suiteText(suite('Unit')), good: suite('Unit'), change: null, problem: null });
    expect(takeSuiteFile(null, { text: null, at: 0 }, null, [])).toBeNull();
  });

  it('a first file on a task with a testing agent waits for its log, then is taken with Undo', () => {
    const file = { text: suiteText(suite('Docs')), at: 5 };
    const waiting = takeSuiteFile(null, file, null, agents);
    expect(waiting).toEqual({ text: null, good: null, change: null, problem: OUTSIDE_AGENT });
    expect(takeSuiteFile(waiting, file, 'agent-1', agents)).toEqual({ text: file.text, good: suite('Docs'), change: { at: 5, previous: null }, problem: null });
  });
});

describe('suites on disk', () => {
  const repo = () => { const dir = tempDir('petal-repo-'); fs.mkdirSync(path.join(dir, '.git')); return dir; };

  it('writes the task’s file inside .petal, kept out of git, and reads it back per task', () => {
    useTempUserData();
    const root = repo();
    const { tasks } = board();
    writeSuite(root, 'a', suite('Unit'));
    writeSuite(root, 'c', suite('Docs'));
    expect(fs.readFileSync(path.join(root, '.petal', '.gitignore'), 'utf8')).toBe('*\n');
    const read = syncSuites(root, tasks);
    expect(read.a?.suite).toEqual(suite('Unit'));
    expect(read.c?.suite).toEqual(suite('Docs'));
    expect(read.b).toBeUndefined();
    writeSuite(root, 'c', null);
    expect(fs.existsSync(suiteFile(root, 'c'))).toBe(false);
    expect(syncSuites(root, tasks).c?.suite).toBeNull();
  });

  it('the testing agent Petal launched writes it: taken on the next read, and Undo puts the old stages back', () => {
    useTempUserData();
    const root = repo();
    const { tasks } = board();
    writeSuite(root, 'a', suite('Unit'));
    rememberAgent(root, 'a', 'agent-1');
    expect(agentTaskOf(root, 'agent-1')).toBe('a');
    expect(agentTaskOf(root, 's1')).toBeNull();
    fs.writeFileSync(suiteFile(root, 'a'), suiteText(suite('Unit', 'E2e')));
    const changed = syncSuites(root, tasks, [{ taskId: 'a', at: Date.now(), sessionId: 'agent-1' }]);
    expect(changed.a).toMatchObject({ suite: suite('Unit', 'E2e'), change: { previous: suite('Unit') } });
    expect(undoSuiteChange(root, 'a')).toBe(true);
    expect(syncSuites(root, tasks).a).toEqual({ suite: suite('Unit'), change: null, problem: null, at: fs.statSync(suiteFile(root, 'a')).mtimeMs });
    expect(fs.readFileSync(suiteFile(root, 'a'), 'utf8')).toBe(suiteText(suite('Unit')));
    expect(undoSuiteChange(root, 'a')).toBe(false);
  });

  it('the coding session holding the task can’t change it, nor another task’s agent', () => {
    useTempUserData();
    const root = repo();
    const { tasks } = board();
    writeSuite(root, 'a', suite('Unit'));
    rememberAgent(root, 'c', 'agent-c');
    fs.writeFileSync(suiteFile(root, 'a'), suiteText(suite('Wipe')));
    for (const sessionId of ['s1', 'agent-c']) {
      const read = syncSuites(root, tasks, [{ taskId: 'a', at: Date.now(), sessionId }]);
      expect(read.a).toEqual({ suite: suite('Unit'), change: null, problem: OUTSIDE_AGENT, at: fs.statSync(suiteFile(root, 'a')).mtimeMs });
    }
  });

  it('the session log names who wrote a suite file; reading it does not count', async () => {
    forgetLogs();
    const dir = tempDir();
    const log = path.join(dir, 's1.jsonl');
    const entry = (uuid: string, name: string, input: object) => JSON.stringify({ type: 'assistant', uuid, timestamp: new Date(1000).toISOString(), isSidechain: false, message: { role: 'assistant', content: [{ type: 'tool_use', id: uuid, name, input }] } });
    fs.writeFileSync(log, `${entry('u1', 'Read', { file_path: '/r/.petal/suites/t-read.json' })}\n${entry('u2', 'Write', { file_path: '/r/.petal/suites/t-1a2b.json', content: '{}' })}\n`);
    expect((await scanLog(log, 's1')).suiteWrites).toEqual([{ taskId: 't-1a2b', at: 1000, sessionId: 's1' }]);
  });

  it('a testing agent’s runs and rounds file under its task', () => {
    useTempUserData();
    const root = repo();
    updateTasks(root, () => board());
    rememberAgent(root, 'c', 'agent-c');
    expect(taskIdAt(root, 'agent-c', 50)).toBe('c');
    expect(taskIdAt(root, 'nobody', 50)).toBeNull();
  });
});

describe('which suite a task runs', () => {
  const { tasks } = board();

  it('its own; a subtask without one runs its parent’s; else none', () => {
    const suites = views({ a: suite('Unit'), b: suite('Api'), b2: suite('Ui') });
    expect(suiteFor(tasks, suites, 'a')).toMatchObject({ suite: suite('Unit'), owner: { id: 'a' } });
    expect(suiteFor(tasks, suites, 'b1')).toMatchObject({ suite: suite('Api'), owner: { id: 'b' } });
    expect(suiteFor(tasks, suites, 'b2')).toMatchObject({ suite: suite('Ui'), owner: { id: 'b2' } });
    expect(suiteFor(tasks, suites, 'c')).toBeNull();
    expect(suiteFor(tasks, views({ b: null }), 'b1')).toBeNull();
    expect(suiteFor(tasks, suites, 'gone')).toBeNull();
  });
});

describe('the project’s commands as a seed', () => {
  it('.petal/pipeline.json first, else the pipeline she saved; a bad file says why', () => {
    useTempUserData();
    const root = tempDir('petal-repo-');
    expect(projectSeed(root)).toBeNull();
    store.savePipeline(root, { stages: [{ id: 'unit', name: 'Unit', command: 'npm test' }], keepGoing: false, autoRun: false, confirmed: [] });
    expect(projectSeed(root)).toEqual({ stages: [{ id: 'unit', name: 'Unit', command: 'npm test' }] });
    fs.mkdirSync(path.join(root, '.petal'));
    fs.writeFileSync(path.join(root, '.petal', 'pipeline.json'), JSON.stringify([{ name: 'Typecheck', command: 'npx tsc --noEmit' }]));
    expect(projectSeed(root)).toEqual({ stages: [{ id: 'typecheck', name: 'Typecheck', command: 'npx tsc --noEmit' }] });
    store.savePipeline(root, { stages: [], keepGoing: false, autoRun: false, confirmed: [] });
    fs.writeFileSync(path.join(root, '.petal', 'pipeline.json'), '[1]');
    expect(projectSeed(root)).toEqual({ problem: 'stage 1 should have only a name and a command' });
  });
});

describe('the task picker', () => {
  const data = board();

  it('lists PRD tasks first, subtasks under their task, then No PRD', () => {
    expect(tasksInOrder(data).map((t) => t.id)).toEqual(['a', 'b', 'b1', 'b2', 'c']);
  });

  it('defaults to the session’s task, else the first unfinished one; keeps her pick while it exists', () => {
    expect(defaultTarget(data, 'b2')).toEqual({ kind: 'task', id: 'b2' });
    expect(defaultTarget(data, null)).toEqual({ kind: 'task', id: 'a' });
    expect(defaultTarget({ tasks: [], prds: [] }, null)).toBeNull();
    expect(keepTarget({ kind: 'prd', id: 'p1' }, data, 'a')).toEqual({ kind: 'prd', id: 'p1' });
    expect(keepTarget({ kind: 'task', id: 'gone' }, data, 'c')).toEqual({ kind: 'task', id: 'c' });
  });

  it('round-trips its option values', () => {
    expect(parseTarget(targetValue({ kind: 'prd', id: 'p-1' }))).toEqual({ kind: 'prd', id: 'p-1' });
    expect(parseTarget('nope')).toBeNull();
  });
});

describe('a PRD’s overview', () => {
  const data = board();
  const run = (id: string, taskId: string, state: PipelineRun['state'], startedAt: number): PipelineRun => ({
    id, by: 'you', trigger: 'click', startedAt, finishedAt: startedAt + 1, state, stages: [], totals: { passed: 0, failed: 0, skipped: 0 }, taskId,
  });

  it('one row per task and subtask: stages, last run, pass rate, open bugs', () => {
    const runs = [run('r3', 'a', 'passed', 30), run('r2', 'a', 'failed', 20), run('r1', 'b1', 'passed', 10), run('r0', 'c', 'failed', 5)];
    const criteria = parseCriteria('## Bugs\n- [fail] cent off · round 1 · task: a\n- [fixed] old · round 1 · task: a\n- [fail] api 500 · round 1 · task: b1\n');
    const rows = prdOverview(data, 'p1', views({ a: suite('Unit', 'Lint'), b: suite('Api') }), runs, criteria);
    expect(rows.map((r) => [r.task.id, r.subtask, r.stages, r.borrowed, r.last?.id ?? null, r.passRate, r.openBugs])).toEqual([
      ['a', false, 2, false, 'r3', 0.5, 1],
      ['b', false, 1, false, null, null, 0],
      ['b1', true, 1, true, 'r1', 1, 1],
      ['b2', true, 1, true, null, null, 0],
    ]);
    expect(prdOverview(data, 'missing', {}, runs, null)).toEqual([]);
  });
});

describe('the loop brief names the task’s suite file', () => {
  it('tells the testing agent where the suite lives and its shape; a loop in another session may not change it', () => {
    const base = { focus: '', rounds: 1, stages: [{ id: 'unit', name: 'Unit', command: 'npm test' }], stack: [], taskId: 't-1a2b' };
    const brief = buildLoopBrief({ ...base, agent: true });
    expect(brief).toContain('this task\'s testing agent');
    expect(brief).toContain('The suite lives in .petal/suites/t-1a2b.json.');
    expect(brief).toContain('{"stages": [{"name": "Unit", "command": "npm test"}]}');
    expect(buildLoopBrief(base)).not.toContain('.petal/suites/');
  });
});

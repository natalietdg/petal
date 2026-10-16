// Testing History rows: what ran, why, change since the last run of the same thing, duration from the log,
// repeats collapsed, no-result commands folded, days; plus filing Claude's runs under the repo they ran in.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { removeTempDirs, tempDir, useTempUserData } from './helpers';
import { claudeRun, forgetLogs, isCheckCommand, scanLog } from '../src/main/testing-claude';
import { projectRootOf, ranIn, runProject } from '../src/main/testing-project';
import * as store from '../src/main/testing-store';
import { cdTarget, checkStep, type PipelineRun, type StageResult, type TestCase } from '../src/shared/testing';
import {
  changeSince, dayLabel, historyDays, isNoResult, resultText, runTitle, runWhy, shortCommand, stagesFromRuns, testLabel,
  type RunRow,
} from '../src/shared/testing-history';

afterEach(() => { removeTempDirs(); forgetLogs(); });

const NOW = new Date('2026-10-16T15:00:00').getTime();
const HOUR = 3600_000;

const test = (name: string, status: TestCase['status'], file = 'src/auth/tokens.test.ts'): TestCase => ({ name, file, status, durationMs: 1 });

function run(over: Partial<PipelineRun> & { command?: string; stageId?: string | null; name?: string; tests?: TestCase[]; durationMs?: number | null } = {}): PipelineRun {
  const tests = over.tests ?? [];
  const counts = { passed: tests.filter((t) => t.status === 'passed').length, failed: tests.filter((t) => t.status === 'failed').length, skipped: 0 };
  const state = over.state ?? (counts.failed ? 'failed' : 'passed');
  const stage: StageResult = {
    stageId: over.stageId ?? null, name: over.name ?? 'Claude’s run', command: over.command ?? 'npx vitest run', status: state === 'failed' ? 'failed' : 'passed',
    exitCode: state === 'failed' ? 1 : 0, durationMs: over.durationMs ?? null, counts, tests, output: '', runner: 'vitest',
  };
  return { id: `r${Math.random()}`, by: 'claude', trigger: 'transcript', startedAt: NOW - HOUR, finishedAt: NOW - HOUR, state, stages: [stage], totals: counts, ...over };
}

describe('what each history row says', () => {
  it('titles a run by its stage, else a short form of the command, never by who ran it', () => {
    expect(runTitle(run({ stageId: 'unit', name: 'Unit' }))).toBe('Unit');
    expect(runTitle(run({ command: 'cd ~/acme && CI=1 npx vitest run src/auth 2>&1 | tail -n 40' }))).toBe('npx vitest run src/auth');
    expect(runTitle(run({ command: 'cd ~/acme; export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null; npm run typecheck' }))).toBe('npm run typecheck');
    expect(shortCommand('npx jest --watchAll=false --coverage=false src/very/long/path/to/some/module.test.ts')).toHaveLength(48);
    const pipeline = run({ by: 'you', trigger: 'click' });
    pipeline.stages = [pipeline.stages[0], { ...pipeline.stages[0], stageId: 'tc' }];
    expect(runTitle(pipeline)).toBe('Pipeline · 2 stages');
  });

  it('says why: the prompt Claude’s turn answered and its session, or which of her buttons', () => {
    expect(runWhy(run({ prompt: 'add a dark mode toggle to the settings screen and make sure it persists across restarts', sessionName: 'acme-notes' })))
      .toBe('while: add a dark mode toggle to the settings screen and make sure… · acme-notes');
    expect(runWhy(run({ prompt: '', sessionName: 'acme-notes' }))).toBe('acme-notes');
    const mine = run({ by: 'you', trigger: 'click' });
    expect(runWhy(mine)).toBe('Run stage');
    expect(runWhy({ ...mine, stages: [mine.stages[0], mine.stages[0]] })).toBe('Run pipeline');
    expect(runWhy({ ...mine, trigger: 'auto' })).toBe('Auto, after Claude’s turn');
  });

  it('compares with the previous run of the same stage: test count, newly failing by name, fixed', () => {
    const before = run({ stageId: 'unit', tests: [test('a', 'passed'), test('auth > tokens > rejects expired', 'passed'), test('b', 'failed'), test('c', 'failed')] });
    const after = run({ stageId: 'unit', tests: [test('a', 'passed'), test('auth > tokens > rejects expired', 'failed'), test('b', 'passed'), test('c', 'passed'), test('d', 'passed'), test('e', 'passed'), test('f', 'passed')] });
    expect(changeSince(after, before)).toEqual(['+3 tests', '1 newly failing: tokens.test.ts › rejects expired', 'fixed 2']);
    expect(changeSince(after, null)).toEqual([]);
    // Counts only (a typecheck or a summary line): the change in failures.
    const counted = (failed: number) => ({ ...run({ stageId: 'unit' }), state: failed ? 'failed' as const : 'passed' as const, totals: { passed: 900, failed, skipped: 0 } });
    expect(changeSince(counted(3), counted(1))).toEqual(['+2 tests', '2 more failing']);
    expect(changeSince(counted(0), counted(3))).toEqual(['−3 tests', 'fixed 3']);
    expect(resultText(counted(2))).toBe('2 failed · 900 passed');
  });

  it('names failing tests inline, the first two and how many more', () => {
    const many = run({ tests: ['one', 'two', 'three', 'four'].map((n) => test(`suite > ${n}`, 'failed')) });
    const [day] = historyDays([many], NOW);
    expect((day.rows[0] as RunRow).failing).toBe('tokens.test.ts › one, tokens.test.ts › two + 2 more');
    expect(testLabel({ name: 'x', file: 'x' })).toBe('x');
  });
});

describe('grouping the list', () => {
  it('collapses repeats of the same command with the same result, newest kept, and opens to them', () => {
    const same = [0, 1, 2, 3].map((i) => run({ id: `s${i}`, startedAt: NOW - HOUR * (2 + i * 0.1), tests: [test('a', 'passed')] }));
    const different = run({ id: 'd', startedAt: NOW - HOUR * 3, tests: [test('a', 'failed')] });
    const [day] = historyDays([different, ...same], NOW);
    const rows = day.rows as RunRow[];
    expect(rows.map((r) => [r.run.id, r.repeats.length])).toEqual([['s0', 4], ['d', 1]]);
    expect(rows[0].change).toEqual(['fixed 1']); // compared with the last different run, not its own repeats
  });

  it('folds commands that printed no test results into one muted row per day', () => {
    const noise = run({ command: 'cat >> AUDIT.md <<\'EOF\'\nran npm test\nEOF' });
    const real = run({ startedAt: NOW - 2 * HOUR, tests: [test('a', 'passed')] });
    expect(isNoResult(noise)).toBe(true);
    expect(isNoResult(real)).toBe(false);
    expect(isNoResult(run({ stageId: 'tc', name: 'Typecheck' }))).toBe(false); // a passing stage with no tests still says something
    expect(isNoResult(run({ state: 'failed' }))).toBe(false);
    expect(isNoResult(run({ command: 'cd ~/acme && npx tsc --noEmit' }))).toBe(false); // a clean typecheck prints nothing
    expect(runTitle(run({ command: 'npx tsc --noEmit; echo "tsc $?"; npx jest --ci' }))).toBe('npx jest --ci'); // titled by the step its counts came from
    const [day] = historyDays([noise, real, { ...noise, id: 'n2' }], NOW);
    expect(day.rows.map((r) => r.kind)).toEqual(['run', 'other']);
    expect(day.rows[1]).toMatchObject({ kind: 'other', commands: ['cat'] });
    expect(day.rows[1].kind === 'other' && day.rows[1].runs).toHaveLength(2);
  });

  it('groups by day, newest first', () => {
    const at = (h: number) => run({ startedAt: NOW - h * HOUR, tests: [test(`t${h}`, 'passed')] });
    expect(historyDays([at(40), at(1), at(20)], NOW).map((d) => [d.label, d.rows.length])).toEqual([['Today', 1], ['Yesterday', 1], [dayLabel(NOW - 40 * HOUR, NOW), 1]]);
    expect(dayLabel(NOW - 40 * HOUR, NOW)).not.toMatch(/Today|Yesterday/);
  });

  it('makes a pipeline from the distinct checks Claude ran, typecheck first', () => {
    const runs = [
      run({ command: 'cd ~/a && npx vitest run 2>&1 | tail', tests: [test('a', 'passed')] }),
      run({ command: 'npx vitest run', tests: [test('a', 'passed')] }),
      run({ command: 'npx tsc --noEmit', state: 'failed' }),
      run({ command: 'cat x <<EOF\nnpm test\nEOF' }), // no results: left out
    ];
    expect(stagesFromRuns(runs).map((s) => [s.name, s.command])).toEqual([['Typecheck', 'npx tsc --noEmit'], ['Unit', 'npx vitest run']]);
  });
});

describe('Claude’s runs from the log', () => {
  const line = (o: object) => `${JSON.stringify({ isSidechain: false, ...o })}\n`;
  const prompt = (text: string, at: string) => line({ type: 'user', timestamp: at, message: { role: 'user', content: text } });
  const use = (id: string, command: string, at: string, cwd = '/Users/demo/acme') => line({ type: 'assistant', timestamp: at, cwd, message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } });
  const result = (id: string, text: string, at: string) => line({ type: 'user', timestamp: at, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] } });

  it('times a call from its tool_use to its tool_result and keeps the prompt its turn answered', async () => {
    const file = path.join(tempDir(), 's.jsonl');
    fs.writeFileSync(file, prompt('add a dark mode toggle', '2026-10-16T01:00:00Z')
      + use('t1', 'npx vitest run', '2026-10-16T01:00:05Z') + result('t1', 'Tests  3 passed (3)', '2026-10-16T01:00:17.500Z')
      // Claude Code's request copies: no timestamp, the same tool ids again. Never a second run.
      + line({ type: 'api-request-blob', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npx vitest run' } }] } })
      + line({ type: 'api-request-blob', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x' }] } })
      + prompt('<command-name>/clear</command-name>', '2026-10-16T01:05:00Z')
      + prompt('now fix the login test', '2026-10-16T01:06:00Z')
      + use('t2', 'npm test', '2026-10-16T01:06:02Z') + result('t2', 'ok', '2026-10-16T01:06:03Z'));
    const { calls } = await scanLog(file, 'sess');
    expect(calls.map((c) => [c.id, c.prompt, c.endAt - c.at, c.cwd])).toEqual([['t1', 'add a dark mode toggle', 12500, '/Users/demo/acme'], ['t2', 'now fix the login test', 1000, '/Users/demo/acme']]);
    const made = claudeRun(calls[0], []);
    expect(made).toMatchObject({ prompt: 'add a dark mode toggle', cwd: '/Users/demo/acme', finishedAt: calls[0].endAt });
    expect(made.stages[0].durationMs).toBe(12500);
  });

  it('reads a heredoc body as data, not a test command', () => {
    expect(isCheckCommand("cat >> AUDIT.md <<'EOF'\n#13 | ran npm test\nEOF")).toBe(false);
    expect(isCheckCommand("cat > notes <<EOF\nnpm test\nEOF\nnpx vitest run")).toBe(true);
    expect(checkStep('cd app && npx jest --ci > /tmp/out.txt 2>&1; echo "exit $?"')).toBe('npx jest --ci');
    expect(cdTarget('cd ~/acme && npm test')).toBe('~/acme');
    expect(cdTarget('npm test')).toBeNull();
  });
});

describe('which project a run belongs to', () => {
  it('is the repo it ran in: its cd, else Claude’s folder; never the home folder', () => {
    const realHome = process.env.HOME;
    process.env.HOME = tempDir('petal-home-'); // os.homedir() reads HOME; nothing of hers is touched
    const repo = path.join(os.homedir(), 'acme');
    try {
      fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
      fs.mkdirSync(path.join(repo, 'pkg'));
      const tilde = `~/${path.basename(repo)}`;
      expect(projectRootOf(os.homedir())).toBeNull();
      expect(projectRootOf(path.join(repo, 'pkg'))).toBe(repo);
      expect(projectRootOf(tempDir())).toBeNull(); // not inside a repo
      expect(ranIn(`cd ${tilde}/pkg && npm test`, '/elsewhere')).toBe(path.join(repo, 'pkg'));
      expect(ranIn('cd pkg && npm test', repo)).toBe(path.join(repo, 'pkg'));
      expect(runProject(run({ command: `cd ${tilde} && npx jest` }))).toBe(repo);
      expect(runProject(run({ command: 'npx jest', cwd: os.homedir() }))).toBeNull();
      expect(runProject(run({ command: 'npx jest', cwd: path.join(repo, 'pkg') }))).toBe(repo);
    } finally {
      process.env.HOME = realHome;
    }
  });

  it('keeps the earliest copy of a run filed twice', () => {
    useTempUserData();
    const a = run({ id: 'same', startedAt: NOW - 5 * HOUR });
    const b = { ...a, startedAt: NOW };
    store.save({ version: 1, root: '/Users/demo/acme', pipeline: null, runs: [b, a] });
    expect(store.load('/Users/demo/acme').runs.map((r) => r.startedAt)).toEqual([NOW - 5 * HOUR]);
  });
});
